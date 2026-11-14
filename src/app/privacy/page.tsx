import type { Metadata } from "next";
import Link from "next/link";

import { PublicPage, PublicSection } from "@/features/public/public-page";
import { ACTIVE_BRAND } from "@/lib/brand";

/**
 * PRIVACY POLICY — public, read by Google when the OAuth app is published.
 * Ported from Ask Bubbles; the facts below are checked against THIS app.
 *
 * Keep every statement here TRUE OF THE CODE. In particular: disconnecting
 * Google (`/api/admin/reviews/gbp/disconnect`) revokes the grant and stops
 * syncing but KEEPS stored reviews, so this page promises deletion of review
 * data on request, not automatically on disconnect. Change the two together.
 */
export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `How ${ACTIVE_BRAND.productName} uses Google Business Profile data.`,
};

const EFFECTIVE_DATE = "November 1, 2026";

/**
 * The contact address comes from the deployment, not the repository:
 * `no-real-people.test.ts` keeps real people's addresses out of tracked files.
 * Set PRIVACY_CONTACT_EMAIL in Vercel before publishing the Google app.
 */
function privacyContact(): string | null {
  const value = process.env.PRIVACY_CONTACT_EMAIL?.trim();
  return value && /^[^\s@]+@[^\s@]+$/.test(value) ? value : null;
}

function ContactLink() {
  const contact = privacyContact();
  if (!contact) return <>your {ACTIVE_BRAND.operatorName} administrator</>;
  return (
    <a href={`mailto:${contact}`} className="text-primary underline">
      {contact}
    </a>
  );
}

export default function PrivacyPage() {
  const app = ACTIVE_BRAND.productName;
  const operator = ACTIVE_BRAND.operatorName;
  const places = ACTIVE_BRAND.vocabulary.salonNounPlural;
  return (
    <PublicPage eyebrow={`Effective ${EFFECTIVE_DATE}`} title="Privacy Policy">
      <PublicSection title="Who we are">
        <p>
          {app} is an internal team app for {ACTIVE_BRAND.brandName}, operated by {operator}. It is used
          only by {operator} staff and is not offered to the public.
        </p>
      </PublicSection>

      <PublicSection title="Google data we use">
        <p>
          When an {operator} administrator connects a Google account, {app} requests the{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[13px]">business.manage</code> scope for
          the Google Business Profile APIs. We use it only to <b>read</b>:
        </p>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            Google Business Profile reviews: star rating, review comment, dates, the reviewer&apos;s display
            name (never their photo or profile link) and any owner reply, and
          </li>
          <li>location information (business name, address and store code),</li>
        </ul>
        <p>
          and only for {ACTIVE_BRAND.brandName} {places} managed by {operator}. Google offers no read-only
          scope for these APIs, but {app} never posts, edits or deletes reviews or replies, and does not
          read any other Google data such as Gmail, Drive or Contacts.
        </p>
      </PublicSection>

      <PublicSection title="How we use it">
        <p>
          The data is used solely to display and analyze reviews in the internal {app} dashboard, so
          managers can see how their {places} are doing. We do not sell it, use it for advertising, or use
          it to train AI models.
        </p>
        <p>
          It is shared only with the service providers that host or process it for us, under their terms:
          Supabase (database), Vercel (hosting) and, when a staff member asks the {app} chat about Google
          reviews, Anthropic, whose Claude model receives review counts and goal progress to write the
          answer. Review text and reviewer names are not sent to the chat.
        </p>
      </PublicSection>

      <PublicSection title="Storage and security">
        <p>
          Review and location data is stored in our Supabase database, which is encrypted at rest. OAuth
          tokens are stored server-side only: the long-lived refresh token is additionally encrypted by the
          app (AES-256-GCM) before it is saved, short-lived access tokens are held in memory for a single
          sync, and no token is ever sent to a browser. Access to the dashboard requires a staff sign-in.
        </p>
      </PublicSection>

      <PublicSection title="Retention and deletion">
        <p>
          Imported review and location data is kept until it is deleted on request. When an administrator
          disconnects Google in {app}, we ask Google to revoke our access and all syncing stops;
          disconnecting does not by itself delete reviews already stored. To have that data deleted, email{" "}
          <ContactLink /> and we will delete it.
        </p>
        <p>
          You can also revoke {app}&apos;s access at any time from your Google Account: go to{" "}
          <a
            href="https://myaccount.google.com/permissions"
            className="text-primary underline"
            rel="noopener noreferrer"
            target="_blank"
          >
            myaccount.google.com/permissions
          </a>
          , select {app} and choose <b>Remove access</b>. Syncing stops as soon as access is removed.
        </p>
      </PublicSection>

      <PublicSection title="Google API Services User Data Policy">
        <p>
          {app}&apos;s use of information received from Google APIs adheres to the{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            className="text-primary underline"
            rel="noopener noreferrer"
            target="_blank"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
      </PublicSection>

      <PublicSection title="Contact">
        <p>
          Questions or requests about this policy: <ContactLink />. See also{" "}
          <Link href="/about" className="text-primary underline">
            About {app}
          </Link>
          .
        </p>
      </PublicSection>
    </PublicPage>
  );
}
