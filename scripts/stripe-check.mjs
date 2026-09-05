/**
 * Checks the Stripe integration against real Stripe, with real keys.
 *
 * Not a unit test: it saves settings the way the admin panel does, asks Stripe
 * for a checkout session, and confirms the plan is NOT granted by doing so. The
 * last of those is the one that matters — everything else can look right while
 * the endpoint quietly hands out plans, which is what it used to do.
 *
 * Creates a throwaway admin and a throwaway user, and removes both afterwards, so
 * it needs nobody's real password.
 *
 *   STRIPE_SK=sk_test_… STRIPE_PK=pk_test_… STRIPE_WH=whsec_… \
 *     node scripts/stripe-check.mjs .dev.vars
 *
 * The keys come from the environment, never from a file in the repository.
 */
import { readFileSync } from "node:fs";

const BASE = "http://127.0.0.1:8792";
const ENV = Object.fromEntries(
  readFileSync(process.argv[2] ?? ".dev.vars", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

const SUPA = ENV.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = ENV.SUPABASE_SERVICE_ROLE_KEY;
const ANON = ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const SK = process.env.STRIPE_SK;
const PK = process.env.STRIPE_PK;
const WH = process.env.STRIPE_WH;
if (!SK || !WH) {
  console.error("Set STRIPE_SK and STRIPE_WH (and optionally STRIPE_PK) in the environment.");
  process.exit(2);
}

let pass = 0;
let fail = 0;
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}${detail ? "  " + detail : ""}`);
  ok ? (pass += 1) : (fail += 1);
};

const supa = (path, init = {}) =>
  fetch(`${SUPA}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });

let adminUser = null;
let user = null;
const adminEmail = `admin_${Date.now()}@cloudcols.test`;
const userEmail = `stripe_${Date.now()}@cloudcols.test`;
const password = `Pw-${crypto.randomUUID()}`;

try {
  /* --------------------------------------------------------- throwaway admin */
  adminUser = await (
    await supa("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({ email: adminEmail, password, email_confirm: true }),
    })
  ).json();

  await supa("/rest/v1/admins", {
    method: "POST",
    body: JSON.stringify({
      email: adminEmail,
      name: "Stripe check",
      role: "super_admin",
      is_active: true,
      user_id: adminUser.id,
    }),
  });

  const login = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: adminEmail, password }),
  });
  const loginBody = await login.json();
  const adminToken = loginBody?.data?.token;
  check(Boolean(adminToken), "admin signs in", adminToken ? "" : JSON.stringify(loginBody).slice(0, 120));
  if (!adminToken) throw new Error("no admin session");

  const asAdmin = async (path, init = {}) => {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${adminToken}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  /* ------------------------------------------------------------- settings */
  // Refusing to enable without a webhook secret is the guard that stops money
  // being taken for a plan that could never activate.
  const halfConfigured = await asAdmin("/api/admin/payment-settings?provider=stripe", {
    method: "PUT",
    body: JSON.stringify({ secretKey: SK, isEnabled: true }),
  });
  check(
    halfConfigured.status === 400,
    "refuses to enable Stripe without a webhook signing secret",
    `HTTP ${halfConfigured.status}`,
  );

  const saved = await asAdmin("/api/admin/payment-settings?provider=stripe", {
    method: "PUT",
    body: JSON.stringify({ publishableKey: PK, secretKey: SK, webhookSecret: WH, isEnabled: true, testMode: true }),
  });
  check(saved.status === 200 && saved.json?.data?.isEnabled === true, "settings saved and enabled", `HTTP ${saved.status}`);
  check(saved.json?.data?.hasSecretKey === true, "the secret key is stored");
  check(saved.json?.data?.hasWebhookSecret === true, "the webhook secret is stored");
  check(!JSON.stringify(saved.json).includes(SK), "and neither is returned to the caller");

  // Encrypted at rest: a database dump must be useless on its own.
  const rows = await (
    await supa("/rest/v1/payment_settings?provider=eq.stripe&select=secret_ciphertext,public_config")
  ).json();
  check(!JSON.stringify(rows).includes(SK), "and the secret is not readable in the database");
  check(Boolean(rows?.[0]?.secret_ciphertext), "ciphertext is present");

  // Blank fields mean "unchanged" — the panel cannot show a secret to echo back,
  // so treating blank as "clear it" would wipe a working configuration.
  const toggled = await asAdmin("/api/admin/payment-settings?provider=stripe", {
    method: "PUT",
    body: JSON.stringify({ testMode: false }),
  });
  check(toggled.json?.data?.hasSecretKey === true, "an unrelated save keeps the stored secrets");
  await asAdmin("/api/admin/payment-settings?provider=stripe", { method: "PUT", body: JSON.stringify({ testMode: true }) });

  /* --------------------------------------------------------------- checkout */
  user = await (
    await supa("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({ email: userEmail, password, email_confirm: true }),
    })
  ).json();

  const token = (
    await (
      await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: ANON, "content-type": "application/json" },
        body: JSON.stringify({ email: userEmail, password }),
      })
    ).json()
  ).access_token;

  const checkout = await (
    await fetch(`${BASE}/api/subscriptions/checkout`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ planId: "plan_pro", provider: "stripe" }),
    })
  ).json();

  const url = checkout?.data?.checkoutUrl ?? "";
  check(url.startsWith("https://checkout.stripe.com"), "Stripe returns a real checkout page", url.slice(0, 46) || JSON.stringify(checkout).slice(0, 120));

  // The point of the whole design: paying is what grants a plan, not asking.
  const me = await (await fetch(`${BASE}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } })).json();
  check(me?.data?.planId === "plan_free", "the plan is NOT granted by starting checkout", String(me?.data?.planId));

  const pending = await (
    await supa(`/rest/v1/subscriptions?user_id=eq.${user.id}&select=status,provider`)
  ).json();
  check(pending?.[0]?.status === "past_due", "the subscription is recorded as unpaid until the webhook says otherwise", String(pending?.[0]?.status));

  /* --------------------------------------------------------------- webhook */
  const unsigned = await fetch(`${BASE}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "evt_forged", type: "checkout.session.completed" }),
  });
  check(unsigned.status === 400, "an unsigned webhook is refused", `HTTP ${unsigned.status}`);

  const forged = await fetch(`${BASE}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
    body: JSON.stringify({ id: "evt_forged", type: "checkout.session.completed" }),
  });
  check(forged.status === 400, "a forged signature is refused", `HTTP ${forged.status}`);
} catch (e) {
  fail += 1;
  console.log("  FAIL unexpected error:", e.message);
} finally {
  if (user?.id) await supa(`/auth/v1/admin/users/${user.id}`, { method: "DELETE" }).catch(() => {});
  if (adminUser?.id) {
    await supa(`/rest/v1/admins?email=eq.${encodeURIComponent(adminEmail)}`, { method: "DELETE" }).catch(() => {});
    await supa(`/auth/v1/admin/users/${adminUser.id}`, { method: "DELETE" }).catch(() => {});
  }
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
