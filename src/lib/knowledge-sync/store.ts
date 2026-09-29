import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { defaultSettings } from "./memory-store";
import type { ClaimResult, KnowledgeSyncStore, RunRecord } from "./ports";
import type {
  AudienceDecision,
  ContentType,
  ManifestItem,
  PendingAction,
  RunMode,
  RunStatus,
  RunTrigger,
  SourceSystem,
  SyncEvent,
  SyncReport,
  SyncSettings,
  SyncState,
} from "./types";

/**
 * The knowledge sync's only door into Supabase. Server-only, secret key.
 *
 * Writes are per item and idempotent (upsert on the manifest's identity
 * constraint), which is what lets one failed file leave every other item's
 * progress saved. The run lock is the partial unique index
 * `knowledge_sync_runs_one_live`: a second claim fails with a unique violation
 * and is reported as busy.
 */

/** A run left `running` longer than this is closed as stale by the next claim. */
const STALE_RUN_MINUTES = 20;

export class KnowledgeSyncStoreError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "KnowledgeSyncStoreError";
    this.code = code;
  }
}

/** Postgres `undefined_table`, and PostgREST's "not in the schema cache". */
const MISSING_RELATION = new Set(["42P01", "PGRST205", "PGRST200"]);

function fail(error: { code?: string | null; message?: string } | null, what: string): never {
  const code = error?.code ?? null;
  if (code !== null && MISSING_RELATION.has(code)) {
    throw new KnowledgeSyncStoreError("sync_tables_missing", "The knowledge sync tables do not exist in this database yet.");
  }
  throw new KnowledgeSyncStoreError("store_unavailable", `The knowledge sync could not ${what}${code ? ` (${code})` : ""}.`);
}

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function itemToRow(item: ManifestItem): Row {
  return {
    source: item.source,
    content_type: item.contentType,
    entity_id: item.entityId,
    part_key: item.partKey,
    title: item.title.slice(0, 500),
    status: item.status?.slice(0, 120) ?? null,
    audience: item.audience,
    version: item.version?.slice(0, 120) ?? null,
    version_id: item.versionId,
    source_updated_at: item.sourceUpdatedAt,
    document_id: item.documentId,
    attachment_ids: item.attachmentIds,
    locator: item.locator,
    mime_type: item.mimeType,
    file_name: item.fileName?.slice(0, 300) ?? null,
    observed_fingerprint: item.observedFingerprint,
    synced_fingerprint: item.syncedFingerprint,
    content_hash: item.contentHash,
    knowledge_document_id: item.knowledgeDocumentId,
    in_ask_sunny: item.inAskSunny,
    state: item.state,
    previous_state: item.previousState,
    pending_action: item.pendingAction,
    reason: item.reason,
    last_error: item.lastError,
    error_category: item.errorCategory,
    retry_count: item.retryCount,
    next_retry_at: item.nextRetryAt,
    first_seen_at: item.firstSeenAt,
    last_seen_at: item.lastSeenAt,
    last_synced_at: item.lastSyncedAt,
  };
}

export function rowToItem(row: Row): ManifestItem {
  const documentId = str(row.knowledge_document_id);
  return {
    source: row.source as SourceSystem,
    contentType: row.content_type as ContentType,
    entityId: String(row.entity_id),
    partKey: String(row.part_key),
    title: String(row.title ?? ""),
    status: str(row.status),
    audience: Array.isArray(row.audience) ? (row.audience as string[]) : null,
    version: str(row.version),
    versionId: str(row.version_id),
    sourceUpdatedAt: str(row.source_updated_at),
    documentId: str(row.document_id),
    attachmentIds: Array.isArray(row.attachment_ids) ? (row.attachment_ids as string[]) : [],
    locator: row.locator && typeof row.locator === "object" ? (row.locator as Record<string, string>) : null,
    mimeType: str(row.mime_type),
    fileName: str(row.file_name),
    observedFingerprint: String(row.observed_fingerprint),
    syncedFingerprint: str(row.synced_fingerprint),
    contentHash: str(row.content_hash),
    knowledgeDocumentId: documentId,
    /* A document deleted by hand detaches (`on delete set null`): it is then not in Ask Sunny. */
    inAskSunny: row.in_ask_sunny === true && documentId !== null,
    state: row.state as SyncState,
    previousState: (str(row.previous_state) as SyncState | null) ?? null,
    pendingAction: row.pending_action as PendingAction,
    reason: str(row.reason),
    lastError: str(row.last_error),
    errorCategory: str(row.error_category),
    retryCount: Number(row.retry_count ?? 0),
    nextRetryAt: str(row.next_retry_at),
    firstSeenAt: String(row.first_seen_at),
    lastSeenAt: String(row.last_seen_at),
    lastSyncedAt: str(row.last_synced_at),
  };
}

function rowToRun(row: Row): RunRecord {
  return {
    id: String(row.id),
    source: row.source as SourceSystem,
    mode: row.mode as RunMode,
    trigger: row.trigger as RunTrigger,
    status: row.status as RunStatus,
    requestedBy: String(row.requested_by),
    startedAt: String(row.started_at),
    finishedAt: str(row.finished_at),
    errorCode: str(row.error_code),
    errorDetail: str(row.error_detail),
    report: (row.report as SyncReport | null) ?? null,
  };
}

const PAGE = 1000;

export function createSupabaseKnowledgeSyncStore(db: SupabaseClient = getSupabaseAdmin()): KnowledgeSyncStore {
  return {
    async claimRun(input): Promise<ClaimResult> {
      const stale = new Date(Date.now() - STALE_RUN_MINUTES * 60_000).toISOString();
      await db
        .from("knowledge_sync_runs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error_code: "stale_run",
          error_detail: "The run never reported an outcome and was closed by the next claim.",
        })
        .eq("source", input.source)
        .eq("status", "running")
        .lt("started_at", stale);

      const { data, error } = await db
        .from("knowledge_sync_runs")
        .insert({ source: input.source, mode: input.mode, trigger: input.trigger, requested_by: input.requestedBy.slice(0, 120) })
        .select("id")
        .single();
      if (error?.code === "23505") {
        const { data: live } = await db
          .from("knowledge_sync_runs")
          .select("started_at")
          .eq("source", input.source)
          .eq("status", "running")
          .limit(1);
        return { status: "busy", runningSince: str((live ?? [])[0]?.started_at) };
      }
      if (error || !data) fail(error, "start a run");
      return { status: "claimed", runId: String(data.id) };
    },

    async finishRun(input) {
      const { error } = await db
        .from("knowledge_sync_runs")
        .update({
          status: input.status,
          report: input.report,
          error_code: input.errorCode,
          error_detail: input.errorDetail?.slice(0, 500) ?? null,
          finished_at: new Date().toISOString(),
        })
        .eq("id", input.runId)
        .eq("status", "running");
      if (error) fail(error, "record the run's outcome");
    },

    async loadManifest(source) {
      const rows: Row[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await db
          .from("knowledge_sync_items")
          .select("*")
          .eq("source", source)
          .order("id")
          .range(from, from + PAGE - 1);
        if (error) fail(error, "read the manifest");
        rows.push(...((data ?? []) as Row[]));
        if ((data ?? []).length < PAGE) break;
      }
      return rows.map(rowToItem);
    },

    async saveItems(items) {
      for (let i = 0; i < items.length; i += 200) {
        const { error } = await db
          .from("knowledge_sync_items")
          .upsert(items.slice(i, i + 200).map(itemToRow), { onConflict: "source,content_type,entity_id,part_key" });
        if (error) fail(error, "save the manifest");
      }
    },

    async recordEvents(events: SyncEvent[]) {
      for (let i = 0; i < events.length; i += 500) {
        const { error } = await db.from("knowledge_sync_events").insert(
          events.slice(i, i + 500).map((e) => ({
            run_id: e.runId,
            content_type: e.contentType,
            entity_id: e.entityId,
            part_key: e.partKey,
            action: e.action,
            result: e.result,
            content_hash: e.contentHash,
            duration_ms: Math.max(0, Math.round(e.durationMs)),
            error_category: e.errorCategory,
          })),
        );
        if (error) fail(error, "save the audit log");
      }
    },

    async loadDecisions(source) {
      const { data, error } = await db.from("knowledge_sync_audience_decisions").select("*").eq("source", source);
      if (error) fail(error, "read the audience decisions");
      return ((data ?? []) as Row[]).map(
        (r): AudienceDecision => ({
          source: r.source as SourceSystem,
          audienceKey: String(r.audience_key),
          decision: r.decision as AudienceDecision["decision"],
          decidedBy: String(r.decided_by),
          decidedAt: String(r.decided_at),
        }),
      );
    },

    async saveDecision(decision) {
      const { error } = await db.from("knowledge_sync_audience_decisions").upsert({
        source: decision.source,
        audience_key: decision.audienceKey,
        decision: decision.decision,
        decided_by: decision.decidedBy.slice(0, 120),
        decided_at: decision.decidedAt,
      });
      if (error) fail(error, "save the audience decision");
    },

    async removeDecision(source, audienceKey) {
      const { error } = await db
        .from("knowledge_sync_audience_decisions")
        .delete()
        .eq("source", source)
        .eq("audience_key", audienceKey);
      if (error) fail(error, "remove the audience decision");
    },

    async loadSettings(source): Promise<SyncSettings> {
      const { data, error } = await db.from("knowledge_sync_settings").select("*").eq("source", source).maybeSingle();
      if (error) fail(error, "read its settings");
      if (!data) return defaultSettings(source);
      const r = data as Row;
      return {
        source,
        autoSyncEnabled: r.auto_sync_enabled === true,
        intervalDays: Number(r.interval_days ?? 30),
        initialSyncCompletedAt: str(r.initial_sync_completed_at),
        lastFullScanAt: str(r.last_full_scan_at),
        lastSuccessAt: str(r.last_success_at),
      };
    },

    async saveSettings(settings) {
      const { error } = await db.from("knowledge_sync_settings").upsert({
        source: settings.source,
        auto_sync_enabled: settings.autoSyncEnabled,
        interval_days: settings.intervalDays,
        initial_sync_completed_at: settings.initialSyncCompletedAt,
        last_full_scan_at: settings.lastFullScanAt,
        last_success_at: settings.lastSuccessAt,
      });
      if (error) fail(error, "save its settings");
    },

    async lastRun(source, filter) {
      let query = db.from("knowledge_sync_runs").select("*").eq("source", source);
      if (filter.mode) query = query.eq("mode", filter.mode);
      if (filter.statuses) query = query.in("status", filter.statuses);
      const { data, error } = await query.order("started_at", { ascending: false }).limit(1);
      if (error) fail(error, "read its runs");
      const row = ((data ?? []) as Row[])[0];
      return row ? rowToRun(row) : null;
    },

    async recentRuns(source, limit) {
      const { data, error } = await db
        .from("knowledge_sync_runs")
        .select("*")
        .eq("source", source)
        .order("started_at", { ascending: false })
        .limit(limit);
      if (error) fail(error, "read its runs");
      return ((data ?? []) as Row[]).map(rowToRun);
    },
  };
}
