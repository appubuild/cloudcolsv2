-- Resolves an email address to an account id, for binding an invitation to a
-- recipient who already has an account.
--
-- auth.users is not exposed through PostgREST, so this has to be a definer
-- function. That makes it exactly the kind of thing that becomes an
-- account-enumeration oracle if anyone can call it, so EXECUTE is revoked from
-- everyone and granted only to service_role, which is the API's own credential
-- and never reaches a browser.
--
-- The API deliberately does not tell its caller whether the lookup found
-- anything: an invitation is created either way.

create or replace function public.user_id_for_email(p_email text)
returns uuid
language sql
security definer
stable
set search_path = public, extensions, auth
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

revoke all on function public.user_id_for_email(text) from public, anon, authenticated;
grant execute on function public.user_id_for_email(text) to service_role;
