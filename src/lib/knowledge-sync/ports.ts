import type {
  AudienceDecision,
  ContentType,
  InventoryItem,
  ManifestItem,
  RunMode,
  RunStatus,
  RunTrigger,
  SourceSystem,
  SyncEvent,
  SyncReport,
  SyncSettings,
} from "./types";

/**
 * The two doors the engine uses, as interfaces, so the whole sync runs in tests
 * against in-memory implementations and in production against Supabase and the
 * existing ingestion pipeline — with the same engine code either way.
 */

export interface RunRecord {
  id: string;
  source: SourceSystem;
  mode: RunMode;
  trigger: RunTrigger;
  status: RunStatus;
  requestedBy: string;
  startedAt: string;
  finishedAt: string | null;
  errorCode: string | null;
  errorDetail: string | null;
  report: SyncReport | null;
}

export type ClaimResult = { status: "claimed"; runId: string } | { status: "busy"; runningSince: string | null };

/** Persistence for the manifest, the run ledger, the audit log and settings. */
export interface KnowledgeSyncStore {
  claimRun(input: { source: SourceSystem; mode: RunMode; trigger: RunTrigger; requestedBy: string }): Promise<ClaimResult>;
  finishRun(input: {
    runId: string;
    status: Exclude<RunStatus, "running">;
    report: SyncReport | null;
    errorCode: string | null;
    errorDetail: string | null;
  }): Promise<void>;
  loadManifest(source: SourceSystem): Promise<ManifestItem[]>;
  /** Upsert on (source, contentType, entityId, partKey). Idempotent. */
  saveItems(items: ManifestItem[]): Promise<void>;
  recordEvents(events: SyncEvent[]): Promise<void>;
  loadDecisions(source: SourceSystem): Promise<AudienceDecision[]>;
  saveDecision(decision: AudienceDecision): Promise<void>;
  removeDecision(source: SourceSystem, audienceKey: string): Promise<void>;
  loadSettings(source: SourceSystem): Promise<SyncSettings>;
  saveSettings(settings: SyncSettings): Promise<void>;
  lastRun(source: SourceSystem, filter: { mode?: RunMode; statuses?: RunStatus[] }): Promise<RunRecord | null>;
  recentRuns(source: SourceSystem, limit: number): Promise<RunRecord[]>;
  /**
   * The latest dry run's inventory: what it found, as display metadata only.
   * Replaces the previous one. It is what the screen shows — and what the
   * audience choices are made from — before the initial sync has saved a
   * manifest.
   */
  savePreviewInventory(source: SourceSystem, runId: string, items: ManifestItem[]): Promise<void>;
  loadPreviewInventory(source: SourceSystem): Promise<InventoryItem[]>;
}

export interface SinkDocument {
  /** Chosen by the engine and saved to the manifest BEFORE ingestion, so a retry reuses it. */
  documentId: string;
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
}

export interface SinkMetadata {
  title: string;
  description: string;
  category: string;
  tags: string[];
}

/** Ask Sunny's knowledge base, as the engine sees it. */
export interface KnowledgeSink {
  /** Creates the document, or replaces its content in place. Idempotent on `documentId`. */
  ingest(document: SinkDocument): Promise<{ reusedExistingEmbeddings: boolean }>;
  /** Changes title/description/tags only; nothing is re-extracted or re-embedded. */
  updateMetadata(documentId: string, metadata: SinkMetadata): Promise<void>;
  /** Removes the document from search without destroying it. */
  retire(documentId: string): Promise<void>;
  /** How many of these titles already exist as documents uploaded by hand. */
  countManualTitleMatches(titles: string[]): Promise<number>;
}

/** Why a sink call failed — a code the audit log can carry and a user-safe sentence. */
export class SinkError extends Error {
  readonly category: string;
  readonly retryable: boolean;
  constructor(category: string, message: string, retryable = true) {
    super(message);
    this.name = "SinkError";
    this.category = category;
    this.retryable = retryable;
  }
}

/** How a source describes one item to Ask Sunny's library. */
export type DescribeItem = (item: ManifestItem) => SinkMetadata;

export type ContentTypeList = readonly ContentType[];
