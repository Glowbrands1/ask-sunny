import "server-only";

import { supabaseReadiness } from "@/lib/config/server-env";
import {
  loadAnchorCandidates,
  loadAnchorSetup,
  type AnchorCandidate,
  type AnchorSetupRow,
} from "@/lib/reviews/anchor-admin";
import { isAllowedStoreCode } from "@/lib/reviews/store-codes";
import { isDemoMode } from "@/lib/config/runtime";
import { demoAnchorCandidates, demoAnchorSetupRows } from "@/lib/demo/reviews-admin-fixtures";

/**
 * Everything the anchor setup screen needs, loaded once.
 *
 * THE CANDIDATE LIST IS LOADED FOR ONE LISTING AT A TIME, named by `?store=`.
 * Loading fifteen listings' held reviews to draw a page where at most one
 * picker is open would be a payload nobody reads — and keying it on the URL
 * means the open picker survives a refresh and is a link somebody can be sent,
 * which is the same decision the dashboard's filters make.
 */

export type AnchorSetupProps =
  | {
      mode: "live";
      rows: AnchorSetupRow[];
      /** The listing whose picker is open, or null. */
      openStoreCode: string | null;
      candidates: AnchorCandidate[];
    }
  | { mode: "unconfigured"; missing: string[] };

export async function loadAnchorSetupPage(
  searchParams: Record<string, string | string[] | undefined>,
): Promise<AnchorSetupProps> {
  const raw = searchParams.store;
  const requested = Array.isArray(raw) ? raw[0] : raw;
  /* Only one of the fifteen. A hand-edited code opens no picker at all. */
  const openStoreCode =
    typeof requested === "string" && isAllowedStoreCode(requested) ? requested : null;

  /*
   * DEMO: the seeded /reviews figures as baselines. A demo deployment never
   * holds the Supabase key. See `lib/demo/reviews-admin-fixtures.ts`.
   */
  if (isDemoMode()) {
    return {
      mode: "live",
      rows: demoAnchorSetupRows(),
      openStoreCode,
      candidates: openStoreCode ? demoAnchorCandidates(openStoreCode) : [],
    };
  }

  const readiness = supabaseReadiness();
  if (!readiness.ready) return { mode: "unconfigured", missing: readiness.missing };

  const [rows, candidates] = await Promise.all([
    loadAnchorSetup(),
    openStoreCode ? loadAnchorCandidates(openStoreCode) : Promise.resolve([]),
  ]);

  return { mode: "live", rows, openStoreCode, candidates };
}
