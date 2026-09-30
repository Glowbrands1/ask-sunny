import "server-only";

import vercelConfig from "../../../../vercel.json";
import { MAX_AUTOMATIC_RETRIES } from "../engine";
import { audienceGroups, contentRows, effectiveInventory, heldForAudience, type AudienceGroup, type ContentRow } from "../inventory";
import type { KnowledgeSyncStore, RunRecord } from "../ports";
import { createSupabaseKnowledgeSyncStore, KnowledgeSyncStoreError } from "../store";
import { plainErrorReason } from "../error-reasons";
import type { AttentionDetail, AttentionItem, ContentType, InventoryItem, ManifestItem, SyncReport, SyncSettings } from "../types";
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
  /**
   * The latest SCAN (preview) when it is newer than the last sync — before
   * setup, or after it from "Scan Woven": what Sync Now would do.
   */
  latestPreview: SyncReport | null;
  latestScanAt: string | null;
  /** Plain sentences about what the latest scan could not read. */
  scanProblems: string[];
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
    latestScanAt: null,
    scanProblems: [],
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
  const latestApply = finished.find((r) => r.mode !== "preview" && r.status !== "failed") ?? null;
  /* A scan newer than anything applied: it describes Woven now, and what Sync Now would do. */
  const scanIsNewer = latestPreview !== null && (latestApply === null || Date.parse(latestPreview.startedAt) > Date.parse(latestApply.startedAt));
  const latestScan = finished.find((r) => r.mode !== "continue" && r.report?.byType) ?? null;

  /*
   * Audiences waiting for a decision, and those already decided (so a
   * decision can be changed) — from the manifest, or before the initial sync
   * from the latest dry run's inventory. A dry run saves no manifest, so
   * without the inventory the screen had counts and no choices to offer.
   */
  const preview = !settings.initialSyncCompletedAt || scanIsNewer ? await loadPreviewSafely(store) : [];
  const inventory = effectiveInventory(manifest, preview, Boolean(settings.initialSyncCompletedAt), scanIsNewer);
  const rows = contentRows(inventory, decisions);
  /* Only the records a choice actually decides: a draft or an unsupported item with the same audience is not affected by it. */
  const decidedBy = new Set(inventory.filter(heldForAudience).map((i) => `${i.contentType}:${i.entityId}`));
  const audienceReviews = audienceGroups(inventory, decisions).map((group) => {
    const members = rows.filter((r) => r.audienceKey === group.audienceKey && decidedBy.has(r.key));
    return { ...group, members: members.slice(0, MEMBERS_SHOWN), membersTotal: members.length };
  });
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

  /*
   * Attention: the latest run's own items, then STANDING ones measured from
   * the manifest now — so "still being processed" and "keeps failing" say
   * what is true at this moment, not what was true when a run ended.
   */
  const attention: AttentionItem[] = [];
  const STANDING = new Set(["audience_review", "items_retrying", "items_failing", "work_continues"]);
  if (latest?.status === "failed") {
    attention.push({ code: latest.errorCode ?? "run_failed", message: latest.report?.attention.at(-1)?.message ?? "The last Woven sync did not finish." });
  } else if (latest?.report) {
    attention.push(...latest.report.attention.filter((a) => !STANDING.has(a.code)));
  }
  const queued = manifest.filter((i) => i.pendingAction !== "none" && i.state !== "ERROR" && i.retryCount < MAX_AUTOMATIC_RETRIES);
  if (queued.length > 0) {
    const n = queued.length;
    attention.push({
      code: "work_continues",
      message: settings.autoSyncEnabled
        ? `${n} item${n === 1 ? " is" : "s are"} still being processed. Ask Sunny continues ${n === 1 ? "it" : "them"} automatically at the next hourly check.`
        : `${n} item${n === 1 ? " is" : "s are"} still being processed. Automatic sync is off, so ${n === 1 ? "it continues" : "they continue"} when you press Sync Now.`,
      count: n,
    });
  }
  if (undecided.length > 0) {
    const count = undecided.reduce((s, a) => s + a.items, 0);
    attention.push({
      code: "audience_review",
      message: `${count} item${count === 1 ? " is" : "s are"} shared with only some teams in Woven. Choose who should see ${count === 1 ? "it" : "them"} in Ask Sunny.`,
      count,
    });
  }
  const errored = manifest.filter((i) => i.state === "ERROR");
  const stopped = errored.filter((i) => i.retryCount >= MAX_AUTOMATIC_RETRIES);
  const retrying = errored.filter((i) => i.retryCount < MAX_AUTOMATIC_RETRIES);
  const exhausted = stopped.length;
  if (exhausted > 0) {
    attention.push({
      code: "items_failing",
      message: `${exhausted} document${exhausted === 1 ? " could" : "s could"} not be synced and ${exhausted === 1 ? "needs" : "need"} a person. Ask Sunny has stopped retrying ${exhausted === 1 ? "it" : "them"}.`,
      count: exhausted,
      items: stopped.slice(0, 25).map((i) => detail(i, "stopped")),
    });
  }
  if (retrying.length > 0) {
    const n = retrying.length;
    attention.push({
      code: "items_retrying",
      message: `${n} document${n === 1 ? "" : "s"} could not be synced this time. Ask Sunny will retry automatically.`,
      count: n,
      items: retrying.slice(0, 25).map((i) => detail(i, "retrying")),
    });
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
      : attention.some((a) => a.code !== "work_continues" && a.code !== "items_retrying" && a.code !== "uploads_superseded")
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
    latestPreview: !settings.initialSyncCompletedAt || scanIsNewer ? (latestPreview?.report ?? null) : null,
    latestScanAt: latestPreview?.finishedAt ?? null,
    scanProblems: latestPreview?.report && (!settings.initialSyncCompletedAt || scanIsNewer) ? scanProblemsOf(latestPreview.report) : [],
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

/** How many items per audience group the screen lists by title. */
const MEMBERS_SHOWN = 200;

function detail(item: ManifestItem, retry: AttentionDetail["retry"]): AttentionDetail {
  return {
    title: (item.recordTitle ?? "").trim() || item.title,
    contentType: item.contentType,
    reason: plainErrorReason(item.errorCategory),
    retry,
    nextRetryAt: retry === "retrying" ? item.nextRetryAt : null,
    rowKey: `${item.contentType}:${item.entityId}`,
  };
}

const TYPE_LABEL: Record<ContentType, string> = {
  policy: "Policies",
  handbook: "Handbooks",
  procedure: "Procedures",
  file_library: "File Library",
  knowledge_element: "Knowledge Elements",
  course: "Courses",
};

/** What a scan could not read, in plain sentences — the parser and capability problems an admin should know before Sync Now. */
export function scanProblemsOf(report: SyncReport): string[] {
  const problems: string[] = [];
  for (const [type, r] of Object.entries(report.byType) as [ContentType, NonNullable<SyncReport["byType"][ContentType]>][]) {
    if (r.listing === "failed") problems.push(`${TYPE_LABEL[type]} could not be read from Woven this time; ${TYPE_LABEL[type]} will be left as they are.`);
    if (r.listing === "not_trusted") problems.push(`${TYPE_LABEL[type]}: Woven's list looked incomplete, so nothing will be removed from it.`);
    const missing = r.shape?.stepStructureMissing ?? 0;
    if (missing > 0) problems.push(`${missing} procedure page${missing === 1 ? "" : "s"} did not have the step layout Ask Sunny reads, so ${missing === 1 ? "its" : "their"} text is not synced.`);
    if (r.blocked > 0) problems.push(`${r.blocked} ${TYPE_LABEL[type]} item${r.blocked === 1 ? "" : "s"} can't be read by Ask Sunny yet.`);
  }
  return problems;
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
  const [settings, manifest, decisions, runs] = await Promise.all([
    store.loadSettings("woven"),
    store.loadManifest("woven"),
    store.loadDecisions("woven"),
    store.recentRuns("woven", 12),
  ]);
  const initialDone = Boolean(settings.initialSyncCompletedAt);
  const finished = runs.filter((r) => r.status !== "running" && r.status !== "failed");
  const lastScan = finished.find((r) => r.mode === "preview");
  const lastApply = finished.find((r) => r.mode !== "preview");
  const scanIsNewer = Boolean(lastScan && (!lastApply || Date.parse(lastScan.startedAt) > Date.parse(lastApply.startedAt)));
  const preview = !initialDone || scanIsNewer ? await loadPreviewSafely(store) : [];
  const inventory = effectiveInventory(manifest, preview, initialDone, scanIsNewer);
  const synced = [...new Set(inventory.filter((i) => i.inAskSunny && i.knowledgeDocumentId).map((i) => i.knowledgeDocumentId!))];
  const titles = synced.length > 0 && overrides.documentTitles ? await overrides.documentTitles(synced) : new Map<string, string>();
  const superseded =
    synced.length > 0 && overrides.supersededUploads
      ? await overrides.supersededUploads(synced).catch(() => new Map<string, { id: string; title: string }[]>())
      : new Map<string, { id: string; title: string }[]>();
  const seen = inventory.map((i) => i.lastSeenAt).filter(Boolean);
  return {
    basis: inventory.length === 0 ? "none" : preview.length === 0 ? "manifest" : "latest_scan",
    scannedAt: seen.length > 0 ? seen.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a)) : null,
    rows: contentRows(inventory, decisions, titles, superseded),
  };
}
