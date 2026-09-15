import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";
import { getSettings } from "@/lib/settings/system";
import { formatBytes } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Terms",
  description: "The terms for using CloudCols: your account, your files, plans and billing, and what happens to inactive accounts.",
};

export default async function TermsPage() {
  const s = await getSettings();

  return (
    <LegalPage slug="terms" title="Terms of service">
      <p>
        These terms apply when you use CloudCols. By creating an account you agree to them.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>Give a real email address; it is how we reach you about your account.</li>
        <li>
          You are responsible for keeping your password safe and for what happens under your
          account.
        </li>
      </ul>

      <h2>Your files</h2>
      <ul>
        <li>
          Your files stay yours. We store and deliver them only so the service can work for
          you, and to the people you share them with.
        </li>
        <li>
          When you share a file, anyone with the share link can open it until you revoke the
          link or it expires.
        </li>
        <li>A single file can be at most {formatBytes(s.max_file_size_bytes)}.</li>
      </ul>

      <h2>Acceptable use</h2>
      <p>Do not use CloudCols to:</p>
      <ul>
        <li>store or share anything illegal, or that you do not have the right to share;</li>
        <li>distribute malware;</li>
        <li>attack, overload or probe the service or other users&apos; accounts;</li>
        <li>get around storage limits, rate limits or access controls.</li>
      </ul>
      <p>
        We may suspend an account that breaks these rules. A suspended account cannot be used
        until the suspension is lifted.
      </p>

      <h2>Plans and billing</h2>
      <ul>
        <li>Paid plans are billed through Stripe at the price shown when you subscribe.</li>
        <li>
          When a subscription ends, your account moves to the free plan. Your files are not
          deleted; if they exceed the free plan&apos;s storage, you cannot upload more until you
          are under it again or subscribe again.
        </li>
        <li>
          If a payment fails, your plan stays as it is while Stripe retries. We will tell you in
          the app.
        </li>
      </ul>

      <h2>Inactive accounts</h2>
      <p>
        An account that is not used for {s.inactivity_warn_days} days receives a warning, and a
        final warning at {s.inactivity_final_warn_days} days. If it is still unused at{" "}
        {s.inactivity_grace_days} days it is scheduled for deletion, along with its files.
        Signing in at any point stops this.
      </p>

      <h2>Deleting your account</h2>
      <p>
        You can delete your account from Settings at any time. Deletion is permanent: your files
        cannot be recovered afterwards. See the <a href="/privacy">privacy page</a> for what is
        removed and when.
      </p>

      <h2>Availability</h2>
      <p>
        We work to keep CloudCols available and your files safe, but the service is provided
        as it is, without guarantees of uninterrupted availability. Keep your own copies of
        files you cannot afford to lose.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms. If a change affects you significantly, we will tell you
        before it takes effect.
      </p>
    </LegalPage>
  );
}
