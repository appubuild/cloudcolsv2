import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";
import { getSettings } from "@/lib/settings/system";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What CloudCols collects, why, who processes it, how long it is kept, and how to delete it.",
};

export default async function PrivacyPage() {
  // Retention periods are admin settings; the policy quotes whatever is configured
  // rather than numbers that would silently go stale.
  const s = await getSettings();
  const ads = s.ads_enabled && Boolean(s.ads_config?.providerId);

  return (
    <LegalPage slug="privacy" title="Privacy">
      <p>
        CloudCols stores files for you. This page describes what information that involves, what
        it is used for, and how you remove it.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account details</strong> — your email address and password. The password is
          handled by our authentication provider and stored only as a salted hash.
        </li>
        <li>
          <strong>Profile details you choose to give</strong> — display name, avatar, country,
          phone number and address, if you fill them in.
        </li>
        <li>
          <strong>Your files</strong> — their contents, and the details needed to show them:
          name, size, type, folder, and for images and videos their dimensions, duration and a
          thumbnail generated from the file.
        </li>
        <li>
          <strong>Activity</strong> — which files you opened recently (to show them to you),
          when you last signed in, and security events such as sign-ins, shares and account
          changes.
        </li>
        <li>
          <strong>Billing</strong> — if you subscribe, your plan, and the amount, currency and
          status of each payment. Card details go to Stripe and never reach our servers.
        </li>
        <li>
          <strong>Network information</strong> — your IP address is used to limit repeated
          sign-in attempts and appears in our infrastructure providers&apos; request logs.
        </li>
      </ul>

      <h2>What we use it for</h2>
      <ul>
        <li>To store your files and let you, and the people you share with, open them.</li>
        <li>To keep accounts secure and stop abuse.</li>
        <li>To bill for paid plans.</li>
        <li>
          To send the emails the service needs — verification, password reset, and warnings
          before an inactive account is removed.
        </li>
      </ul>
      <p>We do not sell your information, and we do not look at your files&apos; contents.</p>

      <h2>Who processes it for us</h2>
      <ul>
        <li><strong>Cloudflare</strong> — runs the application and delivers files.</li>
        <li><strong>Supabase</strong> — database and authentication.</li>
        <li><strong>Backblaze B2</strong> — stores file contents, in a private bucket.</li>
        <li><strong>Stripe</strong> — payments.</li>
        <li><strong>Our email provider</strong> — sends account emails.</li>
        {ads && <li><strong>Our advertising provider</strong> — shows the ads on free pages.</li>}
      </ul>

      <h2>Cookies and browser storage</h2>
      <ul>
        <li>Your sign-in session is kept in your browser&apos;s storage.</li>
        <li>
          A delivery cookie ties file links to your session, so a link copied out of your
          browser does not open your file for someone else. It cannot be read by page scripts.
        </li>
        {ads && <li>The advertising provider may set its own cookies on pages that show ads.</li>}
      </ul>

      <h2>How long it is kept</h2>
      <ul>
        <li>
          Files you delete go to the trash and are permanently deleted{" "}
          {s.trash_retention_days} days later, or sooner if you empty the trash.
        </li>
        <li>
          Uploads that are started and never finished are removed after {s.abandoned_upload_hours}{" "}
          hours.
        </li>
        <li>
          Accounts that are not used for {s.inactivity_warn_days} days receive a warning, and a
          final warning at {s.inactivity_final_warn_days} days. An account still unused at{" "}
          {s.inactivity_grace_days} days is scheduled for deletion. Signing in at any point
          cancels this.
        </li>
        <li>Everything else is kept while your account exists.</li>
      </ul>

      <h2>Deleting your account</h2>
      <p>
        You can delete your account from <strong>Settings → Danger zone</strong>. Your account,
        profile, folders, shares, notifications, API keys and file records are deleted
        immediately. File contents are then removed from storage in batches, normally within a
        few hours. Stripe keeps its own records of past payments as payment law requires.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>You can download any of your files at any time.</li>
        <li>You can change or remove your profile details in Settings.</li>
        <li>You can revoke any share link you created.</li>
      </ul>

      <h2>Changes</h2>
      <p>
        If this policy changes in a way that affects you, we will say so here and, for
        significant changes, by email.
      </p>
    </LegalPage>
  );
}
