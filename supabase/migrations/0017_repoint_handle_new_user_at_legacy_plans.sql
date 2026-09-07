-- Repairs signup, which migration 0016 broke.
--
-- 0016 renamed the prototype `plans` table to `legacy_plans` and created a new
-- `plans` keyed by text ids. That looked safe: nothing in the application reads
-- the prototype table.
--
-- A trigger did. `handle_new_user` fires on every insert into auth.users and does
--
--     select id into default_plan from plans where is_default limit 1;
--
-- into a uuid variable, then writes it to profiles.plan_id (uuid, referencing what
-- is now legacy_plans). After the rename that select returned 'plan_free', a text
-- id, the assignment failed, the trigger raised, and Supabase Auth answered every
-- signup with "Database error saving new user" — including through our own
-- /api/auth/signup, which surfaced it as SIGNUP_FAILED with an empty message.
--
-- Caught by scripts/e2e.mjs, which creates a real account. Nothing in the unit
-- suite touches auth.users, and both tsc and the build were perfectly happy.
--
-- The fix keeps the prototype path working exactly as it did before 0016: it now
-- names legacy_plans explicitly. Retiring `profiles` and this trigger is a real
-- cleanup with its own risks and belongs in its own change, not as a side effect
-- of moving the plan catalogue.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  default_plan uuid;
  base_name    text;
  candidate    text;
  attempt      integer := 0;
begin
  -- legacy_plans, not plans: `plans` is now the application's own catalogue, keyed
  -- by text ids, and profiles.plan_id is a uuid pointing at the prototype table.
  select id into default_plan from legacy_plans where is_default limit 1;
  if default_plan is null then
    raise exception 'no default plan configured';
  end if;

  base_name := regexp_replace(split_part(coalesce(new.email, 'user'), '@', 1), '[^a-zA-Z0-9_-]', '', 'g');
  if length(base_name) < 3 then
    base_name := 'user' || base_name;
  end if;
  base_name := left(base_name, 24);
  candidate := base_name;

  while exists (select 1 from profiles where lower(username) = lower(candidate)) loop
    attempt := attempt + 1;
    -- gen_random_uuid() is in pg_catalog, so this cannot break if an extension moves.
    candidate := left(base_name, 24) || '_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
    if attempt > 5 then
      candidate := 'user_' || substr(replace(new.id::text, '-', ''), 1, 20);
      exit;
    end if;
  end loop;

  insert into profiles (id, username, display_name, plan_id)
  values (new.id, candidate, nullif(new.raw_user_meta_data->>'display_name', ''), default_plan);

  return new;
end;
$$;
