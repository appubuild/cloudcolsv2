/**
 * Authorization probe: what each kind of caller is refused.
 *
 * scripts/e2e.mjs walks the path a user takes and ends with two refusals. This walks
 * the refusals themselves — every boundary the product depends on, asserted from the
 * outside against a running Worker.
 *
 * Four callers:
 *   anonymous          no credentials at all
 *   user               an ordinary account
 *   other              a second account, to prove tenant isolation
 *   support admin      staff, but not super_admin
 *
 * A super_admin token is not minted here on purpose: the point is what the *lower*
 * privileges cannot reach. Anything a support admin can do that only a super_admin
 * should is a finding.
 *
 * Usage, with the app running under `wrangler dev --port 8792`:
 *
 *   node scripts/authz.mjs .dev.vars
 *
 * Creates throwaway accounts under @cloudcols.test and removes them, along with the
 * temporary admins row it needs, afterwards.
 */
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

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

let pass = 0;
let fail = 0;

function check(ok, label, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  OK   ${label}${detail ? '  ' + detail : ''}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label}${detail ? '  ' + detail : ''}`);
  }
  return ok;
}

async function call(path, { token, method = 'GET', body } = {}) {
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
    /* not JSON */
  }
  return { status: res.status, json, code: json?.error?.code };
}

/**
 * Asserts a call is refused, and that it is refused for the stated reason.
 *
 * Retried once on a mismatch. `requireUser` verifies every token by calling Supabase
 * Auth over the network, so a request can come back 401 because that round trip was
 * slow rather than because the caller was wrong — observed at 19 seconds under the
 * load this probe generates. A real authorization regression fails both attempts; a
 * retry that succeeds is reported, because the latency underneath it is its own
 * finding.
 */
async function refused(label, path, opts, expected) {
  const statuses = Array.isArray(expected) ? expected : [expected];
  let r = await call(path, opts);
  let note = '';

  if (!statuses.includes(r.status)) {
    const first = r.status;
    await new Promise((res) => setTimeout(res, 500));
    r = await call(path, opts);
    if (statuses.includes(r.status)) note = ` (first attempt answered ${first}; the token check is a network call)`;
  }

  check(statuses.includes(r.status), label, `HTTP ${r.status}${r.code ? ' ' + r.code : ''}${note}`);
  return r;
}

async function supabase(path, { method = 'POST', body } = {}) {
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
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function makeUser(tag) {
  const email = `authz_${tag}_${Date.now()}@cloudcols.test`;
  const password = 'Authz-passw0rd!';
  const signup = await call('/api/auth/signup', { method: 'POST', body: { name: `Authz ${tag}`, email, password } });
  const id = signup.json?.data?.user?.id;
  const tokenRes = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const { access_token: token } = await tokenRes.json();
  return { id, email, token };
}

function mintAdminToken(email, role) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({ sub: 'authz-probe', email, role, exp: Date.now() + 600000 });
  const sig = createHmac('sha256', ENV.ADMIN_TOKEN_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

// What the probe created, so cleanUp() can remove it however main() ends.
const cleanup = [];
const adminEmails = [];

async function main() {
  console.log('\nAuthorization probe\n');

  const user = await makeUser('user');
  const other = await makeUser('other');
  cleanup.push(user.id, other.id);
  if (!user.token || !other.token) {
    console.log('  FAIL could not create test accounts');
    return 1;
  }

  // A support admin, created for the probe and removed at the end.
  adminEmails.push(other.email);
  await supabase('/rest/v1/admins', {
    body: { email: other.email, name: 'Authz probe', role: 'support', is_active: true, user_id: other.id },
  });
  const supportToken = mintAdminToken(other.email, 'support');

  console.log('Anonymous callers');
  await refused('cannot list files', '/api/files', {}, 401);
  await refused('cannot read a profile', '/api/auth/me', {}, 401);
  await refused('cannot get an upload ticket', '/api/files/upload-ticket', { method: 'POST', body: { filename: 'x', sizeBytes: 1 } }, 401);
  await refused('cannot reach admin stats', '/api/admin/stats', {}, 401);
  await refused('cannot write settings', '/api/admin/settings', { method: 'PATCH', body: { settings: { maintenance_mode: true } } }, 401);
  await refused('cannot write a page', '/api/admin/pages', { method: 'PUT', body: { title: 'x', html: '<p>x</p>' } }, 401);
  await refused('cannot run a job', '/api/jobs/run', { method: 'POST', body: { name: 'trash-cleanup' } }, [401, 503]);
  {
    const r = await call('/api/settings');
    check(r.status === 200, 'may read public settings', `HTTP ${r.status}`);
    check(
      r.json?.data && !('inactivity_warn_days' in r.json.data) && !('allowed_upload_mime_deny' in r.json.data),
      'public settings expose no private keys',
    );
  }

  console.log('\nA forged or malformed admin token');
  await refused('a made-up token is refused', '/api/admin/stats', { token: 'aaa.bbb.ccc' }, 401);
  await refused('a user token is not an admin token', '/api/admin/stats', { token: user.token }, 401);
  {
    // A well-formed token whose signature is wrong: the last character flipped.
    const good = mintAdminToken(other.email, 'super_admin');
    const tampered = good.slice(0, -1) + (good.slice(-1) === 'A' ? 'B' : 'A');
    await refused('a tampered signature is refused', '/api/admin/stats', { token: tampered }, 401);
  }
  {
    // Correctly signed, but for an address that is not staff.
    const stranger = mintAdminToken('nobody@example.com', 'super_admin');
    await refused('a signed token for a non-admin address is refused', '/api/admin/stats', { token: stranger }, 403);
  }

  console.log('\nOne user against another');
  // Give `user` a file to guard.
  const ticket = await call('/api/files/upload-ticket', {
    token: user.token,
    method: 'POST',
    body: { filename: 'authz.txt', sizeBytes: 12, mimeType: 'text/plain' },
  });
  const fileId = ticket.json?.data?.fileId;
  if (fileId) {
    await fetch(ticket.json.data.presignedUrl, { method: 'PUT', body: 'hello world!' });
    await call('/api/files/confirm', { token: user.token, method: 'POST', body: { uploadId: fileId, fileId } });

    await refused('cannot read the file', `/api/files/${fileId}`, { token: other.token }, 404);
    await refused('cannot download it', `/api/files/download?fileId=${fileId}`, { token: other.token }, 404);
    await refused('cannot ask for its thumbnail', `/api/files/download?fileId=${fileId}&variant=thumb`, { token: other.token }, 404);
    await refused('cannot claim a thumbnail slot on it', `/api/files/${fileId}/thumbnail`, { token: other.token, method: 'POST', body: {} }, 404);
    await refused('cannot rename it', `/api/files/${fileId}`, { token: other.token, method: 'PATCH', body: { originalFilename: 'stolen.txt' } }, 404);
    await refused('cannot trash it', `/api/files/${fileId}`, { token: other.token, method: 'DELETE' }, 404);
    await refused('cannot ask for multipart URLs on it', `/api/files/${fileId}/parts`, { token: other.token, method: 'POST', body: { uploadId: 'x', partNumbers: [1] } }, 404);
    await refused('cannot restore it from trash', `/api/files/${fileId}/restore`, { token: other.token, method: 'POST' }, 404);
    await refused('cannot permanently destroy it', `/api/files/${fileId}?force=true`, { token: other.token, method: 'DELETE' }, 404);
    // POST /api/shares used to insert whatever id it was given, with the service-role
    // client, so a stranger could mint a public link to this file under their own name.
    await refused('cannot make a share link to it', '/api/shares', { token: other.token, method: 'POST', body: { fileId, permission: 'download' } }, 404);
    {
      const own = await call('/api/shares', { token: user.token, method: 'POST', body: { fileId, permission: 'view' } });
      check(own.status === 200 && Boolean(own.json?.data?.token), 'while the owner can share it', `HTTP ${own.status}`);
    }

    const still = await call(`/api/files/${fileId}`, { token: user.token });
    check(still.status === 200, 'and the owner still has it', `HTTP ${still.status}`);
  } else {
    check(false, 'could not create a file to guard');
  }

  console.log('\nOne user against another folder');
  {
    const folder = await call('/api/folders', { token: user.token, method: 'POST', body: { parentId: null, name: 'authz-folder' } });
    const folderId = folder.json?.data?.id;
    if (folderId) {
      // All three ran an ownership-scoped UPDATE through .single(), which treats "no
      // rows" as an error — so a refusal answered 500 with a Postgres error code
      // rather than 404, and the not-found branch below it was unreachable.
      await refused('cannot rename the folder', `/api/folders/${folderId}`, { token: other.token, method: 'PATCH', body: { name: 'stolen' } }, 404);
      await refused('cannot pin it', `/api/folders/${folderId}`, { token: other.token, method: 'PATCH', body: { togglePin: true } }, 404);
      await refused('cannot trash it', `/api/folders/${folderId}`, { token: other.token, method: 'DELETE' }, 404);
      const mine = await call('/api/folders', { token: user.token });
      check(
        (mine.json?.data ?? []).some((f) => f.id === folderId && f.name === 'authz-folder'),
        'and the owner still has it, unrenamed',
      );
    } else {
      check(false, 'could not create a folder to guard');
    }
  }

  console.log('\nA support admin against super_admin territory');
  {
    const ok = await call('/api/admin/users', { token: supportToken });
    check(ok.status === 200, 'may list accounts', `HTTP ${ok.status}`);
  }
  await refused('may not read the audit trail', '/api/admin/audit', { token: supportToken }, 403);
  await refused('may not list staff', '/api/admin/staff', { token: supportToken }, 403);
  await refused('may not change a plan', '/api/admin/plans', { token: supportToken, method: 'PATCH', body: { id: 'plan_pro', priceCents: 1 } }, 403);
  await refused('may not change settings', '/api/admin/settings', { token: supportToken, method: 'PATCH', body: { settings: { registration_enabled: false } } }, 403);
  await refused('may not publish a page', '/api/admin/pages', { token: supportToken, method: 'PUT', body: { title: 'x', html: '<p>x</p>' } }, 403);
  await refused('may not suspend an account', `/api/admin/users/${user.id}`, { token: supportToken, method: 'PATCH', body: { action: 'suspend', reason: 'probe' } }, 403);
  if (fileId) {
    await refused('may not quarantine a file', `/api/admin/files/${fileId}`, { token: supportToken, method: 'PATCH', body: { action: 'quarantine', reason: 'probe' } }, 403);
  }

  console.log('\nMoney');
  await refused('the removed plan-change route is gone', '/api/plan/change', { token: user.token, method: 'POST', body: { planId: 'plan_business' } }, 404);
  {
    const free = await call('/api/subscriptions/checkout', { token: user.token, method: 'POST', body: { planId: 'plan_free' } });
    check(free.json?.data?.status === 'applied', 'a downgrade to free needs no payment', String(free.json?.data?.status));
    const paid = await call('/api/subscriptions/checkout', { token: user.token, method: 'POST', body: { planId: 'plan_business' } });
    check(
      paid.json?.data?.status !== 'applied',
      'a paid plan is never granted by asking',
      `${paid.status} ${paid.code ?? paid.json?.data?.status}`,
    );
    const me = await call('/api/auth/me', { token: user.token });
    check(me.json?.data?.planId === 'plan_free', 'and the account is still on free', String(me.json?.data?.planId));
  }
  await refused('an unsigned Stripe webhook is refused', '/api/webhooks/stripe', { method: 'POST', body: { type: 'checkout.session.completed' } }, 400);
  await refused('an unknown plan is refused', '/api/subscriptions/checkout', { token: user.token, method: 'POST', body: { planId: 'plan_free_but_huge' } }, 404);
  await refused('a prototype key is not a plan', '/api/subscriptions/checkout', { token: user.token, method: 'POST', body: { planId: '__proto__' } }, 404);

  console.log('\nStorage limits');
  await refused(
    'an upload past the quota is refused',
    '/api/files/upload-ticket',
    { token: user.token, method: 'POST', body: { filename: 'huge.bin', sizeBytes: 999 * 1024 * 1024 * 1024 } },
    413,
  );
  await refused(
    'a folder belonging to someone else is refused',
    '/api/files/upload-ticket',
    { token: other.token, method: 'POST', body: { filename: 'x.txt', sizeBytes: 10, folderId: '00000000-0000-0000-0000-000000000000' } },
    404,
  );

  console.log('\nShare links');
  await refused('an unknown token resolves to nothing', '/api/shares/resolve?token=definitely-not-real', {}, 404);
  await refused('and cannot be downloaded', '/api/shares/download?token=definitely-not-real', {}, 404);

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  return fail === 0 ? 0 : 1;
}

/**
 * Removes what the probe created — also when it crashed half way, which used to leave
 * its accounts and a live support-admin row behind (a network timeout to storage did
 * exactly that). Each account's storage folder is queued for the purge job before the
 * account goes: deleting a user removes its rows, not its bytes.
 */
async function cleanUp() {
  for (const email of adminEmails) {
    await supabase(`/rest/v1/admins?email=eq.${encodeURIComponent(email)}`, { method: 'DELETE' });
  }
  for (const id of cleanup) {
    if (!id) continue;
    await supabase('/rest/v1/storage_purge_queue', { body: { prefix: `${id}/`, reason: 'probe_cleanup' } });
    await fetch(`${SUPA}/auth/v1/admin/users/${id}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` },
    });
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
