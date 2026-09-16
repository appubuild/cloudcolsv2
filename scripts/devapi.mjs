/**
 * Developer API probe: the documented /v1 endpoints, with a real key.
 *
 * The docs page has listed these endpoints since before any of them existed. This
 * walks the whole flow a developer would — key, upload, confirm, read, share, search,
 * delete — and the refusals that keep one account's key away from another's files.
 *
 * Usage, with the app running under `wrangler dev --port 8792`:
 *
 *   node scripts/devapi.mjs .dev.vars
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.PROBE_BASE ?? 'http://127.0.0.1:8792';
const ENV = Object.fromEntries(
  readFileSync(process.argv[2] ?? '.dev.vars', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const SUPA = ENV.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = ENV.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = 'Devapi-passw0rd!';

let pass = 0;
let fail = 0;
function check(ok, label, detail = '') {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`);
  return ok;
}

function cookiesOf(res) {
  const out = {};
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const pair = line.split(';')[0];
    const eq = pair.indexOf('=');
    out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
}

/** A signed-in browser, for the pages a developer uses to manage their keys. */
class Browser {
  constructor() {
    this.cookies = {};
  }
  jar() {
    return Object.entries(this.cookies).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ');
  }
  async call(path, { method = 'GET', body } = {}) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { origin: BASE, ...(body ? { 'content-type': 'application/json' } : {}), cookie: this.jar() },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    Object.assign(this.cookies, cookiesOf(res));
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* not JSON */
    }
    return { status: res.status, json, data: json?.data, code: json?.error?.code };
  }
}

/** A developer's client: an API key and nothing else. */
async function api(key, path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(key ? { authorization: `Bearer ${key}` } : {}),
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
  return { status: res.status, json, data: json?.data, code: json?.error?.code, res };
}

async function rest(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${SUPA}${path}`, {
    method,
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json', prefer: 'return=representation' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  try {
    return { status: res.status, json: await res.json() };
  } catch {
    return { status: res.status, json: null };
  }
}

const dev = new Browser();
const stranger = new Browser();
let devId = null;
let strangerId = null;

async function main() {
  console.log('\nDeveloper API probe\n');
  const a = await dev.call('/api/auth/signup', { method: 'POST', body: { name: 'Dev', email: `devapi_${Date.now()}@cloudcols.test`, password: PASSWORD } });
  const b = await stranger.call('/api/auth/signup', { method: 'POST', body: { name: 'Other', email: `devapi_other_${Date.now()}@cloudcols.test`, password: PASSWORD } });
  devId = a.data?.user?.id ?? null;
  strangerId = b.data?.user?.id ?? null;
  if (!check(devId && strangerId, 'two accounts created')) return 1;

  console.log('\nKeys');
  // shares.write is asked for explicitly: the default scopes are read and write on
  // files, and sharing is a separate capability a key does not get unless requested.
  const created = await dev.call('/api/dev/keys', {
    method: 'POST',
    body: { label: 'Probe key', scopes: ['files.read', 'files.write', 'shares.write'] },
  });
  const key = created.data?.secret;
  check(created.status === 200 && Boolean(key), 'a key is issued once', `HTTP ${created.status}`);
  check(created.data?.key?.apiPlanId === 'api_free', 'on the free plan, not the paid one', String(created.data?.key?.apiPlanId));
  {
    const listed = await dev.call('/api/dev/keys');
    check((listed.data ?? []).every((k) => !k.hashedKey), 'the listing never returns the secret or its hash');
    const bad = await dev.call('/api/dev/keys', { method: 'POST', body: { label: 'Bad', scopes: ['files.read', 'files.destroy'] } });
    check(bad.status === 400, 'an unknown scope is refused rather than stored', `HTTP ${bad.status} ${bad.code ?? ''}`);
  }
  const readOnly = (await dev.call('/api/dev/keys', { method: 'POST', body: { label: 'Read only', scopes: ['files.read'] } })).data?.secret;
  check(Boolean(readOnly), 'a second, read-only key is issued');

  console.log('\nAuthentication');
  check((await api(null, '/v1/files')).status === 401, 'no key is refused');
  check((await api('cc_live_definitely_not_real', '/v1/files')).status === 401, 'a made-up key is refused');
  {
    const viaHeader = await api(null, '/v1/files', { headers: { 'x-api-key': key } });
    check(viaHeader.status === 200, 'x-api-key works as well as a Bearer token', `HTTP ${viaHeader.status}`);
    const rewritten = await api(key, '/v1/files');
    check(rewritten.status === 200, 'the documented /v1 path works', `HTTP ${rewritten.status}`);
    const preflight = await fetch(`${BASE}/v1/files`, { method: 'OPTIONS', headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'GET' } });
    check(preflight.status === 204, 'a browser preflight is answered', `HTTP ${preflight.status}`);
  }

  console.log('\nUpload');
  let fileId = null;
  {
    const content = 'developer api upload';
    const ticket = await api(key, '/v1/files/upload', { method: 'POST', body: { filename: 'report.txt', sizeBytes: content.length, mimeType: 'text/plain' } });
    fileId = ticket.data?.fileId ?? null;
    check(ticket.status === 200 && Boolean(ticket.data?.uploadUrl), 'an upload URL is issued', `HTTP ${ticket.status} ${ticket.code ?? ''}`);
    check(ticket.data?.confirmWith === `/v1/files/${fileId}/confirm`, 'and says how to confirm it');
    const put = await fetch(ticket.data.uploadUrl, { method: 'PUT', body: content });
    check(put.ok, 'the bytes go straight to storage', `HTTP ${put.status}`);
    const before = await api(key, `/v1/files/${fileId}`);
    check(before.data?.status === 'pending', 'before confirming, the file is pending');
    const confirmed = await api(key, `/v1/files/${fileId}/confirm`, { method: 'POST' });
    check(confirmed.status === 200 && confirmed.data?.status === 'ready', 'confirming makes it real', `HTTP ${confirmed.status} ${confirmed.code ?? ''}`);
    check(confirmed.data?.objectKey === undefined, 'the storage key is never exposed');
  }
  {
    // The quota check at ticket time trusts the declared size; confirm must not.
    const ticket = await api(key, '/v1/files/upload', { method: 'POST', body: { filename: 'liar.txt', sizeBytes: 5_000_000, mimeType: 'text/plain' } });
    await fetch(ticket.data.uploadUrl, { method: 'PUT', body: 'tiny' });
    const confirmed = await api(key, `/v1/files/${ticket.data.fileId}/confirm`, { method: 'POST' });
    check(confirmed.status === 422, 'a file smaller than declared is rejected', `HTTP ${confirmed.status} ${confirmed.code ?? ''}`);
  }

  console.log('\nReading');
  {
    const list = await api(key, '/v1/files');
    check(list.status === 200 && list.data?.files?.length === 1, 'the file is listed', `HTTP ${list.status} ${list.data?.files?.length} file(s)`);
    check(list.data?.total === 1 && list.data?.limit === 25, 'with a total and paging');
    const search = await api(key, '/v1/search?q=repo');
    check(search.data?.files?.[0]?.id === fileId, 'search finds it by name');
    const empty = await api(key, '/v1/search?q=nothinglikethis');
    check(empty.data?.files?.length === 0, 'and finds nothing that is not there');
    const noQuery = await api(key, '/v1/search');
    check(noQuery.status === 400, 'search without a term is a 400', `HTTP ${noQuery.status}`);

    const dl = await api(key, `/v1/files/${fileId}/download-url`);
    check(dl.status === 200 && typeof dl.data?.url === 'string', 'a download URL is issued', `HTTP ${dl.status}`);
    const got = await fetch(dl.data.url);
    check(got.status === 200 && (await got.text()) === 'developer api upload', 'and it delivers the bytes', `HTTP ${got.status}`);
    const pv = await api(key, `/v1/files/${fileId}/preview-url`);
    check(pv.status === 200 && pv.data?.variant === 'file', 'a preview URL is issued', `HTTP ${pv.status}`);
    const thumb = await api(key, `/v1/files/${fileId}/preview-url?variant=thumb`);
    check(thumb.status === 404, 'and asking for a thumbnail that does not exist says so', `HTTP ${thumb.status}`);
  }

  console.log('\nFolders');
  {
    const folder = await dev.call('/api/folders', { method: 'POST', body: { parentId: null, name: 'API folder' } });
    const folderId = folder.data?.id;
    const list = await api(key, '/v1/folders');
    check(list.status === 200 && list.data?.folders?.some((f) => f.id === folderId), 'folders are listed', `HTTP ${list.status}`);
    const one = await api(key, `/v1/folders/${folderId}`);
    check(one.status === 200 && one.data?.folder?.name === 'API folder', 'a folder can be opened', `HTTP ${one.status}`);
    check(Array.isArray(one.data?.files) && Array.isArray(one.data?.folders), 'with its files and subfolders');
  }

  console.log('\nSharing');
  {
    const shared = await api(key, `/v1/files/${fileId}/share`, { method: 'POST', body: { permission: 'download' } });
    const shareToken = shared.data?.token;
    check(shared.status === 200 && typeof shareToken === 'string', 'a share link is created', `HTTP ${shared.status} ${shared.code ?? ''}`);
    check(String(shared.data?.url ?? '').includes(`/s/${shareToken}`), 'and comes back as a URL to send');
    if (shareToken) {
      const anyone = await fetch(`${BASE}/api/shares/download?token=${encodeURIComponent(shareToken)}`);
      check(anyone.status === 200, 'which works without an account', `HTTP ${anyone.status}`);
    }
    const readOnlyShare = await api(readOnly, `/v1/files/${fileId}/share`, { method: 'POST', body: {} });
    check(readOnlyShare.status === 403 && readOnlyShare.code === 'FORBIDDEN', 'a key without shares.write cannot share', `HTTP ${readOnlyShare.status}`);
  }

  console.log('\nOne key, one account');
  {
    const theirTicket = await stranger.call('/api/files/upload-ticket', { method: 'POST', body: { filename: 'theirs.txt', sizeBytes: 6, mimeType: 'text/plain' } });
    await fetch(theirTicket.data.presignedUrl, { method: 'PUT', body: 'theirs' });
    await stranger.call('/api/files/confirm', { method: 'POST', body: { uploadId: theirTicket.data.fileId, fileId: theirTicket.data.fileId } });
    const theirId = theirTicket.data.fileId;

    check((await api(key, `/v1/files/${theirId}`)).status === 404, "another account's file is not readable");
    check((await api(key, `/v1/files/${theirId}/download-url`)).status === 404, 'nor downloadable');
    check((await api(key, `/v1/files/${theirId}/share`, { method: 'POST', body: {} })).status === 404, 'nor shareable');
    check((await api(key, `/v1/files/${theirId}`, { method: 'DELETE' })).status === 404, 'nor deletable');
    const stillTheirs = await stranger.call(`/api/files/${theirId}`);
    check(stillTheirs.status === 200, 'and it is still theirs afterwards', `HTTP ${stillTheirs.status}`);
  }

  console.log('\nScopes and limits');
  {
    const write = await api(readOnly, '/v1/files/upload', { method: 'POST', body: { filename: 'no.txt', sizeBytes: 2 } });
    check(write.status === 403 && write.code === 'FORBIDDEN', 'a read-only key cannot upload', `HTTP ${write.status}`);
    const read = await api(readOnly, '/v1/files');
    check(read.status === 200, 'but can read', `HTTP ${read.status}`);
    const plan = await dev.call('/api/dev/plan');
    check(plan.status === 200 && plan.data?.planId === 'api_free', 'the account reports its real plan', String(plan.data?.planId));
    check(Number(plan.data?.requestsThisMonth) > 0, 'and its usage this month is counted', String(plan.data?.requestsThisMonth));
    const paid = await dev.call('/api/dev/plan', { method: 'POST', body: { planId: 'api_pro' } });
    check(paid.status === 402, 'a paid plan cannot be granted by asking for it', `HTTP ${paid.status} ${paid.code ?? ''}`);
  }

  console.log('\nDeleting');
  {
    const deleted = await api(key, `/v1/files/${fileId}`, { method: 'DELETE' });
    check(deleted.status === 200 && deleted.data?.permanent === false, 'delete puts a file in the trash', `HTTP ${deleted.status}`);
    const list = await api(key, '/v1/files');
    check(list.data?.files?.length === 0, 'and it leaves the listing');
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  return fail === 0 ? 0 : 1;
}

async function cleanUp() {
  for (const id of [devId, strangerId]) {
    if (!id) continue;
    await rest('/rest/v1/storage_purge_queue', { method: 'POST', body: { prefix: `${id}/`, reason: 'probe_cleanup' } });
    await rest(`/auth/v1/admin/users/${id}`, { method: 'DELETE' });
  }
}

main()
  .catch((e) => {
    console.error('probe crashed:', e);
    return 1;
  })
  .then(async (code) => {
    await cleanUp().catch((e) => console.error('cleanup failed:', e));
    process.exit(code);
  });
