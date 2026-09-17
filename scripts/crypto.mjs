/**
 * Crypto payment probe: everything about paying in XRP that can be proven without
 * moving real money.
 *
 * What it cannot do is complete a payment: that needs the operator's Xaman app and a
 * funded wallet. The verification maths that decides whether a transaction counts is
 * covered by tests/crypto-payments.test.ts instead. What this checks is the ground
 * around it — that nothing can be bought or configured by the wrong request, and that
 * the job which ends a paid period actually ends it.
 *
 * It never saves crypto settings. The local Worker talks to the production database,
 * and a stored secret cannot be cleared from the panel once written — so only requests
 * that fail validation, before anything is written, are sent to that endpoint.
 *
 * Usage, with the app running under `wrangler dev --port 8792`:
 *
 *   node scripts/crypto.mjs .dev.vars
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
const PASSWORD = 'Crypto-passw0rd!';

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
    return Object.entries(this.cookies).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ');
  }
  async call(path, { method = 'GET', body, raw } = {}) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { origin: BASE, 'content-type': 'application/json', cookie: this.jar() },
      ...(raw !== undefined ? { body: raw } : body ? { body: JSON.stringify(body) } : {}),
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

const job = (name) =>
  fetch(`${BASE}/api/jobs/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-job-token': ENV.JOBS_TOKEN },
    body: JSON.stringify({ name }),
  }).then((r) => r.json());

const user = new Browser();
let userId = null;
let email = null;

async function main() {
  console.log('\nCrypto payment probe\n');
  email = `crypto_${Date.now()}@cloudcols.test`;
  const signup = await user.call('/api/auth/signup', { method: 'POST', body: { name: 'Crypto probe', email, password: PASSWORD } });
  userId = signup.data?.user?.id ?? null;
  if (!check(userId, 'account created', `HTTP ${signup.status}`)) return 1;

  const settingsNow = (await rest('/rest/v1/payment_settings?provider=eq.crypto&select=is_enabled')).json?.[0];
  const cryptoOn = Boolean(settingsNow?.is_enabled);
  console.log(`  --   crypto is ${cryptoOn ? 'ENABLED' : 'not enabled'} in this database`);

  console.log('\nWhat the page is told');
  {
    const p = await user.call('/api/payments/providers');
    check(p.status === 200 && typeof p.data?.crypto === 'boolean' && typeof p.data?.stripe === 'boolean', 'the providers endpoint answers with booleans', JSON.stringify(p.data));
    check(Object.keys(p.data ?? {}).sort().join(',') === 'crypto,stripe', 'and nothing else — no keys, no address');
  }

  const plans = (await rest('/rest/v1/plans?select=id,price_cents,is_active&is_active=eq.true&order=price_cents.desc')).json ?? [];
  const paid = plans.find((p) => p.price_cents > 0);
  const free = plans.find((p) => p.price_cents === 0);

  if (!cryptoOn && paid) {
    console.log('\nCheckout while crypto is off');
    const r = await user.call('/api/subscriptions/checkout', { method: 'POST', body: { planId: paid.id, provider: 'crypto' } });
    check(r.status === 503 && r.code === 'PAYMENTS_NOT_CONFIGURED', 'paying with XRP is refused, plainly', `HTTP ${r.status} ${r.code ?? ''}`);
    const rows = (await rest(`/rest/v1/payments?user_id=eq.${userId}&select=id`)).json ?? [];
    check(Array.isArray(rows) && rows.length === 0, 'and nothing pending is left behind');
    const me = await user.call('/api/auth/me');
    check(me.data?.planId !== paid.id, 'nor is the plan granted', String(me.data?.planId));
  }

  console.log('\nWebhooks');
  {
    const garbage = await fetch(`${BASE}/api/webhooks/xaman`, { method: 'POST', body: 'not json' });
    check(garbage.status === 400, 'an unreadable body is refused', `HTTP ${garbage.status}`);
    const forged = await fetch(`${BASE}/api/webhooks/xaman`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payloadResponse: { payload_uuidv4: '00000000-0000-0000-0000-000000000000' } }),
    });
    check(forged.status === 400, 'a made-up payload grants nothing', `HTTP ${forged.status}`);
    const me = await user.call('/api/auth/me');
    check(!paid || me.data?.planId !== paid.id, 'the account is unchanged');
  }

  console.log('\nAdmin configuration (validation only — nothing is saved)');
  await rest('/rest/v1/admins', { method: 'POST', body: { email, name: 'Crypto probe', role: 'super_admin', is_active: true, user_id: userId } });
  {
    const s = await user.call('/api/admin/session');
    check(s.data?.isAdmin === true, 'a staff session for the probe', `HTTP ${s.status}`);
    const got = await user.call('/api/admin/payment-settings?provider=crypto');
    const body = JSON.stringify(got.data ?? {});
    check(got.status === 200, 'crypto settings can be read by an admin', `HTTP ${got.status}`);
    check(!/"(apiKey|secretKey|apiSecret|webhookSecret)"\s*:/.test(body), 'and never include a secret, only whether one is stored', Object.keys(got.data ?? {}).join(','));
    const badAddress = await user.call('/api/admin/payment-settings?provider=crypto', {
      method: 'PUT',
      body: { destinationAddress: 'not-an-xrpl-address' },
    });
    check(badAddress.status === 400, 'an address that is not on the XRP Ledger is refused', `HTTP ${badAddress.status}`);
    const badNode = await user.call('/api/admin/payment-settings?provider=crypto', {
      method: 'PUT',
      body: { destinationAddress: 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY', nodeUrl: 'http://insecure.example' },
    });
    check(badNode.status === 400, 'a verification node without https is refused', `HTTP ${badNode.status}`);
    if (!cryptoOn) {
      const got2 = await user.call('/api/admin/payment-settings?provider=crypto');
      if (!got2.data?.hasApiKey || !got2.data?.hasSecretKey) {
        const halfOn = await user.call('/api/admin/payment-settings?provider=crypto', {
          method: 'PUT',
          body: { isEnabled: true, destinationAddress: 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY', nodeUrl: 'https://s.altnet.rippletest.net:51234/' },
        });
        check(halfOn.status === 400, 'crypto cannot be enabled without the Xaman key and secret', `HTTP ${halfOn.status}`);
      }
    }
  }
  await rest(`/rest/v1/admins?email=eq.${encodeURIComponent(email)}`, { method: 'DELETE' });

  console.log('\nThe jobs');
  {
    const r = await job('crypto-reconcile');
    check(r.ok !== false && typeof r.data?.message === 'string', 'crypto-reconcile runs', r.data?.message);

    if (paid && free) {
      // A paid period that ended yesterday, with nothing to renew it.
      await rest(`/rest/v1/user_storage?user_id=eq.${userId}`, { method: 'PATCH', body: { plan_id: paid.id } });
      const sub = await rest('/rest/v1/subscriptions', {
        method: 'POST',
        body: {
          user_id: userId,
          plan_id: paid.id,
          status: 'active',
          provider: 'crypto',
          current_period_end: new Date(Date.now() - 86_400_000).toISOString(),
          renews_at: null,
        },
      });
      const subId = sub.json?.[0]?.id;
      check(Boolean(subId), 'an expired crypto subscription is set up');

      const e = await job('subscription-expiry');
      check(typeof e.data?.message === 'string', 'subscription-expiry runs', e.data?.message);

      const after = (await rest(`/rest/v1/subscriptions?id=eq.${subId}&select=status`)).json?.[0];
      check(after?.status === 'expired', 'the subscription is ended', String(after?.status));
      const acct = (await rest(`/rest/v1/user_storage?user_id=eq.${userId}&select=plan_id`)).json?.[0];
      check(acct?.plan_id === free.id, 'the account drops to the free plan', String(acct?.plan_id));
      const notes = await user.call('/api/notifications');
      check((notes.data ?? []).some((n) => /paid period has ended/.test(n.title ?? '')), 'and is told why');

      const again = await job('subscription-expiry');
      const notes2 = await user.call('/api/notifications');
      const count = (notes2.data ?? []).filter((n) => /paid period has ended/.test(n.title ?? '')).length;
      check(count === 1, 'a second run does not end it twice', `${count} notice(s); ${again.data?.message}`);
    }
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
