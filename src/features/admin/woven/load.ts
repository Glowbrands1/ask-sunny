import "server-only";

import vercelConfig from "../../../../vercel.json";
import { isDemoMode } from "@/lib/config/runtime";
import { supabaseReadiness } from "@/lib/config/server-env";
import { loadAccessPreviewRows } from "@/lib/employees/woven/access-preview";
import { readWovenConfig } from "@/lib/employees/woven/config";
import { loadChangePage, loadDirectoryRows, loadRuns } from "@/lib/employees/woven/directory";
import { listWovenLocations } from "@/lib/employees/woven/locations";
import { listWovenPositions } from "@/lib/employees/woven/positions";
import {
  readOverviewCounts,
  readWovenSyncStatus,
  WovenStatusError,
  type WovenSyncStatus,
} from "@/lib/employees/woven/status";
import type {
  AccessPreviewRow,
  ChangePage,
  DirectoryPage,
  LocationMappingRow,
  OverviewCounts,
  PositionMappingRow,
  RunRow,
} from "@/lib/employees/woven/view-types";
import {
  accessDrift,
  parseChangeQuery,
  parseDirectoryQuery,
  queryChanges,
  queryDirectory,
} from "@/lib/employees/woven/views";
import { wovenSampleForThisDeployment } from "./sample";

/**
 * Everything the Woven Employee Sync screens show, read on the server.
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
 *
 * SAMPLE OR REAL, NEVER BOTH. In a demo build (`sample.ts`) the tabs render the
 * labelled sample set and read nothing from Supabase; otherwise they read the
 * database and never the sample.
 */

export const WOVEN_CRON_PATH = "/api/employees/woven/cron";

export type DatabaseState =
  | { state: "ready"; status: WovenSyncStatus }
  | { state: "missing" }
  | { state: "unavailable"; code: string | null }
  | { state: "unconfigured" };

export interface WovenSyncPageProps {
  /** WOVEN_SYNC_ENABLED: "Run employee sync" may be used. */
  enabled: boolean;
  /** WOVEN_VALIDATION_ENABLED: "Test Woven connection" may be used. Opens no sync. */
  validationEnabled: boolean;
  scheduleEnabled: boolean;
  /** Whether this build's vercel.json schedules the Woven cron route. */
  scheduleDeployed: boolean;
  /** False in demo mode, where the live check is refused by design. */
  liveMode: boolean;
  /** Credential variable names not yet set. Never values. */
  missingCredentials: string[];
  /** Login-eligible email domains. Not secret. Empty: nobody is login-eligible. */
  loginEmailDomains: string[];
  database: DatabaseState;
  /** The Overview's cards, when they could be read (or the sample's, in a demo build). */
  overview: OverviewCounts | null;
  /** The sample label when this screen is showing sample data. */
  sampleLabel: string | null;
}

export function cronDeployed(config: { crons?: { path: string }[] }): boolean {
  return (config.crons ?? []).some((c) => c.path === WOVEN_CRON_PATH);
}

export async function loadWovenSyncPage(): Promise<WovenSyncPageProps> {
  const config = readWovenConfig();
  const sample = await wovenSampleForThisDeployment();
  const base = {
    enabled: config.enabled,
    validationEnabled: config.validationEnabled,
    scheduleEnabled: config.scheduleEnabled,
    scheduleDeployed: cronDeployed(vercelConfig as { crons?: { path: string }[] }),
    liveMode: !isDemoMode(),
    missingCredentials: config.missingCredentials,
    loginEmailDomains: sample ? [...sample.loginEmailDomains] : config.loginEmailDomains,
    overview: sample?.overview ?? null,
    sampleLabel: sample?.label ?? null,
  };

  if (!supabaseReadiness().ready) return { ...base, database: { state: "unconfigured" } };

  try {
    const status = await readWovenSyncStatus();
    const overview = sample ? sample.overview : await readOverviewCounts();
    return { ...base, overview, database: { state: "ready", status } };
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

/* ------------------------------------------------------------- the tabs -- */

export const WOVEN_VIEWS = ["directory", "changes", "runs", "mappings", "preview"] as const;
export type WovenView = (typeof WOVEN_VIEWS)[number];

export function isWovenView(value: string): value is WovenView {
  return (WOVEN_VIEWS as readonly string[]).includes(value);
}

/**
 * Which tabs show people. They need `manage_users` as well as
 * `manage_integrations`; Sync History is counts only.
 */
export function viewShowsPeople(view: WovenView): boolean {
  return view !== "runs";
}

export type ViewData =
  | { view: "directory"; page: DirectoryPage }
  | { view: "changes"; page: ChangePage }
  | { view: "runs"; runs: RunRow[] }
  | { view: "mappings"; locations: LocationMappingRow[]; positions: PositionMappingRow[] }
  | { view: "preview"; rows: AccessPreviewRow[]; drift: AccessPreviewRow[]; loginEmailDomains: string[]; sampleRows: AccessPreviewRow[] | null };

export type ViewState =
  | { state: "ready"; data: ViewData }
  | { state: "missing" }
  | { state: "unavailable"; code: string | null }
  | { state: "unconfigured" };

export interface WovenViewProps {
  view: WovenView;
  sampleLabel: string | null;
  /** False in demo mode: the routes behind every action refuse there. */
  liveMode: boolean;
  content: ViewState;
}

type Params = Record<string, string | string[] | undefined>;

export async function loadWovenView(view: WovenView, params: Params): Promise<WovenViewProps> {
  const sample = await wovenSampleForThisDeployment();
  const common = { view, sampleLabel: sample?.label ?? null, liveMode: !isDemoMode() };

  if (sample) {
    const data: ViewData = (() => {
      switch (view) {
        case "directory":
          return { view, page: queryDirectory(sample.directory, parseDirectoryQuery(params)) };
        case "changes":
          return { view, page: queryChanges(sample.changes, parseChangeQuery(params)) };
        case "runs":
          return { view, runs: [...sample.runs] };
        case "mappings":
          return { view, locations: [...sample.locations], positions: [...sample.positions] };
        case "preview":
          return {
            view,
            rows: [...sample.accessPreview],
            drift: accessDrift(sample.accessPreview),
            loginEmailDomains: [...sample.loginEmailDomains],
            sampleRows: [...sample.accessPreview],
          };
      }
    })();
    return { ...common, content: { state: "ready", data } };
  }

  if (!supabaseReadiness().ready) return { ...common, content: { state: "unconfigured" } };

  try {
    const data: ViewData = await (async (): Promise<ViewData> => {
      switch (view) {
        case "directory":
          return { view, page: queryDirectory(await loadDirectoryRows(), parseDirectoryQuery(params)) };
        case "changes":
          return { view, page: await loadChangePage(parseChangeQuery(params)) };
        case "runs":
          return { view, runs: await loadRuns() };
        case "mappings": {
          const [locations, positions] = await Promise.all([listWovenLocations(), listWovenPositions()]);
          return { view, locations, positions };
        }
        case "preview": {
          const domains = readWovenConfig().loginEmailDomains;
          const rows = await loadAccessPreviewRows(domains);
          return { view, rows, drift: accessDrift(rows), loginEmailDomains: domains, sampleRows: null };
        }
      }
    })();
    return { ...common, content: { state: "ready", data } };
  } catch (error) {
    if (error instanceof WovenStatusError && error.reason === "missing") return { ...common, content: { state: "missing" } };
    return { ...common, content: { state: "unavailable", code: error instanceof WovenStatusError ? error.code : null } };
  }
}
