import { Suspense } from "react";
import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { Notice } from "@/components/ui/feedback";
import { loadReviewsPage } from "@/features/reviews/load";
import { demoRuntime } from "@/lib/demo/runtime";
import { ReviewsScreen } from "@/features/reviews/reviews-screen";
import { requirePagePermission } from "@/lib/auth/page";

export const metadata: Metadata = {
  title: "Google Reviews",
};

export const dynamic = "force-dynamic";

/**
 * THE GOOGLE REVIEWS PAGE.
 *
 * Reads persisted Google reviews from Supabase and renders the real records,
 * their summaries and the drill-down between them. The filters arrive in the
 * query string, which is what makes every figure on the page a link to the
 * reviews behind it.
 *
 * THE SEEDED SCREEN IS REACHED ONLY WHEN SUPABASE IS NOT CONFIGURED, and the
 * fallback is keyed on that rather than on demo mode for the reason
 * `features/reviews/load.ts` records at length: the mode flag is frozen into
 * the bundle at build time and can go stale, and a page whose whole value is
 * showing REAL reviews must not be gated on a value that can be wrong. A
 * configured deployment with nothing ingested yet shows zeroes and says so —
 * that is a true answer, and falling back to invented figures there is exactly
 * how a demo number gets quoted as a real one.
 */
export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePagePermission("view_google_reviews");

  const props = await loadReviewsPage(await searchParams);

  /*
   * FROM THE DEMO BOUNDARY, so a production build never compiles the seeded
   * reviews screen at all — see `lib/demo/runtime.ts`. Null there, which turns
   * the branch below into an honest notice with nothing under it rather than a
   * page of invented review counts and reviewer names.
   */
  const ReviewsDemoScreen = demoRuntime.screens.reviews;

  return (
    <PermissionGate permission="view_google_reviews">
      <Suspense fallback={null}>
        {props.mode === "live" ? (
          <ReviewsScreen {...props} />
        ) : (
          <>
            {/*
              NAMED, SO IT IS FIXABLE. The variable NAMES are safe to print and
              are the only thing an operator needs; no value is ever shown.
            */}
            <div className="px-5 pt-5 sm:px-6">
              <Notice tone="attention" title="Showing seeded content, not real reviews">
                <p>
                  Supabase is not configured in this deployment, so the real Google
                  review records cannot be read. Missing:{" "}
                  <span className="font-mono text-[12px]">
                    {props.missing.join(", ")}
                  </span>
                  . Everything below this line is invented demo content.
                </p>
              </Notice>
            </div>
            {ReviewsDemoScreen ? <ReviewsDemoScreen /> : null}
          </>
        )}
      </Suspense>
    </PermissionGate>
  );
}
