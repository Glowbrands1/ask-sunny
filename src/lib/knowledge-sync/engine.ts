import { createHash } from "node:crypto";

import { manifestKey, reconcile } from "./reconcile";
import { SinkError, type DescribeItem, type KnowledgeSink, type KnowledgeSyncStore } from "./ports";
import {
  PartFetchError,
  type AttentionItem,
  type ConnectionInfo,
  type ContentType,
  type KnowledgeSourceConnector,
  type ListingResult,
  type ManifestItem,
  type RunMode,
  type RunStatus,
  type RunTrigger,
  type SyncEvent,
  type SyncReport,
} from "./types";

/**
 * ============================================================================
 * THE KNOWLEDGE SYNC ENGINE — one implementation for every way a sync starts
 * ============================================================================
 *
 * The scheduled tick, "Sync Now" and "Run Initial Scan" all call
 * `runKnowledgeSync`. They differ only in `mode`:
 *
 *   preview   sign in, read every listing, classify — and write NOTHING but the
 *             run's own report. The initial scan and any dry run.
 *   sync      the same read, then save the scan to the manifest and apply it
 *             to Ask Sunny: ingest what is new or changed, retire what left.
 *   continue  no listing: finish work an earlier sync planned but did not reach
 *             (time budget) and retry items that failed. How a monthly sync
 *             that outgrows one serverless invocation completes, unattended.
 *
 * PER-ITEM ISOLATION. One file failing to download is recorded against that
 * item, retried later, and does not stop the rest. One content type failing to
 * list is reported and leaves that type's items exactly as they were.
 *
 * IDEMPOTENT. A new item's Ask Sunny document id is DERIVED from its manifest
 * identity (`knowledgeDocumentIdFor`), so every attempt — a retry, or a run
 * after a crash between "ingested" and "recorded" — addresses the same
 * document and can never produce a second copy. The id is written to the
 * manifest only once ingestion has created the document, because the
 * manifest's `knowledge_document_id` is a foreign key to it.
 *
 * NOTHING SECRET PASSES THROUGH HERE. Connectors resolve temporary download
 * URLs internally and hand back bytes; the engine never sees a URL, a cookie
 * or a token, so none can reach the manifest, the audit log or a report.
 */

export const MAX_AUTOMATIC_RETRIES = 5;
export const RETRY_DELAY_MS = 20 * 60 * 60 * 1000;
/** A preview is trusted as the initial scan for this long. */
export const PREVIEW_VALID_FOR_MS = 7 * 24 * 60 * 60 * 1000;

export interface EngineDeps {
  connector: KnowledgeSourceConnector;
  store: KnowledgeSyncStore;
  sink: KnowledgeSink;
  describe: DescribeItem;
  companyWideLabels: readonly string[];
  contentTypes: readonly ContentType[];
  now?: () => Date;
  /** Epoch ms after which no new item is started. Planned work carries over to a `continue` run. */
  deadlineAt?: number | null;
}

export interface RunOptions {
  mode: RunMode;
  trigger: RunTrigger;
  requestedBy: string;
  confirmLargeRemoval?: boolean;
}

export type RunOutcome =
  | { status: "busy"; runningSince: string | null }
  | { status: "refused"; code: string; reason: string }
  | {
      status: Exclude<RunStatus, "running">;
      runId: string;
      report: SyncReport;
      errorCode: string | null;
      reason: string | null;
    };

/** A failure that ends the run before anything is changed. */
export class RunAborted extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RunAborted";
    this.code = code;
  }
}

/** Connectors throw this when the SESSION (not one item) is lost, so the engine stops starting work. */
export function isSessionFailure(error: unknown): boolean {
  return error instanceof Error && (error as { sessionLost?: boolean }).sessionLost === true;
}

function emptyTotals(): SyncReport["totals"] {
  return {
    discovered: 0,
    inSync: 0,
    new: 0,
    updated: 0,
    metadataOnly: 0,
    unchanged: 0,
    permissionChanged: 0,
    unpublished: 0,
    removed: 0,
    excluded: 0,
    needsReview: 0,
    blocked: 0,
    errors: 0,
    deferred: 0,
    removalsHeld: 0,
  };
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The Ask Sunny document id a source item part owns, derived from its identity:
 * the same part always maps to the same document.
 *
 * LIVE BUG THIS REPLACES. The id used to be random and saved to the manifest
 * BEFORE ingestion. `knowledge_sync_items.knowledge_document_id` references
 * `knowledge_documents`, which did not have the row yet, so the very first
 * save of the initial sync failed the foreign key and stopped the run.
 */
export function knowledgeDocumentIdFor(item: Pick<ManifestItem, "source" | "contentType" | "entityId" | "partKey">): string {
  const h = createHash("sha256").update(`ask-sunny-knowledge-sync\u0000${item.source}\u0000${manifestKey(item)}`).digest("hex");
  /* RFC 4122 layout: version 5 (name-based), variant 10xx. */
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

/** The HTTP status a route answers with. A failed sync must show as a failed invocation. */
export function outcomeHttpStatus(outcome: RunOutcome): number {
  switch (outcome.status) {
    case "succeeded":
    case "succeeded_with_warnings":
    case "busy":
      return 200;
    case "refused":
      return 409;
    case "failed":
      return outcome.errorCode?.startsWith("woven_") ? 502 : 500;
  }
}

export async function runKnowledgeSync(deps: EngineDeps, options: RunOptions): Promise<RunOutcome> {
  const now = deps.now ?? (() => new Date());
  const started = now().getTime();
  const source = deps.connector.source;
  const { store } = deps;

  const settings = await store.loadSettings(source);

  /* The initial bulk ingestion only ever follows a preview a person has seen. */
  if (options.mode !== "preview" && !settings.initialSyncCompletedAt) {
    if (options.trigger === "schedule") {
      return {
        status: "refused",
        code: "initial_sync_not_done",
        reason: "The automatic sync starts only after the initial sync has been run from the admin screen.",
      };
    }
    if (options.mode === "sync") {
      const preview = await store.lastRun(source, { mode: "preview", statuses: ["succeeded", "succeeded_with_warnings"] });
      const fresh = preview && now().getTime() - Date.parse(preview.startedAt) <= PREVIEW_VALID_FOR_MS;
      if (!fresh) {
        return {
          status: "refused",
          code: "preview_required",
          reason: "Run the initial scan first, so the counts can be checked before anything is added to Ask Sunny.",
        };
      }
    }
  }

  if (options.mode === "continue") {
    const waiting = (await store.loadManifest(source)).filter((item) => isDueForContinue(item, now()));
    if (waiting.length === 0) {
      return { status: "refused", code: "nothing_to_continue", reason: "There is no unfinished or retryable work." };
    }
  }

  const claim = await store.claimRun({ source, mode: options.mode, trigger: options.trigger, requestedBy: options.requestedBy });
  if (claim.status === "busy") return { status: "busy", runningSince: claim.runningSince };
  const runId = claim.runId;

  const report: SyncReport = {
    mode: options.mode,
    trigger: options.trigger,
    company: null,
    byType: {},
    totals: emptyTotals(),
    audiences: [],
    possibleManualDuplicates: 0,
    attention: [],
    requestsMade: 0,
    durationMs: 0,
  };
  const events: SyncEvent[] = [];

  const finish = async (status: Exclude<RunStatus, "running">, errorCode: string | null, reason: string | null) => {
    report.requestsMade = deps.connector.requestsMade;
    report.durationMs = now().getTime() - started;
    try {
      if (events.length > 0) await store.recordEvents(events);
    } catch {
      report.attention.push({ code: "audit_not_saved", message: "The detailed log for this sync could not be saved." });
    }
    await store.finishRun({ runId, status, report, errorCode, errorDetail: reason });
    return { status, runId, report, errorCode, reason } as const;
  };

  let connection: ConnectionInfo;
  try {
    connection = await deps.connector.connect();
    report.company = connection;
  } catch (error) {
    const code = (error as { code?: string }).code ?? "connection_failed";
    const reason = error instanceof Error ? error.message : "Ask Sunny could not sign in to Woven.";
    report.attention.push({ code, message: `Woven sync needs attention: ${reason}` });
    return finish("failed", code, reason);
  }

  try {
    const manifest = await store.loadManifest(source);
    const decisions = new Map((await store.loadDecisions(source)).map((d) => [d.audienceKey, d]));
    const merged = new Map(manifest.map((item) => [manifestKey(item), item]));

    /* ---- scan ---- */
    let listingFailures = 0;
    if (options.mode !== "continue") {
      const listings: ListingResult[] = [];
      for (const contentType of deps.contentTypes) {
        listings.push(await deps.connector.list(contentType));
      }
      listingFailures = listings.filter((l) => !l.ok).length;
      if (listingFailures === listings.length) {
        const first = listings.find((l) => !l.ok) as Extract<ListingResult, { ok: false }> | undefined;
        throw new RunAborted(first?.code ?? "listing_failed", first?.message ?? "No Woven content could be read.");
      }

      const scan = reconcile({
        source,
        listings,
        manifest,
        decisions,
        companyWideLabels: deps.companyWideLabels,
        now: now().toISOString(),
        confirmLargeRemoval: options.confirmLargeRemoval,
      });
      report.byType = scan.byType;
      report.audiences = scan.audiences;
      report.attention.push(...scan.attention);
      report.totals.removalsHeld = scan.removalsHeld;
      for (const listing of listings) {
        if (!listing.ok) {
          report.attention.push({
            code: `listing_failed_${listing.contentType}`,
            message: `Woven's ${listing.contentType.replace("_", " ")} list could not be read this time, so those items were left as they were.`,
          });
        }
      }
      for (const item of scan.items) merged.set(manifestKey(item), item);

      const titles = scan.items.filter((i) => i.pendingAction === "ingest" && !i.inAskSunny).map((i) => deps.describe(i).title);
      try {
        report.possibleManualDuplicates = titles.length > 0 ? await deps.sink.countManualTitleMatches(titles) : 0;
      } catch {
        report.possibleManualDuplicates = 0;
      }

      if (options.mode === "preview") {
        tally(report, [...merged.values()], new Set(scan.items.map(manifestKey)));
        /*
         * The inventory: what was found, as display metadata only, so the
         * screen can list it and take the audience choices before the initial
         * sync saves a manifest. Losing it loses the list, not the counts.
         */
        try {
          await store.savePreviewInventory(source, runId, scan.items);
        } catch {
          report.attention.push({
            code: "inventory_not_saved",
            message: "The list of what the scan found could not be saved. The counts are still correct; scan again to see the list.",
          });
        }
        const status = listingFailures > 0 ? "succeeded_with_warnings" : "succeeded";
        return finish(status, null, null);
      }

      /* The scan is saved before any work starts, so a crash mid-apply resumes from it. */
      await store.saveItems(scan.items);
    }

    /* ---- apply ---- */
    const nowIso = () => now().toISOString();
    const due = [...merged.values()].filter((item) =>
      options.mode === "continue" ? isDueForContinue(item, now()) : item.pendingAction !== "none",
    );
    due.sort((a, b) => (a.pendingAction === b.pendingAction ? 0 : a.pendingAction === "retire" ? -1 : 1));

    let sessionLost: string | null = null;
    for (const item of due) {
      if (sessionLost || (deps.deadlineAt != null && now().getTime() >= deps.deadlineAt)) {
        report.totals.deferred += 1;
        continue;
      }
      const t0 = now().getTime();
      /*
       * The document's identity is derived, not stored first: every attempt at
       * this part addresses the same document, and the manifest only records
       * the id once that document exists (it is a foreign key).
       */
      const working =
        item.pendingAction === "ingest" && !item.knowledgeDocumentId ? { ...item, knowledgeDocumentId: knowledgeDocumentIdFor(item) } : item;
      const next = await applyItem(deps, working, nowIso).catch((error: unknown) => {
        if (isSessionFailure(error)) sessionLost = error instanceof Error ? error.message : "session lost";
        return failedItem(item, error, now());
      });
      merged.set(manifestKey(next.item), next.item);
      await store.saveItems([next.item]);
      if (next.metadataOnly) report.totals.metadataOnly += 1;
      events.push({
        runId,
        contentType: item.contentType,
        entityId: item.entityId,
        partKey: item.partKey,
        action: next.action,
        result: next.item.state === "ERROR" ? "error" : "ok",
        contentHash: next.item.contentHash,
        durationMs: now().getTime() - t0,
        errorCategory: next.item.state === "ERROR" ? next.item.errorCategory : null,
      });
    }
    if (sessionLost) {
      report.attention.push({
        code: "session_lost",
        message: "The Woven session ended part-way through. The remaining updates will be finished automatically on the next run.",
      });
    }

    /* ---- settings ---- */
    const finishedAt = nowIso();
    const next = { ...settings };
    if (options.mode === "sync") {
      if (listingFailures === 0) next.lastFullScanAt = finishedAt;
      if (!next.initialSyncCompletedAt) next.initialSyncCompletedAt = finishedAt;
    }
    next.lastSuccessAt = finishedAt;
    await store.saveSettings(next);

    tally(report, [...merged.values()], null);
    const warnings =
      listingFailures > 0 ||
      report.totals.errors > 0 ||
      report.totals.deferred > 0 ||
      report.totals.removalsHeld > 0 ||
      report.attention.some((a) => a.code.startsWith("listing_not_trusted"));
    return finish(warnings ? "succeeded_with_warnings" : "succeeded", null, null);
  } catch (error) {
    const code = error instanceof RunAborted ? error.code : ((error as { code?: string }).code ?? "internal_error");
    const reason =
      error instanceof RunAborted
        ? error.message
        : "The sync stopped on an unexpected error. Ask Sunny's documents were left as they were.";
    report.attention.push({ code, message: `Woven sync needs attention: ${reason}` });
    return finish("failed", code, reason);
  }
}

/**
 * Work a `continue` run picks up: planned but not reached, or failed and due a
 * retry. Items that have failed `MAX_AUTOMATIC_RETRIES` times wait for the next
 * full sync (or "Sync Now") instead of being retried every day forever.
 */
export function isDueForContinue(item: ManifestItem, now: Date): boolean {
  if (item.pendingAction === "none") return false;
  if (item.retryCount >= MAX_AUTOMATIC_RETRIES) return false;
  return item.nextRetryAt === null || Date.parse(item.nextRetryAt) <= now.getTime();
}

/* ------------------------------------------------------------ per item -- */

interface Applied {
  item: ManifestItem;
  action: SyncEvent["action"];
  metadataOnly: boolean;
}

async function applyItem(deps: EngineDeps, item: ManifestItem, nowIso: () => string): Promise<Applied> {
  if (item.pendingAction === "retire") {
    if (item.knowledgeDocumentId && item.inAskSunny) await deps.sink.retire(item.knowledgeDocumentId);
    return {
      item: {
        ...item,
        state: item.state === "ERROR" ? (item.previousState ?? "REMOVED") : item.state,
        inAskSunny: false,
        pendingAction: "none",
        lastError: null,
        errorCategory: null,
        retryCount: 0,
        nextRetryAt: null,
      },
      action: "retire",
      metadataOnly: false,
    };
  }

  if (!item.locator) {
    throw new PartFetchError("no_locator", "This item has nothing Ask Sunny can download.", false);
  }

  const current = item;
  if (!current.knowledgeDocumentId) throw new Error("An item is applied only once its document id is saved.");

  const fetched = await deps.connector.fetchPart({
    contentType: current.contentType,
    entityId: current.entityId,
    partKey: current.partKey,
    locator: current.locator!,
    fileName: current.fileName,
    mimeType: current.mimeType,
    title: current.title,
  });
  const hash = sha256Hex(fetched.bytes);
  const metadata = deps.describe(current);

  let action: SyncEvent["action"];
  let metadataOnly = false;
  if (current.inAskSunny && current.contentHash === hash) {
    await deps.sink.updateMetadata(current.knowledgeDocumentId!, metadata);
    action = "metadata_only";
    metadataOnly = true;
  } else {
    await deps.sink.ingest({
      documentId: current.knowledgeDocumentId!,
      bytes: fetched.bytes,
      fileName: fetched.fileName,
      mimeType: fetched.mimeType,
      ...metadata,
    });
    action = current.syncedFingerprint === null ? "ingest" : "update";
  }

  return {
    item: {
      ...current,
      /* A retry that succeeds reports what the item was before it failed. */
      state: current.state === "ERROR" ? (current.previousState ?? "NEW") : current.state,
      syncedFingerprint: current.observedFingerprint,
      contentHash: hash,
      inAskSunny: true,
      pendingAction: "none",
      lastError: null,
      errorCategory: null,
      retryCount: 0,
      nextRetryAt: null,
      lastSyncedAt: nowIso(),
    },
    action,
    metadataOnly,
  };
}

function failedItem(item: ManifestItem, error: unknown, now: Date): Applied {
  let category = "unexpected";
  let message = "This item could not be synced.";
  let retryable = true;
  if (error instanceof PartFetchError || error instanceof SinkError) {
    category = error.category;
    message = error.message;
    retryable = error.retryable;
  } else if (isSessionFailure(error)) {
    category = "session_lost";
    message = "The Woven session ended before this item was reached.";
  }
  const retryCount = item.retryCount + 1;
  return {
    item: {
      ...item,
      /* Keep the classification from before the FIRST failure, however many follow. */
      previousState: item.state === "ERROR" ? item.previousState : item.state,
      state: "ERROR",
      lastError: message.slice(0, 300),
      errorCategory: category,
      retryCount: retryable ? retryCount : MAX_AUTOMATIC_RETRIES,
      nextRetryAt: retryable ? new Date(now.getTime() + RETRY_DELAY_MS).toISOString() : null,
    },
    action: item.pendingAction === "retire" ? "retire" : item.syncedFingerprint === null ? "ingest" : "update",
    metadataOnly: false,
  };
}

/* -------------------------------------------------------------- totals -- */

/**
 * Totals across the whole manifest after the run. `scanned`, when given,
 * limits the classification counts to items this run looked at (a preview).
 */
function tally(report: SyncReport, items: ManifestItem[], scanned: Set<string> | null): void {
  const t = report.totals;
  const entities = new Set<string>();
  for (const item of items) {
    if (item.inAskSunny) t.inSync += 1;
    if (scanned && !scanned.has(manifestKey(item))) continue;
    if (item.state !== "REMOVED") entities.add(`${item.contentType}:${item.entityId}`);
    switch (item.state) {
      case "NEW":
        t.new += 1;
        break;
      case "UPDATED":
        t.updated += 1;
        break;
      case "UNCHANGED":
        t.unchanged += 1;
        break;
      case "PERMISSION_CHANGED":
        t.permissionChanged += 1;
        break;
      case "UNPUBLISHED":
        t.unpublished += 1;
        break;
      case "REMOVED":
        /* Removed FROM ASK SUNNY: only what had actually been synced counts. */
        if (item.reason === "not_in_source" && item.previousState !== "REMOVED" && item.syncedFingerprint !== null) t.removed += 1;
        break;
      case "EXCLUDED":
        t.excluded += 1;
        break;
      case "NEEDS_REVIEW":
        t.needsReview += 1;
        break;
      case "BLOCKED":
        t.blocked += 1;
        break;
      case "ERROR":
        t.errors += 1;
        break;
    }
  }
  t.discovered = entities.size;

  if (t.errors > 0) {
    const exhausted = items.filter((i) => i.state === "ERROR" && i.retryCount >= MAX_AUTOMATIC_RETRIES).length;
    const attention: AttentionItem =
      exhausted > 0
        ? {
            code: "items_failing",
            message: `${exhausted} document${exhausted === 1 ? " has" : "s have"} failed repeatedly and will not be retried automatically. Open the sync details to see which.`,
            count: exhausted,
          }
        : {
            code: "items_retrying",
            message: `${t.errors} document${t.errors === 1 ? "" : "s"} could not be updated this time. Ask Sunny will retry automatically.`,
            count: t.errors,
          };
    report.attention.push(attention);
  }
  if (t.deferred > 0) {
    report.attention.push({
      code: "work_continues",
      message: `${t.deferred} update${t.deferred === 1 ? "" : "s"} will be finished automatically on the next run.`,
      count: t.deferred,
    });
  }
}
