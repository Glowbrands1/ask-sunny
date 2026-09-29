import { manifestKey } from "./reconcile";
import type { ClaimResult, KnowledgeSink, KnowledgeSyncStore, RunRecord, SinkDocument, SinkMetadata } from "./ports";
import type { AudienceDecision, InventoryItem, ManifestItem, SourceSystem, SyncEvent, SyncSettings } from "./types";

/**
 * In-memory implementations of the store and the sink. They enforce the same
 * guarantees the database does — one live run, one manifest row per
 * (source, type, entity, part), one owner per Ask Sunny document — so the engine
 * tests prove idempotency rather than assume it.
 */

/** A manifest item reduced to the display fields a dry run's inventory keeps. */
export function toInventoryItem(item: ManifestItem, observedAt: string): InventoryItem {
  return {
    contentType: item.contentType,
    entityId: item.entityId,
    partKey: item.partKey,
    recordTitle: item.recordTitle ?? null,
    title: item.title,
    status: item.status,
    audience: item.audience,
    version: item.version,
    sourceUpdatedAt: item.sourceUpdatedAt,
    fileName: item.fileName,
    state: item.state,
    reason: item.reason,
    pendingAction: item.pendingAction,
    /* A dry run changes nothing in Ask Sunny: these describe the manifest as it was. */
    knowledgeDocumentId: item.knowledgeDocumentId,
    inAskSunny: item.inAskSunny,
    errorCategory: null,
    retryCount: 0,
    firstSeenAt: item.firstSeenAt ?? observedAt,
    lastSeenAt: observedAt,
    lastSyncedAt: item.lastSyncedAt,
  };
}

export function defaultSettings(source: SourceSystem): SyncSettings {
  return {
    source,
    autoSyncEnabled: false,
    intervalDays: 30,
    initialSyncCompletedAt: null,
    lastFullScanAt: null,
    lastSuccessAt: null,
  };
}

export class MemoryKnowledgeSyncStore implements KnowledgeSyncStore {
  readonly items = new Map<string, ManifestItem>();
  readonly runs: RunRecord[] = [];
  readonly events: SyncEvent[] = [];
  readonly decisions = new Map<string, AudienceDecision>();
  /** The latest dry run's inventory. */
  preview: InventoryItem[] = [];
  settings: SyncSettings;
  private sequence = 0;
  private readonly clock: () => Date;

  constructor(options: { source?: SourceSystem; now?: () => Date } = {}) {
    this.settings = defaultSettings(options.source ?? "woven");
    this.clock = options.now ?? (() => new Date());
  }

  async claimRun(input: Parameters<KnowledgeSyncStore["claimRun"]>[0]): Promise<ClaimResult> {
    const live = this.runs.find((run) => run.source === input.source && run.status === "running");
    if (live) return { status: "busy", runningSince: live.startedAt };
    this.sequence += 1;
    const id = `run-${this.sequence}`;
    this.runs.push({
      id,
      source: input.source,
      mode: input.mode,
      trigger: input.trigger,
      status: "running",
      requestedBy: input.requestedBy,
      startedAt: this.clock().toISOString(),
      finishedAt: null,
      errorCode: null,
      errorDetail: null,
      report: null,
    });
    return { status: "claimed", runId: id };
  }

  async finishRun(input: Parameters<KnowledgeSyncStore["finishRun"]>[0]): Promise<void> {
    const run = this.runs.find((r) => r.id === input.runId);
    if (!run || run.status !== "running") throw new Error("run is not running");
    Object.assign(run, {
      status: input.status,
      report: structuredClone(input.report),
      errorCode: input.errorCode,
      errorDetail: input.errorDetail,
      finishedAt: this.clock().toISOString(),
    });
  }

  async loadManifest(source: SourceSystem): Promise<ManifestItem[]> {
    return [...this.items.values()].filter((i) => i.source === source).map((i) => structuredClone(i));
  }

  async saveItems(items: ManifestItem[]): Promise<void> {
    for (const item of items) {
      const key = `${item.source}\u0000${manifestKey(item)}`;
      if (item.knowledgeDocumentId) {
        for (const [otherKey, other] of this.items) {
          if (otherKey !== key && other.knowledgeDocumentId === item.knowledgeDocumentId) {
            throw new Error("unique violation: knowledge document already owned by another item");
          }
        }
      }
      this.items.set(key, structuredClone(item));
    }
  }

  async recordEvents(events: SyncEvent[]): Promise<void> {
    this.events.push(...events.map((e) => structuredClone(e)));
  }

  async loadDecisions(source: SourceSystem): Promise<AudienceDecision[]> {
    return [...this.decisions.values()].filter((d) => d.source === source);
  }

  async saveDecision(decision: AudienceDecision): Promise<void> {
    this.decisions.set(decision.audienceKey, { ...decision });
  }

  async removeDecision(_source: SourceSystem, audienceKey: string): Promise<void> {
    this.decisions.delete(audienceKey);
  }

  async loadSettings(): Promise<SyncSettings> {
    return { ...this.settings };
  }

  async saveSettings(settings: SyncSettings): Promise<void> {
    this.settings = { ...settings };
  }

  async lastRun(source: SourceSystem, filter: Parameters<KnowledgeSyncStore["lastRun"]>[1]): Promise<RunRecord | null> {
    const matches = this.runs.filter(
      (r) =>
        r.source === source &&
        (!filter.mode || r.mode === filter.mode) &&
        (!filter.statuses || filter.statuses.includes(r.status)),
    );
    return matches.at(-1) ?? null;
  }

  async recentRuns(source: SourceSystem, limit: number): Promise<RunRecord[]> {
    return this.runs.filter((r) => r.source === source).slice(-limit).reverse();
  }

  async savePreviewInventory(_source: SourceSystem, _runId: string, items: ManifestItem[]): Promise<void> {
    const at = this.clock().toISOString();
    this.preview = items.map((item) => toInventoryItem(item, at));
  }

  async loadPreviewInventory(): Promise<InventoryItem[]> {
    return this.preview.map((i) => structuredClone(i));
  }
}

export interface MemoryDocument extends SinkMetadata {
  id: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  version: number;
  retired: boolean;
  source: "woven" | "upload";
}

export class MemoryKnowledgeSink implements KnowledgeSink {
  readonly documents = new Map<string, MemoryDocument>();
  ingestCalls = 0;
  metadataCalls = 0;
  retireCalls = 0;
  /** Set to make the next `ingest` calls throw. */
  failNextIngest: Error | null = null;

  async ingest(document: SinkDocument): Promise<{ reusedExistingEmbeddings: boolean }> {
    this.ingestCalls += 1;
    if (this.failNextIngest) {
      const error = this.failNextIngest;
      this.failNextIngest = null;
      throw error;
    }
    const existing = this.documents.get(document.documentId);
    this.documents.set(document.documentId, {
      id: document.documentId,
      title: document.title,
      description: document.description,
      category: document.category,
      tags: document.tags,
      fileName: document.fileName,
      mimeType: document.mimeType,
      bytes: document.bytes,
      version: existing ? existing.version + 1 : 1,
      retired: false,
      source: "woven",
    });
    return { reusedExistingEmbeddings: false };
  }

  async updateMetadata(documentId: string, metadata: SinkMetadata): Promise<void> {
    this.metadataCalls += 1;
    const doc = this.documents.get(documentId);
    if (!doc) throw new Error("no such document");
    Object.assign(doc, metadata);
  }

  async retire(documentId: string): Promise<void> {
    this.retireCalls += 1;
    const doc = this.documents.get(documentId);
    if (doc) doc.retired = true;
  }

  async countManualTitleMatches(titles: string[]): Promise<number> {
    const manual = new Set(
      [...this.documents.values()].filter((d) => d.source === "upload").map((d) => d.title.trim().toLowerCase()),
    );
    return titles.filter((t) => manual.has(t.trim().toLowerCase())).length;
  }

  /** Documents a signed-in user could currently find. */
  searchable(): MemoryDocument[] {
    return [...this.documents.values()].filter((d) => !d.retired);
  }
}
