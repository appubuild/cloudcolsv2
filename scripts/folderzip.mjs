/**
 * Folder archive probe: what the browser is given to build a zip from.
 *
 * The zip itself is assembled in the browser (lib/services/folderZip.ts). What must be
 * right on the server, and is checked here, is the listing behind it: the whole tree
 * and nothing outside it, correct relative paths, paging that terminates, URLs that
 * actually deliver the bytes, and the same refusals every other file route makes.
 *
 * Usage, with the app running under `wrangler dev --port 8792`:
 *
 *   node scripts/folderzip.mjs .dev.vars
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
const PASSWORD = 'Folderzip-passw0rd!';

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

class Browser {
  constructor() {
    this.cookies = {};
  }
  jar() {
    return Object.entries(this.cookies)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
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

async function makeUser(b, tag) {
  const email = `folderzip_${tag}_${Date.now()}@cloudcols.test`;
  const r = await b.call('/api/auth/signup', { method: 'POST', body: { name: `Zip ${tag}`, email, password: PASSWORD } });
  return { id: r.data?.user?.id ?? null, email };
}

async function upload(b, folderId, name, content) {
  const ticket = await b.call('/api/files/upload-ticket', {
    method: 'POST',
    body: { filename: name, sizeBytes: content.length, mimeType: 'text/plain', folderId },
  });
  const fileId = ticket.data?.fileId;
  if (!fileId) return null;
  await fetch(ticket.data.presignedUrl, { method: 'PUT', body: content });
  await b.call('/api/files/confirm', { method: 'POST', body: { uploadId: fileId, fileId } });
  return fileId;
}

const owner = new Browser();
const other = new Browser();
let ownerId = null;
let otherId = null;

async function main() {
  console.log('\nFolder archive probe\n');
  const a = await makeUser(owner, 'owner');
  const b = await makeUser(other, 'other');
  ownerId = a.id;
  otherId = b.id;
  if (!check(ownerId && otherId, 'two accounts created')) return 1;

  // A tree: Holiday/ (two files) and Holiday/Raw/ (one file), plus a file outside it.
  const top = await owner.call('/api/folders', { method: 'POST', body: { parentId: null, name: 'Holiday' } });
  const topId = top.data?.id;
  const sub = await owner.call('/api/folders', { method: 'POST', body: { parentId: topId, name: 'Raw' } });
  const subId = sub.data?.id;
  const outside = await owner.call('/api/folders', { method: 'POST', body: { parentId: null, name: 'Elsewhere' } });
  check(Boolean(topId && subId && outside.data?.id), 'folder tree created');

  await upload(owner, topId, 'beach.txt', 'beach!');
  await upload(owner, topId, 'sunset.txt', 'sunset!!');
  const rawId = await upload(owner, subId, 'IMG_0001.txt', 'raw file');
  await upload(owner, outside.data?.id, 'secret.txt', 'not in the archive');
  check(Boolean(rawId), 'files uploaded');

  console.log('\nListing');
  const first = await owner.call(`/api/folders/${topId}/archive`);
  const entries = first.data?.entries ?? [];
  const paths = entries.map((e) => e.path).sort();
  check(first.status === 200, 'the folder lists', `HTTP ${first.status} ${first.code ?? ''}`);
  check(paths.length === 3, 'every file in the tree, once', JSON.stringify(paths));
  check(paths.includes('beach.txt') && paths.includes('sunset.txt'), 'files at the top keep their own name');
  check(paths.includes('Raw/IMG_0001.txt'), 'a subfolder becomes a path inside the archive');
  check(!paths.some((p) => p.includes('secret')), 'nothing from outside the folder');
  check(first.data?.fileCount === 3, 'the count is reported for progress', String(first.data?.fileCount));
  check(first.data?.nextCursor === null, 'and one page was enough');
  check(
    entries.every((e) => e.sizeBytes > 0 && typeof e.url === 'string' && e.url.startsWith('http')),
    'each entry has a size and a URL',
  );

  console.log('\nThe URLs deliver the bytes');
  {
    const entry = entries.find((e) => e.path === 'Raw/IMG_0001.txt');
    const res = await fetch(entry.url, { headers: { cookie: owner.jar() } });
    const body = await res.text();
    check(res.status === 200 && body === 'raw file', 'the file arrives, with its content', `HTTP ${res.status}`);
    check(/attachment/i.test(res.headers.get('content-disposition') ?? ''), 'as an attachment', res.headers.get('content-disposition') ?? '');
    // Owner-binding is the CDN's to enforce: it checks the ticket against the
    // delivery cookie. Without a CDN configured, delivery falls back to a presigned
    // storage URL, which is a bearer URL by nature — so the check only applies when
    // the URL actually points at the CDN.
    const viaCdn = new URL(entry.url).hostname.startsWith('cdn.');
    if (viaCdn) {
      const stranger = await fetch(entry.url);
      check(stranger.status !== 200, 'and a copied URL alone does not open it', `HTTP ${stranger.status}`);
    } else {
      console.log('  --   binding not checked: no CDN configured here, so this is a presigned storage URL');
    }
  }

  console.log('\nPaging');
  {
    const p1 = await owner.call(`/api/folders/${topId}/archive?limit=1`);
    check(p1.data?.entries?.length === 1 && Boolean(p1.data?.nextCursor), 'a page respects the limit and offers a cursor');
    const seen = new Set((p1.data?.entries ?? []).map((e) => e.fileId));
    let cursor = p1.data?.nextCursor ?? null;
    let pages = 1;
    while (cursor && pages < 10) {
      const next = await owner.call(`/api/folders/${topId}/archive?limit=1&cursor=${encodeURIComponent(cursor)}`);
      for (const e of next.data?.entries ?? []) seen.add(e.fileId);
      cursor = next.data?.nextCursor ?? null;
      pages += 1;
    }
    check(cursor === null, 'paging ends', `after ${pages} pages`);
    check(seen.size === 3, 'and covers every file exactly once', `${seen.size} files`);
  }

  console.log('\nWho may ask');
  {
    const theirs = await other.call(`/api/folders/${topId}/archive`);
    check(theirs.status === 404, 'another account cannot list the folder', `HTTP ${theirs.status}`);
    const anon = await new Browser().call(`/api/folders/${topId}/archive`);
    check(anon.status === 401, 'nor can a stranger', `HTTP ${anon.status}`);
    const missing = await owner.call('/api/folders/11111111-1111-1111-1111-111111111111/archive');
    check(missing.status === 404, 'a folder that does not exist is a 404', `HTTP ${missing.status}`);
  }

  console.log('\nA shared folder');
  {
    const share = await owner.call('/api/shares', { method: 'POST', body: { folderId: topId, permission: 'download' } });
    const token = share.data?.token;
    check(share.status === 200 && Boolean(token), 'the folder can be shared', `HTTP ${share.status}`);
    const listed = await new Browser().call(`/api/shares/archive?token=${encodeURIComponent(token)}`);
    const sharedPaths = (listed.data?.entries ?? []).map((e) => e.path).sort();
    check(listed.status === 200 && sharedPaths.length === 3, 'a recipient gets the same listing', `HTTP ${listed.status} ${JSON.stringify(sharedPaths)}`);
    const one = (listed.data?.entries ?? []).find((e) => e.path === 'beach.txt');
    const got = await fetch(one.url);
    check(got.status === 200 && (await got.text()) === 'beach!', 'and the files download without an account', `HTTP ${got.status}`);
    const bogus = await new Browser().call('/api/shares/archive?token=definitely-not-real');
    check(bogus.status === 404, 'an unknown token gets nothing', `HTTP ${bogus.status}`);
    await owner.call(`/api/shares/${share.data.id}`, { method: 'PATCH' });
    const revoked = await new Browser().call(`/api/shares/archive?token=${encodeURIComponent(token)}`);
    check(revoked.status === 410 || revoked.status === 404, 'a revoked link stops listing', `HTTP ${revoked.status}`);
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  return fail === 0 ? 0 : 1;
}

async function cleanUp() {
  for (const id of [ownerId, otherId]) {
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
