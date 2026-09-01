// Transactional email abstraction.
// Templates are configurable (admin-editable) and provider-agnostic. When no
// provider is configured (e.g. local/mock dev), it falls back to a console
// log so the app works without credentials. Swap the provider by setting
// EMAIL_PROVIDER + the matching API key.

import "server-only";

export type EmailProvider = "console" | "resend" | "smtp" | "custom";

export interface SendEmailInput {
  to: string;
  from?: string;
  subject?: string;
  html?: string;
  text?: string;
  template?: string;
  data?: Record<string, string>;
}

// Template registry. These are the default templates; in production they can be
// overridden from the Admin panel (stored in DB or a config table) so email
// content is not hard-coded in business logic.
export const EMAIL_TEMPLATES: Record<string, (d: Record<string, string>) => { subject: string; body: string }> = {
  welcome: (d) => ({
    subject: `Welcome to CloudCols, ${d.name}!`,
    body: `<p>Hi ${d.name},</p><p>Your CloudCols account is ready. You have <strong>${d.quota}</strong> of free storage.</p><p><a href="${d.link}">Get started</a></p>`,
  }),
  verify: (d) => ({
    subject: "Confirm your email",
    body: `<p>Hi ${d.name},</p><p>Confirm your email to activate your CloudCols account.</p><p><a href="${d.link}">Verify email</a></p>`,
  }),
  reset: (d) => ({
    subject: "Reset your password",
    body: `<p>Hi ${d.name},</p><p>Use the link below to reset your password. It expires in 30 minutes.</p><p><a href="${d.link}">Reset password</a></p>`,
  }),
  inactive_warning: (d) => ({
    subject: "Your CloudCols account is inactive",
    body: `<p>Hi ${d.name},</p><p>Your account has been inactive for ${d.days} days. Sign in to keep it active, or your files may be affected.</p>`,
  }),
  inactive_final: (d) => ({
    subject: "Final notice before account deletion",
    body: `<p>Hi ${d.name},</p><p>This is your final notice. Sign in within ${d.grace} days or your account and files will be deleted.</p>`,
  }),
  subscription: (d) => ({
    subject: "Subscription confirmed",
    body: `<p>Hi ${d.name},</p><p>Your ${d.plan} subscription is active. You now have ${d.quota} of storage.</p>`,
  }),
  api_key: (d) => ({
    subject: "New API key created",
    body: `<p>Hi ${d.name},</p><p>A new API key <strong>${d.label}</strong> was created. If this wasn't you, review your keys immediately.</p>`,
  }),
  security: (d) => ({
    subject: "Security alert",
    body: `<p>Hi ${d.name},</p><p>${d.message}</p>`,
  }),
};

const provider: EmailProvider = (process.env.EMAIL_PROVIDER as EmailProvider) || "console";

function render(template: string, data: Record<string, string>): { subject: string; body: string } {
  const tpl = EMAIL_TEMPLATES[template];
  if (tpl) return tpl(data);
  return { subject: data.subject ?? "Notification", body: data.body ?? "<p>Notification</p>" };
}

/** Send a transactional email. Never throws in a way that fails the request — logs and continues. */
export async function sendTransactional(input: SendEmailInput): Promise<{ sent: boolean; provider: EmailProvider }> {
  const { subject, body } = render(input.template ?? "security", input.data ?? {});

  if (provider === "console" || !process.env.RESEND_API_KEY) {
    // Dev/no-provider fallback — never fail the flow.
    console.info(`[email:console] to=${input.to} subject="${input.subject ?? subject}"`);
    return { sent: false, provider: "console" };
  }

  const from = input.from ?? process.env.EMAIL_FROM ?? "CloudCols <noreply@yourdomain.com>";

  try {
    if (provider === "resend") {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ from, to: [input.to], subject: input.subject ?? subject, html: body, text: input.text }),
      });
      const ok = res.ok;
      if (!ok) console.error("[email:resend] failed", res.status, await res.text().catch(() => ""));
      return { sent: ok, provider };
    }
    // Provider not wired → log (subclassing here is where SMTP/custom adapters plug in).
    throw new Error(`Email provider "${provider}" is not wired.`);
  } catch (e) {
    console.error("[email] send failed", (e as Error).message);
    return { sent: false, provider };
  }
}

/** Shortcut helpers for common flows. */
export const email = {
  welcome: (to: string, data: Record<string, string>) =>
    sendTransactional({ to, template: "welcome", data }),
  verify: (to: string, data: Record<string, string>) =>
    sendTransactional({ to, template: "verify", data }),
  reset: (to: string, data: Record<string, string>) =>
    sendTransactional({ to, template: "reset", data }),
  inactiveWarning: (to: string, data: Record<string, string>) =>
    sendTransactional({ to, template: "inactive_warning", data }),
  inactiveFinal: (to: string, data: Record<string, string>) =>
    sendTransactional({ to, template: "inactive_final", data }),
  subscription: (to: string, data: Record<string, string>) =>
    sendTransactional({ to, template: "subscription", data }),
  apiKey: (to: string, data: Record<string, string>) =>
    sendTransactional({ to, template: "api_key", data }),
  security: (to: string, data: Record<string, string>) =>
    sendTransactional({ to, template: "security", data }),
};
