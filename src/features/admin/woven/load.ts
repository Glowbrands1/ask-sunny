import "server-only";

import { supabaseReadiness } from "@/lib/config/server-env";
import { readWovenConfig } from "@/lib/employees/woven/config";
import { readWovenSyncStatus, type WovenSyncStatus } from "@/lib/employees/woven/status";

/**
 * Everything the Woven Employee Sync screen shows, read on the server.
 *
 * EVERY STATE ON THE SCREEN IS MEASURED, NOT DECLARED. Whether credentials are
 * present, whether the directory tables exist, whether the schedule is on —
 * each is read from this deployment. Credentials are reported by variable NAME
 * only; no value ever reaches this object.
 */
export interface WovenSyncPageProps {
  enabled: boolean;
  scheduleEnabled: boolean;
  /** Credential variable names not yet set. Never values. */
  missingCredentials: string[];
  database:
    | { state: "ready"; status: WovenSyncStatus }
    | { state: "not_created" }
    | { state: "unconfigured" };
}

export async function loadWovenSyncPage(): Promise<WovenSyncPageProps> {
  const config = readWovenConfig();
  const base = {
    enabled: config.enabled,
    scheduleEnabled: config.scheduleEnabled,
    missingCredentials: config.missingCredentials,
  };

  if (!supabaseReadiness().ready) return { ...base, database: { state: "unconfigured" } };

  try {
    return { ...base, database: { state: "ready", status: await readWovenSyncStatus() } };
  } catch {
    /* The directory migration is prepared but not applied until after the first live check. */
    return { ...base, database: { state: "not_created" } };
  }
}
