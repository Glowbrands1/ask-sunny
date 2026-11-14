import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { PublicPage, PublicSection } from "@/features/public/public-page";
import { ACTIVE_BRAND } from "@/lib/brand";

/**
 * ABOUT — the public homepage named on Google's OAuth consent screen. `/` stays
 * the signed-in Home; this is what a logged-out visitor (or Google's reviewer)
 * can read. Ported from Ask Bubbles; see `features/public/public-page.tsx`.
 */
export const metadata: Metadata = {
  title: "About",
  description: `${ACTIVE_BRAND.productName} — ${ACTIVE_BRAND.tagline}.`,
};

export default function AboutPage() {
  const app = ACTIVE_BRAND.productName;
  return (
    <PublicPage eyebrow="About" title={`${app} — ${ACTIVE_BRAND.tagline}`}>
      <PublicSection title="What it is">
        <p>
          {app} is the {ACTIVE_BRAND.brandName} manager platform, operated by {ACTIVE_BRAND.operatorName}. It
          is an internal app for staff; signing in requires a company account.
        </p>
        <ul className="list-disc space-y-1 pl-6">
          <li>Grounded answers from the company knowledge base, with the source shown every time.</li>
          <li>Coaching forms and follow-ups drafted in a conversation.</li>
          <li>
            Reporting, including a dashboard that reads Google Business Profile reviews for{" "}
            {ACTIVE_BRAND.brandName} {ACTIVE_BRAND.vocabulary.salonNounPlural}.
          </li>
        </ul>
      </PublicSection>

      <PublicSection title="Your data">
        <p>
          Read how we use Google data, how it is stored and how to revoke access in our{" "}
          <Link href="/privacy" className="text-primary underline">
            Privacy Policy
          </Link>
          .
        </p>
      </PublicSection>

      <div>
        <Button asChild>
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    </PublicPage>
  );
}
