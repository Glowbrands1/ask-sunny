import type { Metadata } from "next";

import { BrandMark } from "@/components/brand-mark";
import { Notice } from "@/components/ui/feedback";
import { ACTIVE_BRAND } from "@/lib/brand";
import {
  REVIEW_COOKIE,
  REVIEW_SESSION_SECONDS,
  reviewAccessState,
  safeNextPath,
} from "@/lib/reporting-review/gate";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ReviewGateForm } from "./review-gate-form";

/**
 * THE STAKEHOLDER-REVIEW PASSWORD PROMPT.
 *
 * Deliberately plain: brand mark, one sentence, one field. A reviewer arriving
 * here has been sent by the middleware, so the page's whole job is to say what
 * is being asked for and why, without implying this is an Ask Sunny account.
 *
 * TEMPORARY. Replaced wholesale once employee login ships, whichever provider
 * that turns out to be; see `lib/reporting-review/gate.ts`.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Stakeholder Review",
  // A review deployment has no business appearing in a search index.
  robots: { index: false, follow: false },
};

export default async function ReviewGatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const nextRaw = Array.isArray(params.next) ? params.next[0] : params.next;
  const next = safeNextPath(nextRaw ?? null);

  const store = await cookies();
  const state = await reviewAccessState(store.get(REVIEW_COOKIE)?.value);

  // Already through the gate: do not make somebody type a password twice.
  if (state === "granted") redirect(next);

  /*
   * An operator hint, and ONLY for the case where the deployment is missing its
   * variable. A reviewer typing a wrong password never sees this — they see the
   * same generic refusal whatever went wrong. The variable NAME is not a
   * secret; its value is, and appears nowhere.
   */
  const unconfigured = state === "unconfigured";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          <BrandMark size="lg" />
          <h1 className="mt-6 text-[22px] font-semibold text-foreground">
            Stakeholder Review
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            Enter the review password to continue.
          </p>
        </div>

        <div className="mt-8 rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-soft">
          <ReviewGateForm next={next} />
        </div>

        {unconfigured ? (
          <Notice tone="attention" className="mt-6">
            This review deployment has no review password configured, so nobody can be
            let in. An operator needs to set the server-side review password
            environment variable and redeploy.
          </Notice>
        ) : null}

        <p className="mt-6 text-center text-[11px] leading-relaxed text-subtle-foreground">
          Temporary review access for {ACTIVE_BRAND.productName}. A session lasts{" "}
          {REVIEW_SESSION_SECONDS / 3600} hours. This is a review deployment reading a
          development database — it is not production, and this shared password is not
          an {ACTIVE_BRAND.productName} account.
        </p>
      </div>
    </main>
  );
}
