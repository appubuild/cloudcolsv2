-- Sharing with a named person, as opposed to share_links which hand access to
-- whoever holds the token.
--
-- An invitation is addressed to an EMAIL, not a user id. Requiring the recipient
-- to already have an account would fail for exactly the people most likely to be
-- invited; the invitation binds to an account when someone signs in with that
-- address.
--
-- Nothing here confirms whether an address has an account. An endpoint that
-- answers "no such user" is an account-enumeration oracle and email addresses are
-- guessable, so an invitation is created either way and every response looks the
-- same.

create table if not exists public.share_invitations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,

  -- Exactly one target, enforced below rather than left to callers.
  file_id uuid references public.files(id) on delete cascade,
  folder_id uuid references public.folders(id) on delete cascade,

  -- Stored lowercased; the check keeps a differently-cased duplicate from
  -- slipping past the unique index.
  invited_email text not null check (
    invited_email = lower(invited_email)
    and length(invited_email) between 3 and 320
    and position('@' in invited_email) > 1
  ),

  -- Filled when the address is matched to an account: at invite time if one
  -- already exists, or at sign-up by the trigger below.
  recipient_id uuid references auth.users(id) on delete cascade,

  permission text not null default 'viewer' check (permission in ('viewer', 'editor')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked')),
  message text check (message is null or length(message) <= 500),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,

  constraint share_invitations_one_target check (
    (file_id is not null and folder_id is null) or (file_id is null and folder_id is not null)
  ),
  -- Sharing with yourself would put your own file in your own "shared with me".
  constraint share_invitations_not_self check (recipient_id is null or recipient_id <> owner_id)
);

-- One live invitation per person per item: re-inviting updates the existing row
-- rather than stacking duplicates that each have to be revoked separately.
create unique index if not exists share_invitations_unique_file
  on public.share_invitations (file_id, invited_email)
  where file_id is not null and status <> 'revoked';

create unique index if not exists share_invitations_unique_folder
  on public.share_invitations (folder_id, invited_email)
  where folder_id is not null and status <> 'revoked';

create index if not exists share_invitations_recipient_idx
  on public.share_invitations (recipient_id, created_at desc);
create index if not exists share_invitations_owner_idx
  on public.share_invitations (owner_id, created_at desc);
create index if not exists share_invitations_pending_email_idx
  on public.share_invitations (invited_email)
  where recipient_id is null and status = 'pending';

alter table public.share_invitations enable row level security;

-- Everything is written through the service role by the API, which checks
-- ownership itself. These policies exist so a leaked anon key cannot read or
-- change invitations directly.
create policy "share_invitations_owner" on public.share_invitations
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "share_invitations_recipient_read" on public.share_invitations
  for select to authenticated
  using (recipient_id = (select auth.uid()));

-- Attaches pending invitations to an account when its owner first appears.
-- search_path is pinned and includes extensions, which is where Supabase keeps
-- pgcrypto and friends.
create or replace function public.link_pending_invitations()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update public.share_invitations
     set recipient_id = new.id, updated_at = now()
   where recipient_id is null
     and status = 'pending'
     and invited_email = lower(new.email)
     and owner_id <> new.id;
  return new;
end;
$$;

drop trigger if exists link_invitations_on_signup on auth.users;
create trigger link_invitations_on_signup
  after insert on auth.users
  for each row execute function public.link_pending_invitations();

-- Keeps updated_at honest without every caller remembering to set it.
create or replace function public.touch_share_invitation()
returns trigger language plpgsql set search_path = public, extensions as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists share_invitations_touch on public.share_invitations;
create trigger share_invitations_touch
  before update on public.share_invitations
  for each row execute function public.touch_share_invitation();
