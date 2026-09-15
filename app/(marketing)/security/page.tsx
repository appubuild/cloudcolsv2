import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";
import { getSettings } from "@/lib/settings/system";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Security",
  description: "How CloudCols keeps your files private: private storage, short-lived links, and access checked on every request.",
};

function minutes(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60));
  return `${m} minute${m === 1 ? "" : "s"}`;
}

export default async function SecurityPage() {
  const s = await getSettings();

  return (
    <LegalPage slug="security" title="Security">
      <p>
        Your files are private unless you choose to share them. This page describes how that is
        enforced — not as a promise about intentions, but as a description of how the service is
        built.
      </p>

      <h2>Where your files live</h2>
      <ul>
        <li>
          File contents are stored in a <strong>private</strong> object-storage bucket. It has no
          public address; nothing in it can be fetched without a link the service signs.
        </li>
        <li>
          Storage credentials exist only on our servers. They are never sent to your browser or
          app.
        </li>
        <li>
          Uploads go directly from your device to storage over HTTPS, using a one-off upload link
          valid for {minutes(s.upload_url_ttl_seconds)}. After an upload, the server checks the
          stored object&apos;s actual size before counting it — what the uploader claims is not
          trusted.
        </li>
      </ul>

      <h2>Who can open a file</h2>
      <ul>
        <li>
          Every request to view or download a file is checked against its owner, or against a
          share you created, before any link is issued.
        </li>
        <li>
          Viewing links expire after about {minutes(s.signed_url_ttl_seconds)} and are bound to
          your signed-in session. A link copied out of your browser does not work for someone
          else.
        </li>
        <li>
          Share links are long random tokens, not sequential numbers, and you can revoke them at
          any time. Once revoked, the share link stops issuing access at once; a viewing link
          already handed out through it lapses when it expires.
        </li>
        <li>
          The database enforces per-user access rules as a second line of defence: even a bug in
          application code cannot make one account&apos;s rows readable to another, and browsers
          cannot write to the database directly.
        </li>
      </ul>

      <h2>Accounts</h2>
      <ul>
        <li>Passwords are handled by our authentication provider and stored only as salted hashes.</li>
        <li>Sign-in, sign-up and password reset are rate-limited per network address.</li>
        <li>
          Suspending an account takes effect on its next request, not when its session happens to
          expire.
        </li>
        <li>
          Two-factor authentication is not available yet. Until it is, use a long password that
          you do not use anywhere else.
        </li>
      </ul>

      <h2>In transit and in logs</h2>
      <ul>
        <li>All traffic uses HTTPS.</li>
        <li>
          Passwords, session tokens, API keys and signed links are not written to logs. API keys
          are stored hashed and shown to you once, when created.
        </li>
        <li>Administrative actions and security-relevant events are recorded in an audit log.</li>
      </ul>

      <h2>Infrastructure</h2>
      <p>
        CloudCols runs on Cloudflare (application and delivery), Supabase (database and
        authentication) and Backblaze B2 (file storage). Payments are processed by Stripe; card
        details never reach our servers.
      </p>

      <h2>Reporting a vulnerability</h2>
      <p>
        If you believe you have found a security problem, please report it privately through the
        contact options on this site rather than disclosing it publicly, and give us a reasonable
        time to fix it. Please do not access, modify or delete other people&apos;s data while
        testing.
      </p>
    </LegalPage>
  );
}
