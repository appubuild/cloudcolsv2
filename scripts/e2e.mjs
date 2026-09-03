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
  /* ------------------------------------------------- what the browser receives */
  // Sign-in runs in the browser against Supabase directly, using configuration the
  // server puts into the page. Every other check here talks to Supabase with
  // credentials read from a file, so all of them passed while the real sign-in form
  // said "Supabase not configured on this deployment".
  //
  // This takes the values out of the served HTML — exactly what the browser gets —
  // and signs in with them.
  const loginHtml = await (await fetch(`${BASE}/login`)).text();
  const pageUrl = loginHtml.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0] ?? "";
  const pageKey = loginHtml.match(/(sb_publishable_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_.-]{40,})/)?.[0] ?? "";
  check(Boolean(pageUrl), "the login page carries a Supabase URL for the browser", pageUrl || "none");
  check(Boolean(pageKey), "the login page carries a publishable key for the browser");
  check(!loginHtml.includes("demo@cloudcols.com"), "no demo credentials offered on a real deployment");

  /* ---------------------------------------------------------------- account */
  const created = await fetch(`${SUPA}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const user = await created.json();
  userId = user.id ?? '';
  check(created.ok && userId, 'create account', email);

  // Deliberately using the values the page handed the browser, so a deployment
  // that serves the wrong ones fails here rather than looking healthy.
  const signIn = await fetch(`${pageUrl || SUPA}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: pageKey || ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const session = await signIn.json();
  const token = session.access_token;
  check(Boolean(token), 'sign in with the config the browser was given', session.error_description ?? '');

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

  /* ---------------------------------------------------- upload into a folder */
  // A file uploaded while a folder was open used to land at the root: the upload
  // ticket never carried the folder, so the server had nothing to file it under.
  const folderRes = await api("/api/folders", {
    token,
    method: "POST",
    body: { name: `E2E ${Date.now()}`, parentId: null },
  });
  const folder = folderRes.json?.data;
  check(folderRes.status === 200 && folder?.id, "create a folder", `HTTP ${folderRes.status}`);

  if (folder?.id) {
    const inner = Buffer.from("inside the folder");
    const it = await api("/api/files/upload-ticket", {
      token,
      method: "POST",
      body: { filename: "in-folder.txt", sizeBytes: inner.length, mimeType: "text/plain", folderId: folder.id },
    });
    const itk = it.json?.data;
    check(it.status === 200 && itk?.presignedUrl, "upload ticket for a folder", `HTTP ${it.status}`);

    await fetch(itk.presignedUrl, { method: "PUT", body: inner });
    const ic = await api("/api/files/confirm", {
      token,
      method: "POST",
      body: { uploadId: itk.uploadId, fileId: itk.fileId },
    });
    check(ic.status === 200, "confirm the upload into the folder", `HTTP ${ic.status}`);

    const inFolder = await api(`/api/files?folderId=${folder.id}`, { token });
    const insideIds = (inFolder.json?.data?.items ?? []).map((f) => f.id);
    check(insideIds.includes(itk.fileId), "the file is inside the folder it was uploaded to");

    const atRoot = await api("/api/files?folderId=null", { token });
    const rootIds = (atRoot.json?.data?.items ?? []).map((f) => f.id);
    check(!rootIds.includes(itk.fileId), "and not sitting at the root as well");
  }

  /* --------------------------------------------------------- storage counted */
  // The sidebar showed 0 B used however much had been uploaded: /api/auth/me
  // answers in camelCase and the client read snake_case, so every field fell back
  // to its default.
  const meAfter = await api("/api/auth/me", { token });
  const usedBytes = Number(meAfter.json?.data?.storageUsedBytes ?? 0);
  check(usedBytes > 0, "used storage is reported to the client", `${usedBytes} bytes`);
  check(
    Object.prototype.hasOwnProperty.call(meAfter.json?.data ?? {}, "storageQuotaBytes"),
    "the quota field is named the way the client reads it",
  );

  /* ------------------------------------------------------------ categories */
  // A PNG was landing in "Other" with a generic icon and no preview. Two paths
  // have to work: the browser-supplied MIME type, and the extension fallback for
  // when the browser supplies none — which it does for anything it does not
  // recognise, and which had no image, video or audio entries at all.
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  for (const [label, mimeType] of [
    ["with a MIME type", "image/png"],
    ["with no MIME type", undefined],
  ]) {
    const pt = await api("/api/files/upload-ticket", {
      token,
      method: "POST",
      body: { filename: "photo.png", sizeBytes: PNG.length, ...(mimeType ? { mimeType } : {}) },
    });
    const pticket = pt.json?.data;
    if (!pticket?.presignedUrl) {
      check(false, `PNG ticket ${label}`, `HTTP ${pt.status}`);
      continue;
    }
    await fetch(pticket.presignedUrl, { method: "PUT", body: PNG });
    const pc = await api("/api/files/confirm", {
      token,
      method: "POST",
      body: { uploadId: pticket.uploadId, fileId: pticket.fileId },
    });
    check(pc.json?.data?.category === "image", `PNG is categorised as an image ${label}`, `got "${pc.json?.data?.category}"`);
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
