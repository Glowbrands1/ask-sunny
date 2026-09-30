import "server-only";

import vercelConfig from "../../../../vercel.json";
import { MAX_AUTOMATIC_RETRIES } from "../engine";
import { audienceGroups, contentRows, effectiveInventory, type AudienceGroup, type ContentRow } from "../inventory";
import type { KnowledgeSyncStore, RunRecord } from "../ports";
import { createSupabaseKnowledgeSyncStore, KnowledgeSyncStoreError } from "../store";
import type { AttentionItem, ContentType, InventoryItem, SyncReport, SyncSettings } from "../types";
import { readWovenKnowledgeConfig, type WovenKnowledgeConfig } from "./config";
import { nextAutomaticSyncAt } from "./sync";

/**
 * ============================================================================
 * WHAT THE WOVEN KNOWLEDGE SYNC SCREEN SHOWS — measured, never declared
 * ============================================================================
 *
 * The primary view is five words a busy manager can act on — Not set up,
 * Syncing, Up to date, Needs attention — plus counts. Everything technical
 * (per-type counts, blocked capabilities, error codes, run history) is under
 * `advanced` and rendered in a collapsed section.
 *
 * NO SECRET APPEARS HERE. Runs carry counts, codes and plain sentences; items
 * carry Woven titles and error categories. There is no URL, cookie or token
 * anywhere in the manifest to show.
 */

export const WOVEN_KNOWLEDGE_CRON_PATH = "/api/knowledge-sync/woven/cron";

export type HeadlineState = "not_set_up" | "setup_in_progress" | "syncing" | "up_to_date" | "needs_attention";

export type AudienceReview = AudienceGroup;

export interface FailingItem {
  title: string;
  contentType: ContentType;
  errorCategory: string | null;
  retryCount: number;
  willRetry: boolean;
}

export interface RunSummary {
  id: string;
  mode: RunRecord["mode"];
  trigger: RunRecord["trigger"];
  status: RunRecord["status"];
  startedAt: string;
  finishedAt: string | null;
  errorCode: string | null;
  totals: SyncReport["totals"] | null;
  /** The run's own plain-sentence notes, for Sync History. */
  notes: AttentionItem[];
  company: string | null;
}

export interface WovenKnowledgeStatus {
  enabled: boolean;
  missingCredentials: string[];
  company: string;
  database: "ready" | "missing" | "unavailable";
  /**
   * The sync tables are not installed, and this is a Preview or development
   * deployment: Test Connection and Run Initial Scan work in PREVIEW TEST MODE,
   * with results shown and nothing saved. Always false in Production.
   */
  previewTestMode: boolean;
  headline: HeadlineState;
  setupStep: "connect" | "scan" | "initial_sync" | "enable_auto" | "done";
  settings: SyncSettings | null;
  running: { since: string } | null;
  lastSuccessAt: string | null;
  lastCheckedAt: string | null;
  nextSyncAt: string | null;
  documentsInSync: number;
  lastSync: { new: number; updated: number; removed: number } | null;
  needsAttention: number;
  attention: AttentionItem[];
  latestPreview: SyncReport | null;
  audienceReviews: AudienceReview[];
  /** Parts waiting for an audience choice, under the choices as they stand now. */
  awaitingAudience: number;
  advanced: {
    scheduleDeployed: boolean;
    byType: SyncReport["byType"] | null;
    blockedByCapability: Record<string, number>;
    failingItems: FailingItem[];
    recentRuns: RunSummary[];
    problems: string[];
  };
}

export function scheduleDeployed(config: { crons?: { path: string }[] }): boolean {
  return (config.crons ?? []).some((c) => c.path === WOVEN_KNOWLEDGE_CRON_PATH);
}

function summarize(run: RunRecord): RunSummary {
  return {
    id: run.id,
    mode: run.mode,
    trigger: run.trigger,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    errorCode: run.errorCode,
    totals: run.report?.totals ?? null,
    notes: run.report?.attention ?? [],
    company: run.report?.company?.companyLabel ?? null,
  };
}

export async function readWovenKnowledgeStatus(
  overrides: { config?: WovenKnowledgeConfig; store?: KnowledgeSyncStore } = {},
): Promise<WovenKnowledgeStatus> {
  const config = overrides.config ?? readWovenKnowledgeConfig();
  const base = {
    enabled: config.enabled,
    missingCredentials: config.missingCredentials,
    company: config.company,
  };
  const empty: WovenKnowledgeStatus = {
    ...base,
    database: "ready",
    previewTestMode: false,
    headline: "not_set_up",
    setupStep: "connect",
    settings: null,
    running: null,
    lastSuccessAt: null,
    lastCheckedAt: null,
    nextSyncAt: null,
    documentsInSync: 0,
    lastSync: null,
    needsAttention: 0,
    attention: [],
    latestPreview: null,
    audienceReviews: [],
    awaitingAudience: 0,
    advanced: {
      scheduleDeployed: scheduleDeployed(vercelConfig as { crons?: { path: string }[] }),
      byType: null,
      blockedByCapability: {},
      failingItems: [],
      recentRuns: [],
      problems: config.problems,
    },
  };

  let store: KnowledgeSyncStore;
  let settings: SyncSettings;
  let runs: RunRecord[];
  let manifest: Awaited<ReturnType<KnowledgeSyncStore["loadManifest"]>>;
  let decisions: Awaited<ReturnType<KnowledgeSyncStore["loadDecisions"]>>;
  try {
    store = overrides.store ?? createSupabaseKnowledgeSyncStore();
    [settings, runs, manifest, decisions] = await Promise.all([
      store.loadSettings("woven"),
      store.recentRuns("woven", 12),
      store.loadManifest("woven"),
      store.loadDecisions("woven"),
    ]);
  } catch (error) {
    const missing = error instanceof KnowledgeSyncStoreError && error.code === "sync_tables_missing";
    return {
      ...empty,
      database: missing ? "missing" : "unavailable",
      previewTestMode: missing && config.previewTestModeAllowed,
    };
  }

  const running = runs.find((r) => r.status === "running");
  const finished = runs.filter((r) => r.status !== "running");
  const latest = finished[0] ?? null;
  const lastFullSync = finished.find((r) => r.mode === "sync" && r.status !== "failed") ?? null;
  const latestPreview = finished.find((r) => r.mode === "preview" && r.status !== "failed") ?? null;
  const latestScan = finished.find((r) => r.mode !== "continue" && r.report?.byType) ?? null;

  /*
   * Audiences waiting for a decision, and those already decided (so a
   * decision can be changed) — from the manifest, or before the initial sync
   * from the latest dry run's inventory. A dry run saves no manifest, so
   * without the inventory the screen had counts and no choices to offer.
   */
  const preview = settings.initialSyncCompletedAt ? [] : await loadPreviewSafely(store);
  const inventory = effectiveInventory(manifest, preview, Boolean(settings.initialSyncCompletedAt));
  const audienceReviews = audienceGroups(inventory, decisions);
  const undecided = audienceReviews.filter((a) => a.decision === null && a.items > 0);

  const failingItems: FailingItem[] = manifest
    .filter((i) => i.state === "ERROR")
    .sort((a, b) => b.retryCount - a.retryCount)
    .slice(0, 25)
    .map((i) => ({
      title: i.title,
      contentType: i.contentType,
      errorCategory: i.errorCategory,
      retryCount: i.retryCount,
      willRetry: i.retryCount < MAX_AUTOMATIC_RETRIES,
    }));

  const blockedByCapability: Record<string, number> = {};
  for (const item of inventory) {
    if (item.state === "BLOCKED" && item.reason) blockedByCapability[item.reason] = (blockedByCapability[item.reason] ?? 0) + 1;
  }

  /* Attention: the latest run's own items, then standing ones from the manifest. */
  const attention: AttentionItem[] = [];
  if (latest?.status === "failed") {
    attention.push({ code: latest.errorCode ?? "run_failed", message: latest.report?.attention.at(-1)?.message ?? "The last Woven sync did not finish." });
  } else if (latest?.report) {
    attention.push(...latest.report.attention.filter((a) => a.code !== "audience_review" && a.code !== "items_retrying" && a.code !== "items_failing"));
  }
  if (undecided.length > 0) {
    const count = undecided.reduce((s, a) => s + a.items, 0);
    attention.push({
      code: "audience_review",
      message: `${count} item${count === 1 ? " is" : "s are"} shared with only some teams in Woven. Choose who should see ${count === 1 ? "it" : "them"} in Ask Sunny.`,
      count,
    });
  }
  const exhausted = failingItems.filter((f) => !f.willRetry).length;
  if (exhausted > 0) {
    attention.push({ code: "items_failing", message: `${exhausted} document${exhausted === 1 ? " keeps" : "s keep"} failing to sync. See the details below.`, count: exhausted });
  }
  const needsAttention = undecided.reduce((s, a) => s + a.items, 0) + exhausted + (latest?.status === "failed" ? 1 : 0);

  const configured = config.enabled && config.missingCredentials.length === 0;
  const setupStep: WovenKnowledgeStatus["setupStep"] = !configured
    ? "connect"
    : !settings.initialSyncCompletedAt
      ? latestPreview
        ? "initial_sync"
        : "scan"
      : !settings.autoSyncEnabled
        ? "enable_auto"
        : "done";

  const headline: HeadlineState = !configured
    ? "not_set_up"
    : running
      ? "syncing"
      : attention.some((a) => a.code !== "work_continues")
        ? "needs_attention"
        : setupStep !== "done"
          ? "setup_in_progress"
          : "up_to_date";

  return {
    ...base,
    database: "ready",
    previewTestMode: false,
    headline,
    setupStep,
    settings,
    running: running ? { since: running.startedAt } : null,
    lastSuccessAt: lastFullSync?.finishedAt ?? null,
    lastCheckedAt: settings.lastFullScanAt,
    nextSyncAt: settings.autoSyncEnabled ? nextAutomaticSyncAt(settings) : null,
    documentsInSync: manifest.filter((i) => i.inAskSunny).length,
    lastSync: lastFullSync?.report
      ? {
          new: lastFullSync.report.totals.new,
          updated: lastFullSync.report.totals.updated,
          removed: lastFullSync.report.totals.removed + lastFullSync.report.totals.unpublished,
        }
      : null,
    needsAttention,
    attention,
    latestPreview: !settings.initialSyncCompletedAt ? (latestPreview?.report ?? null) : null,
    audienceReviews,
    awaitingAudience: undecided.reduce((sum, a) => sum + a.items, 0),
    advanced: {
      ...empty.advanced,
      byType: latestScan?.report?.byType ?? null,
      blockedByCapability,
      failingItems,
      recentRuns: runs.map(summarize),
    },
  };
}

/** The dry run's inventory, or none if it cannot be read (it is display data, never load-bearing). */
async function loadPreviewSafely(store: KnowledgeSyncStore): Promise<InventoryItem[]> {
  try {
    return await store.loadPreviewInventory("woven");
  } catch {
    return [];
  }
}

export interface WovenKnowledgeContent {
  /** Where the rows come from: the manifest, or (before the initial sync) the latest dry run. */
  basis: "manifest" | "latest_scan" | "none";
  scannedAt: string | null;
  rows: ContentRow[];
}

/**
 * The Content view: every Woven item found, as one row each, with its parts.
 * `documentTitles` resolves the Ask Sunny titles of synced documents.
 */
export async function readWovenKnowledgeContent(
  overrides: {
    store?: KnowledgeSyncStore;
    documentTitles?: (ids: string[]) => Promise<Map<string, string>>;
    /** Hand uploads superseded by these documents, keyed by the replacing document. */
    supersededUploads?: (ids: string[]) => Promise<Map<string, { id: string; title: string }[]>>;
  } = {},
): Promise<WovenKnowledgeContent> {
  const store = overrides.store ?? createSupabaseKnowledgeSyncStore();
  const [settings, manifest, decisions] = await Promise.all([store.loadSettings("woven"), store.loadManifest("woven"), store.loadDecisions("woven")]);
  const initialDone = Boolean(settings.initialSyncCompletedAt);
  const preview = initialDone ? [] : await loadPreviewSafely(store);
  const inventory = effectiveInventory(manifest, preview, initialDone);
  const synced = [...new Set(inventory.filter((i) => i.inAskSunny && i.knowledgeDocumentId).map((i) => i.knowledgeDocumentId!))];
  const titles = synced.length > 0 && overrides.documentTitles ? await overrides.documentTitles(synced) : new Map<string, string>();
  const superseded =
    synced.length > 0 && overrides.supersededUploads
      ? await overrides.supersededUploads(synced).catch(() => new Map<string, { id: string; title: string }[]>())
      : new Map<string, { id: string; title: string }[]>();
  const seen = inventory.map((i) => i.lastSeenAt).filter(Boolean);
  return {
    basis: inventory.length === 0 ? "none" : initialDone || preview.length === 0 ? "manifest" : "latest_scan",
    scannedAt: seen.length > 0 ? seen.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a)) : null,
    rows: contentRows(inventory, decisions, titles, superseded),
  };
}
