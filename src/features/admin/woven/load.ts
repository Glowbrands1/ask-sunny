import "server-only";

import vercelConfig from "../../../../vercel.json";
import { isDemoMode } from "@/lib/config/runtime";
import { supabaseReadiness } from "@/lib/config/server-env";
import { readWovenConfig } from "@/lib/employees/woven/config";
import { readWovenSyncStatus, WovenStatusError, type WovenSyncStatus } from "@/lib/employees/woven/status";

/**
 * Everything the Woven Employee Sync screen shows, read on the server.
 *
 * EVERY STATE ON THE SCREEN IS MEASURED OR EVIDENCED, NOT DECLARED:
 *
 *   credentials         which variables are set, by NAME — never a value
 *   sign-in             only from a recorded run that got past the token
 *                       exchange; nothing else proves it
 *   directory           the database's own answer, and a missing table is kept
 *                       apart from a database that did not answer
 *   daily schedule      the cron entry must be in THIS BUILD'S vercel.json, the
 *                       switch must be on, AND a scheduled run must have
 *                       succeeded. A switch alone proves nothing.
 */

export const WOVEN_CRON_PATH = "/api/employees/woven/cron";

export type DatabaseState =
  | { state: "ready"; status: WovenSyncStatus }
  | { state: "missing" }
  | { state: "unavailable"; code: string | null }
  | { state: "unconfigured" };

export interface WovenSyncPageProps {
  enabled: boolean;
  scheduleEnabled: boolean;
  /** Whether this build's vercel.json schedules the Woven cron route. */
  scheduleDeployed: boolean;
  /** False in demo mode, where the live check is refused by design. */
  liveMode: boolean;
  /** Credential variable names not yet set. Never values. */
  missingCredentials: string[];
  /** Approved work-email domains. Not secret. */
  workEmailDomains: string[];
  database: DatabaseState;
}

export function cronDeployed(config: { crons?: { path: string }[] }): boolean {
  return (config.crons ?? []).some((c) => c.path === WOVEN_CRON_PATH);
}

export async function loadWovenSyncPage(): Promise<WovenSyncPageProps> {
  const config = readWovenConfig();
  const base = {
    enabled: config.enabled,
    scheduleEnabled: config.scheduleEnabled,
    scheduleDeployed: cronDeployed(vercelConfig as { crons?: { path: string }[] }),
    liveMode: !isDemoMode(),
    missingCredentials: config.missingCredentials,
    workEmailDomains: config.workEmailDomains,
  };

  if (!supabaseReadiness().ready) return { ...base, database: { state: "unconfigured" } };

  try {
    return { ...base, database: { state: "ready", status: await readWovenSyncStatus() } };
  } catch (error) {
    if (error instanceof WovenStatusError && error.reason === "missing") {
      return { ...base, database: { state: "missing" } };
    }
    return {
      ...base,
      database: { state: "unavailable", code: error instanceof WovenStatusError ? error.code : null },
    };
  }
}
