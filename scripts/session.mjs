/**
 * Session probe: the web session in httpOnly cookies, from the outside.
 *
 * Checks what a browser would rely on and what an attacker would try:
 *   - sign-in sets httpOnly cookies and returns no token to page script
 *   - the cookies alone authenticate; a Bearer token still works for native clients
 *   - a cookie-authenticated write from another origin is refused
 *   - a lapsed access token is renewed from the refresh cookie, invisibly
 *   - signing out kills the refresh token at Supabase, not just in this browser
 *   - password reset and magic links work end to end, and a reset ends every session
 *   - the staff session is an httpOnly cookie too, with the same origin check
 *
 * Usage, with the app running under `wrangler dev --port 8792`:
 *
 *   node scripts/session.mjs .dev.vars
 *
 * Creates a throwaway account under @cloudcols.test and removes it afterwards.
 */
import { readFileSync } from 'node:fs';

// PROBE_BASE=https://cloudcols.com checks production instead of the local Worker.
const BASE = process.env.PROBE_BASE ?? 'http://127.0.0.1:8792';
const EVIL = 'https://evil.example';
const ENV = Object.fromEntries(
  readFileSync(process.argv[2] ?? '.dev.vars', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const SUPA = ENV.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = ENV.SUPABASE_SERVICE_ROLE_KEY;
const ANON = ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PASSWORD = 'Session-passw0rd!';
const NEW_PASSWORD = 'Session-passw0rd-2!';

let pass = 0;
let fail = 0;
function check(ok, label, detail = '') {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`);
  return ok;
}

/** Set-Cookie headers as { name: { value, attrs } }. */
function cookiesOf(res) {
  const out = {};
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const [pair, ...attrs] = line.split(';').map((s) => s.trim());
    const eq = pair.indexOf('=');
    out[pair.slice(0, eq)] = { value: pair.slice(eq + 1), attrs: attrs.join('; ') };
  }
  return out;
}

const jar = (cookies) =>
  Object.entries(cookies)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

async function call(path, { method = 'GET', body, cookie, origin, bearer, redirect = 'follow' } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    redirect,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(origin ? { origin } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* not JSON */
  }
  return { res, status: res.status, json, code: json?.error?.code, cookies: cookiesOf(res) };
}

async function rest(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${SUPA}${path}`, {
    method,
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json', prefer: 'return=representation' },
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

let userId = null;
let email = null;

async function main() {
  console.log('\nSession probe\n');
  email = `session_${Date.now()}@cloudcols.test`;
  const signup = await call('/api/auth/signup', { method: 'POST', origin: BASE, body: { name: 'Session probe', email, password: PASSWORD } });
  userId = signup.json?.data?.user?.id ?? null;
  if (!check(signup.status === 200 && userId, 'account created', `HTTP ${signup.status}`)) return 1;

  console.log('\nSigning in');
  const login = await call('/api/auth/login', { method: 'POST', origin: BASE, body: { email, password: PASSWORD } });
  const c = login.cookies;
  check(login.status === 200, 'login succeeds', `HTTP ${login.status}`);
  check(Boolean(c.cc_at?.value) && /HttpOnly/i.test(c.cc_at.attrs), 'access token is an httpOnly cookie');
  check(Boolean(c.cc_rt?.value) && /HttpOnly/i.test(c.cc_rt.attrs), 'refresh token is an httpOnly cookie');
  check(c.cc_signed_in?.value === '1' && !/HttpOnly/i.test(c.cc_signed_in.attrs), 'only a content-free hint is readable');
  check(!login.json?.data?.token && !login.json?.data?.refreshToken, 'no token in the response body');
  check(!/Domain=/i.test(c.cc_at?.attrs ?? ''), 'session cookies are host-only (never sent to the CDN)');
  const session = { cc_at: c.cc_at?.value, cc_rt: c.cc_rt?.value };

  const cross = await call('/api/auth/login', { method: 'POST', origin: EVIL, body: { email, password: PASSWORD } });
  check(cross.status === 403 && cross.code === 'CSRF_REJECTED', 'another site cannot sign a visitor in', `HTTP ${cross.status}`);

  console.log('\nUsing the session');
  const me = await call('/api/auth/me', { cookie: jar(session) });
  check(me.status === 200 && me.json?.data?.id === userId, 'the cookies alone authenticate', `HTTP ${me.status}`);
  {
    const ours = await call('/api/profile', { method: 'PATCH', cookie: jar(session), origin: BASE, body: { name: 'Session probe' } });
    check(ours.status === 200, 'a write from our own pages is accepted', `HTTP ${ours.status}`);
    const theirs = await call('/api/profile', { method: 'PATCH', cookie: jar(session), origin: EVIL, body: { name: 'pwned' } });
    check(theirs.status === 403 && theirs.code === 'CSRF_REJECTED', 'the same write from another site is refused', `HTTP ${theirs.status}`);
    const del = await call('/api/auth/delete', { method: 'POST', cookie: jar(session), origin: EVIL, body: { password: PASSWORD } });
    check(del.status === 403, 'another site cannot delete the account either', `HTTP ${del.status}`);
  }
  {
    const tokenRes = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    const { access_token } = await tokenRes.json();
    const viaBearer = await call('/api/auth/me', { bearer: access_token });
    check(viaBearer.status === 200, 'a Bearer token still works for native clients', `HTTP ${viaBearer.status}`);
    const bearerWrite = await call('/api/profile', { method: 'PATCH', bearer: access_token, origin: EVIL, body: { name: 'Session probe' } });
    check(bearerWrite.status === 200, 'and is not subject to the cookie origin check', `HTTP ${bearerWrite.status}`);
  }

  console.log('\nRenewal');
  {
    const lapsed = await call('/api/auth/me', { cookie: jar({ cc_at: 'expired.or.garbage', cc_rt: session.cc_rt }) });
    const renewed = lapsed.cookies.cc_at?.value;
    check(lapsed.status === 200, 'a lapsed access token is renewed from the refresh cookie', `HTTP ${lapsed.status}`);
    check(Boolean(renewed) && renewed !== session.cc_at, 'and new cookies come back on the same response');
    if (renewed) {
      session.cc_at = renewed;
      session.cc_rt = lapsed.cookies.cc_rt?.value ?? session.cc_rt;
    }
    const dead = await call('/api/auth/me', { cookie: jar({ cc_at: 'garbage', cc_rt: 'not-a-refresh-token' }) });
    check(dead.status === 401, 'a dead session is refused', `HTTP ${dead.status}`);
    check(dead.cookies.cc_at?.value === '' && dead.cookies.cc_signed_in?.value === '', 'and its cookies are cleared');
  }

  console.log('\nStaff session');
  await rest('/rest/v1/admins', { method: 'POST', body: { email, name: 'Session probe', role: 'support', is_active: true, user_id: userId } });
  {
    const s = await call('/api/admin/session', { cookie: jar(session) });
    const adminCookie = s.cookies.cc_admin;
    check(s.status === 200 && s.json?.data?.isAdmin === true, 'a staff account gets a staff session', `HTTP ${s.status}`);
    check(Boolean(adminCookie?.value) && /HttpOnly/i.test(adminCookie.attrs) && /SameSite=Strict/i.test(adminCookie.attrs), 'as an httpOnly, Strict cookie');
    check(!('token' in (s.json?.data ?? {})), 'with no token in the response body');
    const adminMe = await call('/api/admin/me', { cookie: jar({ cc_admin: adminCookie?.value }) });
    check(adminMe.status === 200 && adminMe.json?.data?.role === 'support', 'the staff cookie authenticates admin calls', `HTTP ${adminMe.status}`);
    const adminCross = await call('/api/admin/settings', { method: 'PATCH', cookie: jar({ cc_admin: adminCookie?.value }), origin: EVIL, body: { settings: { maintenance_mode: true } } });
    check(adminCross.status === 403 && adminCross.code === 'CSRF_REJECTED', 'a staff write from another site is refused', `HTTP ${adminCross.status}`);
    const out = await call('/api/admin/logout', { method: 'POST', cookie: jar({ cc_admin: adminCookie?.value }), origin: BASE });
    check(out.cookies.cc_admin?.value === '', 'staff sign-out clears the cookie');
  }
  await rest(`/rest/v1/admins?email=eq.${encodeURIComponent(email)}`, { method: 'DELETE' });

  console.log('\nSigning out');
  {
    const out = await call('/api/auth/logout', { method: 'POST', cookie: jar(session), origin: BASE });
    check(out.status === 200 && out.json?.data?.revoked === true, 'logout ends the session at Supabase', `HTTP ${out.status} revoked=${out.json?.data?.revoked}`);
    check(out.cookies.cc_at?.value === '' && out.cookies.cc_rt?.value === '', 'and clears the cookies');
    const replay = await call('/api/auth/me', { cookie: jar({ cc_rt: session.cc_rt }) });
    check(replay.status === 401, 'the old refresh token can no longer mint a session', `HTTP ${replay.status}`);
    const crossOut = await call('/api/auth/logout', { method: 'POST', cookie: jar(session), origin: EVIL });
    check(crossOut.status === 403, 'another site cannot sign a visitor out', `HTTP ${crossOut.status}`);
  }

  console.log('\nPassword reset');
  {
    const ask = await call('/api/auth/request-reset', { method: 'POST', origin: BASE, body: { email } });
    check(ask.status === 200, 'asking for a link succeeds', `HTTP ${ask.status}`);
    const unknown = await call('/api/auth/request-reset', { method: 'POST', origin: BASE, body: { email: `nobody_${Date.now()}@cloudcols.test` } });
    check(unknown.status === 200, 'and answers the same for an unknown address', `HTTP ${unknown.status}`);

    // A second live session, to prove the reset ends it.
    const other = await call('/api/auth/login', { method: 'POST', origin: BASE, body: { email, password: PASSWORD } });
    const otherRt = other.cookies.cc_rt?.value;

    const link = await rest('/auth/v1/admin/generate_link', { method: 'POST', body: { type: 'recovery', email } });
    const tokenHash = link.json?.hashed_token ?? link.json?.properties?.hashed_token;
    const page = await fetch(`${BASE}/reset-password?token_hash=${encodeURIComponent(tokenHash ?? '')}`);
    check(page.status === 200, 'the reset page exists', `HTTP ${page.status}`);
    const reset = await call('/api/auth/reset-password', { method: 'POST', origin: BASE, body: { tokenHash, password: NEW_PASSWORD } });
    check(reset.status === 200, 'the link sets a new password', `HTTP ${reset.status} ${reset.code ?? ''}`);
    const again = await call('/api/auth/reset-password', { method: 'POST', origin: BASE, body: { tokenHash, password: 'Another-passw0rd!' } });
    check(again.status === 400, 'and works only once', `HTTP ${again.status} ${again.code ?? ''}`);
    const oldPw = await call('/api/auth/login', { method: 'POST', origin: BASE, body: { email, password: PASSWORD } });
    check(oldPw.status === 401, 'the old password stops working', `HTTP ${oldPw.status}`);
    const newPw = await call('/api/auth/login', { method: 'POST', origin: BASE, body: { email, password: NEW_PASSWORD } });
    check(newPw.status === 200, 'the new one works', `HTTP ${newPw.status}`);
    const stale = await call('/api/auth/me', { cookie: jar({ cc_rt: otherRt }) });
    check(stale.status === 401, 'every session from before the reset is ended', `HTTP ${stale.status}`);
  }

  console.log('\nOne-time sign-in link');
  {
    const link = await rest('/auth/v1/admin/generate_link', { method: 'POST', body: { type: 'magiclink', email } });
    const tokenHash = link.json?.hashed_token ?? link.json?.properties?.hashed_token;
    const land = await call(`/auth/confirm?type=magiclink&token_hash=${encodeURIComponent(tokenHash ?? '')}`, { redirect: 'manual' });
    check(land.status === 303 && land.res.headers.get('location') === '/app', 'the link signs in and goes to the app', `HTTP ${land.status} → ${land.res.headers.get('location')}`);
    check(Boolean(land.cookies.cc_at?.value) && /HttpOnly/i.test(land.cookies.cc_at?.attrs ?? ''), 'setting the session cookies');
    const reused = await call(`/auth/confirm?type=magiclink&token_hash=${encodeURIComponent(tokenHash ?? '')}`, { redirect: 'manual' });
    check(reused.res.headers.get('location') === '/login?error=link', 'and cannot be used twice', `→ ${reused.res.headers.get('location')}`);
    const bogus = await call('/auth/confirm?type=recovery&token_hash=x', { redirect: 'manual' });
    check(bogus.res.headers.get('location') === '/login?error=link', 'a recovery token cannot be used to sign in there');
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  return fail === 0 ? 0 : 1;
}

async function cleanUp() {
  if (email) await rest(`/rest/v1/admins?email=eq.${encodeURIComponent(email)}`, { method: 'DELETE' });
  if (!userId) return;
  await rest('/rest/v1/storage_purge_queue', { method: 'POST', body: { prefix: `${userId}/`, reason: 'probe_cleanup' } });
  await rest(`/auth/v1/admin/users/${userId}`, { method: 'DELETE' });
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
