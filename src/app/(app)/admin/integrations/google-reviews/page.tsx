import { Suspense } from "react";
import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { Notice } from "@/components/ui/feedback";
import { loadApifySourcePage } from "@/features/reviews/apify/load";
import { ApifySourceScreen } from "@/features/reviews/apify/source-screen";
import { requirePagePermission } from "@/lib/auth/page";
import { isDemoMode } from "@/lib/config/runtime";

export const metadata: Metadata = {
  title: "Google Review Source",
};

export const dynamic = "force-dynamic";

/**
 * THE GOOGLE REVIEW SOURCE SCREEN — the Apify integration's status and controls.
 *
 * ============================================================================
 * GATED ON `manage_integrations`, LIKE EVERY OTHER SETUP SURFACE HERE
 * ============================================================================
 *
 * `view_google_reviews` is held by most of the org chart and reads the
 * dashboard. This screen does three things that are not that: it starts runs
 * that cost money, it decides which Google listing a salon IS, and it shows the
 * configuration by variable name. All three belong with `admin`, `owner` and
 * `developer` — the same three the Integrations page and the anchor setup are
 * already held to.
 *
 * The guard runs on the SERVER before a row is read, so a refused caller never
 * receives the data they would have been shown. `PermissionGate` behind it is
 * the second line, for demo mode where the server guards deliberately do not
 * enforce.
 */
export default async function GoogleReviewSourcePage() {
  await requirePagePermission("manage_integrations");

  const props = await loadApifySourcePage();

  return (
    <PermissionGate permission="manage_integrations" adminOnly>
      <Suspense fallback={null}>
        {props.mode === "live" && isDemoMode() ? (
          <div className="px-5 pt-5 sm:px-6">
            <Notice tone="attention" title="Showing seeded content, not real reviews">
              <p>
                This is a demo deployment, and demo deployments never contact Apify or read the review database. The page below is the live Google Review Source screen; every run, Place ID, street address and figure on it is invented demo content.
              </p>
            </Notice>
          </div>
        ) : null}
        {props.mode === "live" ? (
          <ApifySourceScreen source={props.source} reconciliation={props.reconciliation} />
        ) : (
          <div className="px-5 pt-5 sm:px-6">
            <Notice tone="attention" title="Supabase is not configured">
              <p>
                The Google review source cannot be read in this deployment. Missing:{" "}
                <span className="font-mono text-[12px]">{props.missing.join(", ")}</span>.
              </p>
            </Notice>
          </div>
        )}
      </Suspense>
    </PermissionGate>
  );
}
