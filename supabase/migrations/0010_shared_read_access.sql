-- What an accepted invitation actually grants.
--
-- Policies are OR-ed, so these widen access without touching the owner policies
-- from 0001. Access hangs on status = 'accepted': a pending invitation shows the
-- recipient that something is waiting, and nothing more. Declining or revoking it
-- takes the access away in the same statement, with no separate cleanup to forget.
--
-- The API reads through the service role and checks permissions itself; these
-- policies are the floor underneath that, so a mistake in the API layer cannot
-- hand out someone else's rows.

create policy "files_shared_read" on public.files
  for select to authenticated
  using (
    trashed_at is null
    and exists (
      select 1 from public.share_invitations i
      where i.recipient_id = (select auth.uid())
        and i.status = 'accepted'
        and (
          i.file_id = files.id
          -- A folder invitation reaches the files directly inside it.
          or (i.folder_id is not null and i.folder_id = files.folder_id)
        )
    )
  );

create policy "folders_shared_read" on public.folders
  for select to authenticated
  using (
    trashed_at is null
    and exists (
      select 1 from public.share_invitations i
      where i.recipient_id = (select auth.uid())
        and i.status = 'accepted'
        and i.folder_id = folders.id
    )
  );
