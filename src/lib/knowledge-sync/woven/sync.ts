import "server-only";

import { isDueForContinue, runKnowledgeSync, type EngineDeps, type RunOutcome } from "../engine";
import { MemoryKnowledgeSyncStore } from "../memory-store";
import { SinkError, type KnowledgeSink, type KnowledgeSyncStore } from "../ports";
import { createSupabaseKnowledgeSink } from "../sink";
import { createSupabaseKnowledgeSyncStore, KnowledgeSyncStoreError } from "../store";
import { CONTENT_TYPES, type ContentType, type KnowledgeSourceConnector, type ManifestItem, type RunMode, type RunTrigger, type SyncSettings } from "../types";
import { parseHandbookList } from "./adapters";
import { readWovenKnowledgeConfig, WOVEN_KNOWLEDGE_SYNC_ENABLED_ENV, type WovenKnowledgeConfig } from "./config";
import { COMPANY_WIDE_AUDIENCE_LABELS, HANDBOOK_LIST_PATH } from "./contract";
import { WovenConnectorError, WovenKnowledgeConnector } from "./connector";
import { describeWovenItem } from "./describe";
import { WovenTeamClient } from "./http";

/**
 * ============================================================================
 * THE WOVEN KNOWLEDGE SYNC — what the routes call
 * ============================================================================
 *
 * "Test Connection", "Run Initial Scan", "Sync Now" and the scheduled tick all
 * land here and all run `runKnowledgeSync` — there is no separate manual or
 * automatic implementation.
 *
 * TIME BUDGET. A route may run for 300 s. The engine stops starting new items
 * at 240 s and the HTTP client stops starting requests at 270 s, so the run is
 * always recorded. Anything not reached is `deferred` and finished by the next
 * daily tick in `continue` mode — which is how a large initial sync completes
 * unattended.
 */

export const SCHEDULE_REQUESTER = "schedule";
const ITEM_BUDGET_MS = 240_000;
const REQUEST_BUDGET_MS = 270_000;

export type WovenRunOutcome =
  | (RunOutcome & { previewTestMode?: true })
  | { status: "disabled"; reason: string }
  | { status: "not_configured"; missing: string[] };

/**
 * The sink used in PREVIEW TEST MODE. A preview never writes to Ask Sunny —
 * the engine returns before applying anything — and this makes that a
 * guarantee rather than a property of the engine: every write throws. The one
 * read (titles of hand-uploaded documents, for the duplicate count) passes
 * through unchanged.
 */
export function readOnlySink(inner: KnowledgeSink): KnowledgeSink {
  const refuse = async (): Promise<never> => {
    throw new SinkError("preview_test_mode", "Preview test mode never writes to Ask Sunny.", false);
  };
  return {
    ingest: refuse,
    updateMetadata: refuse,
    retire: refuse,
    countManualTitleMatches: (titles) => inner.countManualTitleMatches(titles),
  };
}

/**
 * The store for this run. Normally the Supabase store. In PREVIEW TEST MODE —
 * a preview, outside Production, with the knowledge-sync tables not installed —
 * an in-memory store that lives only as long as this request, so the dry run
 * reads Woven and returns its report without persisting any sync state.
 */
async function storeForRun(
  mode: RunMode,
  config: WovenKnowledgeConfig,
  supabaseStore: () => KnowledgeSyncStore,
): Promise<{ store: KnowledgeSyncStore; testMode: boolean }> {
  const store = supabaseStore();
  if (mode !== "preview") return { store, testMode: false };
  try {
    await store.loadSettings("woven");
    return { store, testMode: false };
  } catch (error) {
    const missing = error instanceof KnowledgeSyncStoreError && error.code === "sync_tables_missing";
    if (missing && config.previewTestModeAllowed) {
      return { store: new MemoryKnowledgeSyncStore(), testMode: true };
    }
    throw error;
  }
}

export interface WovenSyncOverrides {
  config?: WovenKnowledgeConfig;
  store?: KnowledgeSyncStore;
  /** Builds the Supabase store (injectable so tests can simulate missing tables). */
  supabaseStore?: () => KnowledgeSyncStore;
  sink?: KnowledgeSink;
  connector?: KnowledgeSourceConnector;
  now?: () => Date;
  contentTypes?: readonly ContentType[];
}

function gate(config: WovenKnowledgeConfig): Extract<WovenRunOutcome, { status: "disabled" | "not_configured" }> | null {
  if (!config.enabled) return { status: "disabled", reason: `${WOVEN_KNOWLEDGE_SYNC_ENABLED_ENV} is not on, so nothing reaches Woven.` };
  if (!config.credentials) return { status: "not_configured", missing: config.missingCredentials };
  return null;
}

function buildConnector(config: WovenKnowledgeConfig, startedAt: number): WovenKnowledgeConnector {
  return new WovenKnowledgeConnector({
    client: new WovenTeamClient({
      baseUrl: config.baseUrl,
      deadlineAt: startedAt + REQUEST_BUDGET_MS,
      antiForgeryHeader: config.antiForgeryHeader,
    }),
    credentials: config.credentials!,
    company: config.company,
    companyId: config.companyId,
  });
}

export async function runWovenKnowledgeSync(
  options: { mode: RunMode; trigger: RunTrigger; requestedBy: string; confirmLargeRemoval?: boolean },
  overrides: WovenSyncOverrides = {},
): Promise<WovenRunOutcome> {
  const config = overrides.config ?? readWovenKnowledgeConfig();
  const closed = gate(config);
  if (closed) return closed;

  const now = overrides.now ?? (() => new Date());
  const startedAt = now().getTime();
  const { store, testMode } = overrides.store
    ? { store: overrides.store, testMode: false }
    : await storeForRun(options.mode, config, overrides.supabaseStore ?? createSupabaseKnowledgeSyncStore);
  const sink = overrides.sink ?? createSupabaseKnowledgeSink("woven");
  const deps: EngineDeps = {
    connector: overrides.connector ?? buildConnector(config, startedAt),
    store,
    sink: testMode ? readOnlySink(sink) : sink,
    describe: describeWovenItem,
    companyWideLabels: COMPANY_WIDE_AUDIENCE_LABELS,
    contentTypes: overrides.contentTypes ?? CONTENT_TYPES,
    now,
    deadlineAt: startedAt + ITEM_BUDGET_MS,
  };
  const outcome = await runKnowledgeSync(deps, options);
  return testMode && "runId" in outcome ? { ...outcome, previewTestMode: true } : outcome;
}

/* ------------------------------------------------------ test connection -- */

export type ConnectionTest =
  | { status: "ok"; company: string; handbooksVisible: number }
  | { status: "failed"; code: string; reason: string }
  | Extract<WovenRunOutcome, { status: "disabled" | "not_configured" }>;

/**
 * Signs in, confirms the company and reads one small list. Writes nothing
 * anywhere. What "Test Connection" does.
 */
export async function testWovenConnection(overrides: { config?: WovenKnowledgeConfig; client?: WovenTeamClient } = {}): Promise<ConnectionTest> {
  const config = overrides.config ?? readWovenKnowledgeConfig();
  const closed = gate(config);
  if (closed) return closed;
  const client =
    overrides.client ??
    new WovenTeamClient({ baseUrl: config.baseUrl, deadlineAt: Date.now() + 60_000, antiForgeryHeader: config.antiForgeryHeader });
  const connector = new WovenKnowledgeConnector({
    client,
    credentials: config.credentials!,
    company: config.company,
    companyId: config.companyId,
  });
  try {
    const info = await connector.connect();
    const handbooks = parseHandbookList(await client.postJson(HANDBOOK_LIST_PATH, undefined));
    return { status: "ok", company: info.companyLabel ?? config.company, handbooksVisible: handbooks.length };
  } catch (error) {
    if (error instanceof WovenConnectorError) return { status: "failed", code: error.code, reason: error.message };
    return {
      status: "failed",
      code: (error as { code?: string }).code ? `woven_${(error as { code: string }).code}` : "woven_unexpected",
      reason: error instanceof Error ? error.message : "The connection test failed.",
    };
  }
}

/* ------------------------------------------------------------ schedule -- */

export type ScheduledWork =
  | { run: "sync" }
  | { run: "continue" }
  | { run: "none"; reason: "auto_sync_off" | "initial_sync_not_done" | "not_due" };

/** When the next automatic full sync is due, or null before the initial sync. */
export function nextAutomaticSyncAt(settings: SyncSettings): string | null {
  if (!settings.initialSyncCompletedAt) return null;
  const from = settings.lastFullScanAt ?? settings.initialSyncCompletedAt;
  return new Date(Date.parse(from) + settings.intervalDays * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * What the daily tick should do. The schedule fires every day; a FULL sync
 * happens only when 30 days have passed since the last complete scan (so a
 * scan that failed is simply tried again the next day). On the days between,
 * it finishes deferred work and retries failed items, and otherwise does
 * nothing — it does not even sign in to Woven.
 */
export function decideScheduledWork(settings: SyncSettings, manifest: ManifestItem[], now: Date): ScheduledWork {
  if (!settings.initialSyncCompletedAt) return { run: "none", reason: "initial_sync_not_done" };
  if (!settings.autoSyncEnabled) return { run: "none", reason: "auto_sync_off" };
  const next = nextAutomaticSyncAt(settings)!;
  if (now.getTime() >= Date.parse(next)) return { run: "sync" };
  if (manifest.some((item) => isDueForContinue(item, now))) return { run: "continue" };
  return { run: "none", reason: "not_due" };
}

export async function runScheduledWovenKnowledgeTick(overrides: WovenSyncOverrides = {}): Promise<WovenRunOutcome | { status: "skipped"; reason: string }> {
  const config = overrides.config ?? readWovenKnowledgeConfig();
  const closed = gate(config);
  if (closed) return closed;
  const store = overrides.store ?? createSupabaseKnowledgeSyncStore();
  const now = overrides.now ?? (() => new Date());
  const work = decideScheduledWork(await store.loadSettings("woven"), await store.loadManifest("woven"), now());
  if (work.run === "none") return { status: "skipped", reason: work.reason };
  return runWovenKnowledgeSync({ mode: work.run, trigger: "schedule", requestedBy: SCHEDULE_REQUESTER }, { ...overrides, config, store });
}
