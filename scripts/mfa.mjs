/**
 * Two-factor probe: setting up, signing in with, recovering and removing 2FA.
 *
 * Generates real TOTP codes (RFC 6238) from the secret the server hands out, so what
 * is tested is the actual exchange with Supabase Auth — not a stub of it.
 *
 * Usage, with the app running under `wrangler dev --port 8792`:
 *
 *   node scripts/mfa.mjs .dev.vars
 *
 * Creates a throwaway account under @cloudcols.test and removes it afterwards. Takes a
 * minute or two: each verification waits for a fresh 30-second code.
 */
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const BASE = process.env.PROBE_BASE ?? 'http://127.0.0.1:8792';
const ENV = Object.fromEntries(
  readFileSync(process.argv[2] ?? '.dev.vars', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const SUPA = ENV.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = ENV.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = 'Mfa-passw0rd!';

let pass = 0;
let fail = 0;
function check(ok, label, detail = '') {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`);
  return ok;
}

// --- TOTP --------------------------------------------------------------------
function base32(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
const step = () => Math.floor(Date.now() / 1000 / 30);
function totp(secret, counter = step()) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}
/** A code from a time step no earlier verification used, in case codes are single-use. */
let lastStep = 0;
async function freshCode(secret) {
  while (step() <= lastStep) await new Promise((r) => setTimeout(r, 1000));
  lastStep = step();
  return totp(secret, lastStep);
}

// --- HTTP --------------------------------------------------------------------
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
  async call(path, { method = 'GET', body } = {}) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        origin: BASE,
        ...(body ? { 'content-type': 'application/json' } : {}),
        cookie: Object.entries(this.cookies)
          .filter(([, v]) => v)
          .map(([k, v]) => `${k}=${v}`)
          .join('; '),
      },
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

let userId = null;
let email = null;

async function signIn() {
  const b = new Browser();
  const r = await b.call('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } });
  return { b, r };
}

async function main() {
  console.log('\nTwo-factor probe\n');
  email = `mfa_${Date.now()}@cloudcols.test`;
  const me = new Browser();
  const signup = await me.call('/api/auth/signup', { method: 'POST', body: { name: 'MFA probe', email, password: PASSWORD } });
  userId = signup.data?.user?.id ?? null;
  if (!check(signup.status === 200 && userId, 'account created', `HTTP ${signup.status}`)) return 1;
  await me.call('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } });

  console.log('\nSetting up');
  const off = await me.call('/api/auth/mfa');
  check(off.status === 200 && off.data?.enabled === false, 'starts off', `HTTP ${off.status}`);
  const enroll = await me.call('/api/auth/mfa/enroll', { method: 'POST' });
  const secret = enroll.data?.secret;
  check(enroll.status === 200 && Boolean(secret) && String(enroll.data?.qrCode ?? '').startsWith('data:image/svg'), 'setup returns a QR code and secret', `HTTP ${enroll.status} ${enroll.code ?? ''}`);
  if (!secret) return 1;
  const wrong = await me.call('/api/auth/mfa/activate', { method: 'POST', body: { factorId: enroll.data.factorId, code: '000000' } });
  check(wrong.status === 400 && wrong.code === 'INVALID_CODE', 'a wrong first code does not turn it on', `HTTP ${wrong.status} ${wrong.code ?? ''}`);
  const stillOff = await me.call('/api/auth/mfa');
  check(stillOff.data?.enabled === false, 'and it is still off');
  const act = await me.call('/api/auth/mfa/activate', { method: 'POST', body: { factorId: enroll.data.factorId, code: await freshCode(secret) } });
  const recoveryCodes = act.data?.recoveryCodes ?? [];
  check(act.status === 200 && recoveryCodes.length === 10, 'the right code turns it on and issues 10 recovery codes', `HTTP ${act.status} ${act.code ?? ''}`);
  const meAfter = await me.call('/api/auth/me');
  check(meAfter.status === 200, 'the browser that set it up stays signed in', `HTTP ${meAfter.status}`);
  const on = await me.call('/api/auth/mfa');
  check(on.data?.enabled === true && on.data?.pending === false && on.data?.recoveryCodesLeft === 10, 'status reports it on', JSON.stringify(on.data));
  const dbFlag = await rest(`/rest/v1/user_storage?user_id=eq.${userId}&select=mfa_enabled`);
  check(dbFlag.json?.[0]?.mfa_enabled === true, 'the account is flagged');
  const stored = await rest(`/rest/v1/mfa_recovery_codes?user_id=eq.${userId}&select=code_hash`);
  check(
    Array.isArray(stored.json) && stored.json.length === 10 && stored.json.every((r) => !recoveryCodes.some((c) => r.code_hash.includes(c.replace('-', '')))),
    'recovery codes are stored hashed, never in plain text',
  );

  console.log('\nSigning in with 2FA on');
  {
    const { b, r } = await signIn();
    check(r.status === 200 && r.data?.mfaRequired === true, 'the password alone asks for a code', `HTTP ${r.status} mfaRequired=${r.data?.mfaRequired}`);
    const blocked = await b.call('/api/auth/me');
    check(blocked.status === 401 && blocked.code === 'MFA_REQUIRED', 'and the half-signed-in session can do nothing', `HTTP ${blocked.status} ${blocked.code ?? ''}`);
    const files = await b.call('/api/files');
    check(files.status === 401, 'not even list files', `HTTP ${files.status}`);
    const del = await b.call('/api/auth/delete', { method: 'POST', body: { password: PASSWORD } });
    check(del.status === 401, 'or delete the account with the password it has', `HTTP ${del.status}`);
    const pending = await b.call('/api/auth/mfa');
    check(pending.data?.pending === true, 'the sign-in page can tell a code is owed');
    const bad = await b.call('/api/auth/mfa/verify', { method: 'POST', body: { code: '123456' } });
    check(bad.status === 400 && bad.code === 'INVALID_CODE', 'a wrong code is refused', `HTTP ${bad.status} ${bad.code ?? ''}`);
    const good = await b.call('/api/auth/mfa/verify', { method: 'POST', body: { code: await freshCode(secret) } });
    check(good.status === 200, 'the right code completes sign-in', `HTTP ${good.status} ${good.code ?? ''}`);
    const now = await b.call('/api/auth/me');
    check(now.status === 200, 'and the session now works', `HTTP ${now.status}`);
  }

  console.log('\nStaff password login respects 2FA');
  await rest('/rest/v1/admins', { method: 'POST', body: { email, name: 'MFA probe', role: 'support', is_active: true, user_id: userId } });
  {
    const b = new Browser();
    const r = await b.call('/api/admin/login', { method: 'POST', body: { email, password: PASSWORD } });
    check(r.status === 403 && r.code === 'MFA_REQUIRED', 'the admin password form cannot skip the second factor', `HTTP ${r.status} ${r.code ?? ''}`);
    check(!b.cookies.cc_admin, 'and issues no staff session');
  }
  await rest(`/rest/v1/admins?email=eq.${encodeURIComponent(email)}`, { method: 'DELETE' });

  console.log('\nLost phone: a recovery code');
  {
    const { b } = await signIn();
    const nope = await b.call('/api/auth/mfa/recover', { method: 'POST', body: { code: 'aaaaa-bbbbb' } });
    check(nope.status === 400, 'a made-up recovery code is refused', `HTTP ${nope.status}`);
    const ok = await b.call('/api/auth/mfa/recover', { method: 'POST', body: { code: recoveryCodes[0] } });
    check(ok.status === 200 && ok.data?.disabled === true, 'a real one turns 2FA off', `HTTP ${ok.status} ${ok.code ?? ''}`);
    const now = await b.call('/api/auth/me');
    check(now.status === 200, 'and the same session is signed in', `HTTP ${now.status}`);
    const status = await b.call('/api/auth/mfa');
    check(status.data?.enabled === false, '2FA is off');
    const factors = await rest(`/auth/v1/admin/users/${userId}/factors`);
    check(Array.isArray(factors.json) && factors.json.length === 0, 'the lost device’s factor is gone', JSON.stringify(factors.json)?.slice(0, 80));
    const notified = await b.call('/api/notifications');
    check((notified.data ?? []).some((n) => /recovery code/.test(n.title ?? '')), 'the account is told it happened');
  }

  console.log('\nTurning it off deliberately');
  {
    const e = await me.call('/api/auth/mfa/enroll', { method: 'POST' });
    const s = e.data?.secret;
    await me.call('/api/auth/mfa/activate', { method: 'POST', body: { factorId: e.data?.factorId, code: await freshCode(s) } });
    const noCode = await me.call('/api/auth/mfa/disable', { method: 'POST', body: { code: '000000' } });
    check(noCode.status === 400, 'turning off needs a correct code', `HTTP ${noCode.status}`);
    const regen = await me.call('/api/auth/mfa/recovery-codes', { method: 'POST', body: { code: await freshCode(s) } });
    check(regen.status === 200 && regen.data?.recoveryCodes?.length === 10, 'recovery codes can be replaced', `HTTP ${regen.status}`);
    const offNow = await me.call('/api/auth/mfa/disable', { method: 'POST', body: { code: await freshCode(s) } });
    check(offNow.status === 200, 'and with one it turns off', `HTTP ${offNow.status} ${offNow.code ?? ''}`);
    const { r } = await signIn();
    check(r.status === 200 && !r.data?.mfaRequired, 'after which the password alone is enough again');
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
