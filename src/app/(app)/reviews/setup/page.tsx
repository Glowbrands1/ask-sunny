import { Suspense } from "react";
import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { Notice } from "@/components/ui/feedback";
import { AnchorSetupScreen } from "@/features/reviews/setup/anchor-setup-screen";
import { loadAnchorSetupPage } from "@/features/reviews/setup/load";
import { requirePagePermission } from "@/lib/auth/page";
import { isDemoMode } from "@/lib/config/runtime";

export const metadata: Metadata = {
  title: "Review Baselines",
};

export const dynamic = "force-dynamic";

/**
 * GOOGLE REVIEW BASELINE SETUP.
 *
 * ============================================================================
 * GATED ON `manage_integrations`, NOT ON `view_google_reviews`
 * ============================================================================
 *
 * The dashboard is held by most of the org chart, because reading reviews is
 * everybody's job. Setting a baseline is not: it decides what the business
 * counts, and it is the same kind of act as connecting the integration in the
 * first place — so it takes the same permission the Integrations screen does,
 * which `admin`, `owner` and `developer` hold and nobody else.
 *
 * The guard runs on the SERVER before any row is read, so a refused caller
 * never receives the data they would have been shown. `PermissionGate` behind
 * it is the second line, for demo mode where the server guards deliberately do
 * not enforce.
 */
export default async function ReviewSetupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePagePermission("manage_integrations");

  const props = await loadAnchorSetupPage(await searchParams);

  return (
    <PermissionGate permission="manage_integrations" adminOnly>
      <Suspense fallback={null}>
        {props.mode === "live" && isDemoMode() ? (
          <div className="px-5 pt-5 sm:px-6">
            <Notice tone="attention" title="Showing seeded content, not real reviews">
              <p>
                This is a demo deployment, and demo deployments never read the review database. The page below is the live Review Baselines screen; the held and counted figures match the seeded Google Reviews page, and every reviewer on it is invented demo content.
              </p>
            </Notice>
          </div>
        ) : null}
        {props.mode === "live" ? (
          <AnchorSetupScreen
            rows={props.rows}
            openStoreCode={props.openStoreCode}
            candidates={props.candidates}
          />
        ) : (
          <div className="px-5 pt-5 sm:px-6">
            <Notice tone="attention" title="Supabase is not configured">
              <p>
                Review baselines cannot be read or set in this deployment. Missing:{" "}
                <span className="font-mono text-[12px]">{props.missing.join(", ")}</span>.
              </p>
            </Notice>
          </div>
        )}
      </Suspense>
    </PermissionGate>
  );
}
