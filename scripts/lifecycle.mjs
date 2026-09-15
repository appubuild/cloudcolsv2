/**
 * Account lifecycle probe: sign-in activity, notifications, account deletion, purge.
 *
 * Each of these was broken in a way no unit test saw, because each break was between
 * two systems:
 *
 *   - login's last_login_at write went out under the user's token and was refused, so
 *     no account ever had one (lib/api/password.ts)
 *   - notification inserts discarded their error
 *   - deleting an account left every file's bytes in the bucket (migration 0025)
 *
 * So this asserts them from the outside, against a running Worker, and reads the
 * database and the job results to see what actually happened.
 *
 * Usage, with the app running under `wrangler dev --port 8792`:
 *
 *   node scripts/lifecycle.mjs .dev.vars
 *
 * Creates throwaway accounts under @cloudcols.test and removes whatever is left.
 */
import { readFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8792';
const ENV = Object.fromEntries(
  readFileSync(process.argv[2] ?? '.dev.vars', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);

const SUPA = ENV.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = ENV.SUPABASE_SERVICE_ROLE_KEY;
const ANON = ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PASSWORD = 'Lifecycle-passw0rd!';

let pass = 0;
let fail = 0;
function check(ok, label, detail = '') {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`);
  return ok;
}

async function call(path, { token, method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, code: json?.error?.code };
}

async function rest(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${SUPA}${path}`, {
    method,
    headers: {
      apikey: SERVICE,
      authorization: `Bearer ${SERVICE}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, json };
}

async function makeUser(tag) {
  const email = `lifecycle_${tag}_${Date.now()}@cloudcols.test`;
  const signup = await call('/api/auth/signup', { method: 'POST', body: { name: `Lifecycle ${tag}`, email, password: PASSWORD } });
  const id = signup.json?.data?.user?.id;
  const tokenRes = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const { access_token: token } = await tokenRes.json();
  return { id, email, token };
}

async function upload(user, name) {
  const ticket = await call('/api/files/upload-ticket', {
    token: user.token,
    method: 'POST',
    body: { filename: name, sizeBytes: 12, mimeType: 'text/plain' },
  });
  const fileId = ticket.json?.data?.fileId;
  if (!fileId) return null;
  await fetch(ticket.json.data.presignedUrl, { method: 'PUT', body: 'hello world!' });
  const confirm = await call('/api/files/confirm', { token: user.token, method: 'POST', body: { uploadId: fileId, fileId } });
  return confirm.status === 200 ? fileId : null;
}

const runJob = (name) =>
  call('/api/jobs/run', { method: 'POST', body: { name }, headers: { 'x-job-token': ENV.JOBS_TOKEN } });

const queueRow = async (prefix) =>
  (await rest(`/rest/v1/storage_purge_queue?prefix=eq.${encodeURIComponent(prefix)}&select=prefix`)).json ?? [];

async function main() {
  console.log('\nAccount lifecycle probe\n');
  const a = await makeUser('a');
  const b = await makeUser('b');
  const leftovers = [a.id, b.id];
  if (!a.token || !b.token) {
    console.log('  FAIL could not create test accounts');
    process.exit(1);
  }

  console.log('Sign-in is recorded');
  {
    const login = await call('/api/auth/login', { method: 'POST', body: { email: a.email, password: PASSWORD } });
    check(login.status === 200 && Boolean(login.json?.data?.user?.id), 'login succeeds', `HTTP ${login.status}`);
    const row = (await rest(`/rest/v1/user_storage?user_id=eq.${a.id}&select=last_login_at`)).json?.[0];
    const age = row?.last_login_at ? Date.now() - Date.parse(row.last_login_at) : Infinity;
    check(age < 120_000, 'last_login_at is written', row?.last_login_at ?? 'null');
  }

  console.log('\nNotifications');
  const aFile = await upload(a, 'lifecycle-a.txt');
  check(Boolean(aFile), 'owner uploads a file');
  let invitationId = null;
  {
    const inv = await call('/api/shares/invitations', { token: a.token, method: 'POST', body: { fileId: aFile, email: b.email, permission: 'viewer' } });
    invitationId = inv.json?.data?.id ?? null;
    check(inv.status === 200, 'owner invites the second account', `HTTP ${inv.status}${inv.code ? ' ' + inv.code : ''}`);
    const list = await call('/api/notifications', { token: b.token });
    const got = (list.json?.data ?? []).find((n) => n.type === 'share_invitation' || /shared something/.test(n.title ?? ''));
    check(Boolean(got), 'the recipient is notified', got ? `"${got.title}"` : `HTTP ${list.status}, ${JSON.stringify(list.json?.data ?? null).slice(0, 120)}`);
  }
  if (invitationId) {
    const resp = await call(`/api/shares/invitations/${invitationId}`, { token: b.token, method: 'PATCH', body: { action: 'accept' } });
    check(resp.status === 200, 'the recipient accepts', `HTTP ${resp.status}`);
    const list = await call('/api/notifications', { token: a.token });
    const got = (list.json?.data ?? []).find((n) => /accepted your share/.test(n.title ?? ''));
    check(Boolean(got), 'the owner is notified of the response', got ? `"${got.title}"` : '');
  }

  console.log('\nDeleting an account');
  {
    const none = await call('/api/auth/delete', { token: a.token, method: 'POST', body: {} });
    check(none.status === 400, 'refused without a password', `HTTP ${none.status} ${none.code ?? ''}`);
    const wrong = await call('/api/auth/delete', { token: a.token, method: 'POST', body: { password: 'not-the-password' } });
    check(wrong.status === 403, 'refused with a wrong password', `HTTP ${wrong.status} ${wrong.code ?? ''}`);
    const stillThere = await call('/api/auth/me', { token: a.token });
    check(stillThere.status === 200, 'and the account is untouched', `HTTP ${stillThere.status}`);
    const noSession = await call('/api/auth/delete', { method: 'POST', body: { password: PASSWORD } });
    check(noSession.status === 401, 'refused without a session', `HTTP ${noSession.status}`);
  }

  console.log('\nThe purge job refuses a live account');
  const bFile = await upload(b, 'lifecycle-b.txt');
  check(Boolean(bFile), 'second account uploads a file');
  {
    await rest('/rest/v1/storage_purge_queue', { method: 'POST', body: { prefix: `${b.id}/`, reason: 'probe' } });
    const run = await runJob('storage-purge');
    check(run.status === 200, 'job runs', `HTTP ${run.status} ${run.json?.data?.message ?? JSON.stringify(run.json).slice(0, 160)}`);
    check((await queueRow(`${b.id}/`)).length === 0, 'the live account is dropped from the queue');
    const still = await call(`/api/files/${bFile}`, { token: b.token });
    const dl = await call(`/api/files/download?fileId=${bFile}`, { token: b.token });
    check(still.status === 200 && dl.status === 200, 'and its file is untouched', `file ${still.status}, download ${dl.status}`);
  }

  console.log('\nDeleting for real');
  {
    const del = await call('/api/auth/delete', { token: a.token, method: 'POST', body: { password: PASSWORD } });
    check(del.status === 200, 'deleted with the right password', `HTTP ${del.status} ${del.code ?? ''}`);
    const authUser = await rest(`/auth/v1/admin/users/${a.id}`);
    check(authUser.status === 404, 'the auth user is gone', `HTTP ${authUser.status}`);
    const files = (await rest(`/rest/v1/files?owner_id=eq.${a.id}&select=id`)).json ?? [];
    check(files.length === 0, 'its file rows are gone');
    check((await queueRow(`${a.id}/`)).length === 1, 'its storage folder is queued for purge');
    const audit = (await rest(`/rest/v1/audit_logs?action=eq.user.delete_self&target_id=eq.${a.id}&select=id`)).json ?? [];
    check(Array.isArray(audit) && audit.length === 1, 'the deletion is audited');
    if (del.status === 200) leftovers.splice(leftovers.indexOf(a.id), 1);
  }

  console.log('\nThe purge job empties the deleted account');
  {
    const first = await runJob('storage-purge');
    const m1 = first.json?.data?.message ?? '';
    check(/deleted [1-9]\d* object/.test(m1), 'first run deletes its objects', m1);
    const second = await runJob('storage-purge');
    const m2 = second.json?.data?.message ?? '';
    // An empty listing is what removes the row, so the row being gone means storage
    // itself reported nothing left under the prefix.
    check((await queueRow(`${a.id}/`)).length === 0, 'second run finds nothing left and closes it', m2);
  }

  // --- cleanup ---------------------------------------------------------------
  // Deleting a user through the admin API removes rows, not bytes. Queue each test
  // account's folder as the delete route would, so the probe does not leave behind
  // the very orphans it exists to catch.
  await rest(`/rest/v1/storage_purge_queue?reason=eq.probe`, { method: 'DELETE' });
  for (const id of leftovers) {
    if (!id) continue;
    await rest('/rest/v1/storage_purge_queue', { method: 'POST', body: { prefix: `${id}/`, reason: 'probe_cleanup' } });
    await rest(`/auth/v1/admin/users/${id}`, { method: 'DELETE' });
  }
  await runJob('storage-purge');
  await runJob('storage-purge');
  const stuck = (await rest('/rest/v1/storage_purge_queue?reason=eq.probe_cleanup&select=prefix')).json ?? [];
  check(stuck.length === 0, 'cleanup left nothing in storage', stuck.length ? `${stuck.length} folder(s) still queued` : '');

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
