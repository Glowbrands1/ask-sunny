import "server-only";

import { buildOverview, type ApifyGlance } from "./overview";
import type { GbpOverview } from "./overview-types";
import { createSupabaseStore } from "./store";

/** Reads the overview. Shared by the admin page (on the server) and the status API (for refreshes). */
export async function loadGbpOverview(apify: ApifyGlance): Promise<GbpOverview> {
  const rows = await createSupabaseStore().readOverviewRows();
  return buildOverview(rows, apify);
}

/** The few facts about Apify the Google section shows beside its own. */
export function apifyGlance(source: {
  enabled: boolean;
  scheduleEnabled: boolean;
  lastRun: { startedAt: string; finishedAt: string | null; status: string } | null;
  lastSuccessfulRun: { finishedAt: string | null } | null;
}): ApifyGlance {
  return {
    enabled: source.enabled,
    scheduleEnabled: source.scheduleEnabled,
    lastRunAt: source.lastRun?.finishedAt ?? source.lastRun?.startedAt ?? null,
    lastRunStatus: source.lastRun?.status ?? null,
    lastSuccessAt: source.lastSuccessfulRun?.finishedAt ?? null,
  };
}
