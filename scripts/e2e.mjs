/**
 * End-to-end check against real Supabase and real Backblaze.
 *
 * The vitest suite runs against mocks, which is why the API layer could be
 * "code-complete" and still answer 500 on the file manager's main listing: the
 * default sort key named a column that does not exist, and nothing that ran
 * against a real database would have missed it.
 *
 * This walks the chain a user actually walks — register, upload, confirm, list,
 * download, share, resolve anonymously, revoke, trash, restore — plus the two
 * refusals that matter: another account cannot reach the file, and an
 * unauthenticated request gets nothing. Bytes go straight to B2, never through
 * the app.
 *
 * Usage, with the app running under `wrangler dev --port 8792`:
 *
 *   node scripts/e2e.mjs .dev.vars
 *
 * It creates throwaway accounts under @cloudcols.test and deletes them afterwards.
 */
import { readFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8792';
const ENV = Object.fromEntries(
  readFileSync(process.argv[2], 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);

const SUPA = ENV.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = ENV.SUPABASE_SERVICE_ROLE_KEY;
const ANON = ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let pass = 0;
let fail = 0;
function check(ok, label, detail = '') {
  if (ok) {
    pass++;
    console.log(`  OK   ${label}${detail ? '  ' + detail : ''}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${detail ? '  ' + detail : ''}`);
  }
  return ok;
}

async function api(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON response */
  }
  return { status: res.status, json };
}

const email = `e2e_${Date.now()}@cloudcols.test`;
const password = `Pw-${crypto.randomUUID()}`;
let userId = '';

try {
  /* ---------------------------------------------------------------- account */
  const created = await fetch(`${SUPA}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const user = await created.json();
  userId = user.id ?? '';
  check(created.ok && userId, 'create account', email);

  const signIn = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const session = await signIn.json();
  const token = session.access_token;
  check(Boolean(token), 'sign in and receive a session');

  const me = await api('/api/auth/me', { token });
  check(me.status === 200, 'GET /api/auth/me', `HTTP ${me.status}`);

  /* ----------------------------------------------------------------- upload */
  // 689 KB, the size that failed in the prototype.
  const content = Buffer.from('x'.repeat(689 * 1024));
  const ticket = await api('/api/files/upload-ticket', {
    token,
    method: 'POST',
    body: { filename: 'e2e-report.txt', sizeBytes: content.length, mimeType: 'text/plain' },
  });
  const t = ticket.json?.data;
  check(ticket.status === 200 && t?.presignedUrl, 'upload ticket', `HTTP ${ticket.status}`);

  const put = await fetch(t.presignedUrl, { method: 'PUT', body: content });
  check(put.status === 200, 'PUT straight to Backblaze', `HTTP ${put.status} · ${content.length} bytes`);

  const confirm = await api('/api/files/confirm', {
    token,
    method: 'POST',
    body: { uploadId: t.uploadId, fileId: t.fileId },
  });
  const file = confirm.json?.data;
  check(confirm.status === 200 && file?.id, 'confirm upload', `HTTP ${confirm.status}`);
  check(Number(file?.sizeBytes ?? file?.size_bytes) === content.length, 'stored size matches what was declared');

  /* ------------------------------------------------------ metadata and quota */
  const list = await api('/api/files', { token });
  const files = list.json?.data?.items ?? [];
  check(list.status === 200, 'default listing does not error', `HTTP ${list.status}`);
  check(files.some((f) => f.id === file.id), 'file appears in the listing', `${files.length} item(s)`);

  const usage = await api('/api/files/usage', { token });
  const byCategory = Array.isArray(usage.json?.data) ? usage.json.data : [];
  const used = byCategory.reduce((sum, row) => sum + Number(row.bytes ?? 0), 0);
  check(usage.status === 200 && used === content.length, 'quota counted the upload', `used=${used}`);

  /* --------------------------------------------------------------- download */
  const dl = await api(`/api/files/download?fileId=${file.id}`, { token });
  const url = dl.json?.data?.url ?? dl.json?.data?.presignedUrl ?? dl.json?.data?.downloadUrl;
  check(dl.status === 200 && Boolean(url), 'download URL issued', `HTTP ${dl.status}`);
  if (url) {
    const bytes = await fetch(url);
    const body = await bytes.arrayBuffer();
    check(bytes.status === 200 && body.byteLength === content.length, 'bytes come back from storage', `${body.byteLength} bytes`);
  }

  /* ----------------------------------------------------------------- share */
  const share = await api('/api/shares', {
    token,
    method: 'POST',
    body: { fileId: file.id, permission: 'download' },
  });
  const link = share.json?.data;
  check(share.status === 200 && link?.token, 'create share link', `HTTP ${share.status}`);

  if (link?.token) {
    // Anonymous: no Authorization header at all.
    const resolved = await api(`/api/shares/resolve?token=${encodeURIComponent(link.token)}`);
    check(resolved.status === 200, 'anonymous visitor can resolve the share', `HTTP ${resolved.status}`);

    const revoked = await api(`/api/shares/${link.id}`, {
      token,
      method: 'PATCH',
      body: { isRevoked: true },
    });
    check([200, 204].includes(revoked.status), 'revoke the share', `HTTP ${revoked.status}`);

    const after = await api(`/api/shares/resolve?token=${encodeURIComponent(link.token)}`);
    check(after.status !== 200, 'revoked share stops resolving', `HTTP ${after.status}`);
  }

  /* -------------------------------------------------------- trash and restore */
  const trashed = await api(`/api/files/${file.id}`, { token, method: 'DELETE' });
  check([200, 204].includes(trashed.status), 'move to trash', `HTTP ${trashed.status}`);

  const restored = await api(`/api/files/${file.id}/restore`, { token, method: 'POST' });
  check([200, 204].includes(restored.status), 'restore from trash', `HTTP ${restored.status}`);

  /* ------------------------------------------------------- permission check */
  const other = await fetch(`${SUPA}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email: `e2e_other_${Date.now()}@cloudcols.test`, password, email_confirm: true }),
  });
  const otherUser = await other.json();
  const otherSignIn = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email: otherUser.email, password }),
  });
  const otherToken = (await otherSignIn.json()).access_token;

  const stolen = await api(`/api/files/download?fileId=${file.id}`, { token: otherToken });
  check(stolen.status !== 200, "another account cannot download someone else's file", `HTTP ${stolen.status}`);

  const noAuth = await api('/api/files');
  check(noAuth.status === 401, 'unauthenticated request is refused', `HTTP ${noAuth.status}`);

  await fetch(`${SUPA}/auth/v1/admin/users/${otherUser.id}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
} catch (e) {
  fail++;
  console.log('  FAIL unexpected error:', e.message);
} finally {
  if (userId) {
    await fetch(`${SUPA}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    }).catch(() => {});
  }
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
