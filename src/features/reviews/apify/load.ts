import "server-only";

import { supabaseReadiness } from "@/lib/config/server-env";
import {
  readApifySourceStatus,
  readSourceReconciliation,
  type SourceReconciliationRow,
} from "@/lib/reviews/apify/status";
import type { ApifySourceStatusReport } from "@/lib/reviews/apify/types";

/**
 * Everything the Google review source screen needs, loaded once on the server.
 *
 * READ ON THE SERVER, WITH THE SERVER'S CLIENT. The run ledger and the location
 * mappings live behind forced row-level security with no policy, exactly as the
 * reviews themselves do — so nothing here is reachable from the browser's
 * publishable key, and the screen receives facts rather than a query.
 */
export type ApifySourceProps =
  | {
      mode: "live";
      source: ApifySourceStatusReport;
      reconciliation: SourceReconciliationRow[];
    }
  | { mode: "unconfigured"; missing: string[] };

export async function loadApifySourcePage(): Promise<ApifySourceProps> {
  const readiness = supabaseReadiness();
  if (!readiness.ready) return { mode: "unconfigured", missing: readiness.missing };

  const [source, reconciliation] = await Promise.all([
    readApifySourceStatus(),
    readSourceReconciliation(),
  ]);

  return { mode: "live", source, reconciliation };
}
