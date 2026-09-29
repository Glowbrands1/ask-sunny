/**
 * ============================================================================
 * KNOWLEDGE SYNC — the source-independent vocabulary
 * ============================================================================
 *
 * A knowledge SOURCE (Woven today; SharePoint or another system later) hands
 * the engine normalised `SourceRecord`s. The engine compares them with the
 * MANIFEST — what the source looked like at the last successful sync — and
 * drives Ask Sunny's existing knowledge pipeline through a `KnowledgeSink`.
 *
 * Nothing in this file knows a Woven route, a Woven field name or a Supabase
 * column. Source specifics live under `./woven/`; persistence lives in
 * `./store.ts`; Ask Sunny ingestion lives in `./sink.ts`.
 *
 * IDENTITY IS THE SOURCE'S OWN ID, never a filename or a title. One source
 * record can carry several ingestible PARTS (a policy and each of its
 * attachments), so a manifest row is keyed on
 * `(source, contentType, entityId, partKey)` and each row maps to at most one
 * Ask Sunny knowledge document.
 */

export const SOURCE_SYSTEMS = ["woven"] as const;
export type SourceSystem = (typeof SOURCE_SYSTEMS)[number];

export const CONTENT_TYPES = [
  "policy",
  "handbook",
  "procedure",
  "file_library",
  "knowledge_element",
  "course",
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const CONTENT_TYPE_LABEL: Record<ContentType, string> = {
  policy: "Policies",
  handbook: "Handbooks",
  procedure: "Procedures",
  file_library: "File Library",
  knowledge_element: "Knowledge Elements",
  course: "Courses",
};

/**
 * What a run concluded about one manifest item.
 *
 * The first eight are the classification the sync was specified with. Two more
 * are needed to say honestly why something is NOT in Ask Sunny:
 *
 *   NEEDS_REVIEW  published, but who may see it could not be mapped onto Ask
 *                 Sunny's access model. Held out until an administrator decides.
 *   EXCLUDED      deliberately not synced: a draft that was never published, a
 *                 format Ask Sunny cannot index (video), or an audience an
 *                 administrator chose to keep out.
 */
export const SYNC_STATES = [
  "NEW",
  "UPDATED",
  "UNCHANGED",
  "PERMISSION_CHANGED",
  "UNPUBLISHED",
  "REMOVED",
  "BLOCKED",
  "ERROR",
  "NEEDS_REVIEW",
  "EXCLUDED",
] as const;
export type SyncState = (typeof SYNC_STATES)[number];

/** What still has to happen to Ask Sunny for an item. */
export type PendingAction = "none" | "ingest" | "retire";

export type Publication = "published" | "unpublished" | "unknown";

/**
 * How a part's bytes are obtained — or, precisely, why they cannot be yet.
 *
 * `locator` holds the NON-SECRET identifiers needed to fetch the part again
 * later (a handbook id and version id, a policy id and document id). A signed
 * or temporary URL is never a locator: it is re-obtained immediately before
 * each download and discarded.
 */
export type PartRetrieval =
  | { kind: "available"; locator: Record<string, string> }
  | { kind: "unsupported_format"; detail: string }
  | { kind: "blocked"; capability: string };

export interface SourcePart {
  /** Stable within the record: `attachment:<id>`, `current-version`, `file`, `content`. */
  partKey: string;
  title: string;
  fileName: string | null;
  documentId: string | null;
  versionId: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  retrieval: PartRetrieval;
}

/** One normalised source record — the `WovenRecord` shape, made source-neutral. */
export interface SourceRecord {
  source: SourceSystem;
  contentType: ContentType;
  entityId: string;
  title: string;
  /** The source's own status label, as shown (e.g. "Published", "Current"). */
  status: string | null;
  /** The adapter's verdict on that label. Only `published` is ever synced. */
  publication: Publication;
  /** Audience labels as the source states them. Null: the source gave none. */
  audience: string[] | null;
  version: string | null;
  versionId: string | null;
  /** ISO date or date-time where the source provided one. */
  updatedAt: string | null;
  documentIds: string[];
  attachmentIds: string[];
  /**
   * A deterministic digest of detail content, for records with no dependable
   * updated timestamp (Procedures). Null where metadata is enough.
   */
  contentFingerprint: string | null;
  /** Display metadata only. Never a signed URL, a token or a person's data. */
  sourceMetadata: Record<string, string | number | boolean | null>;
  parts: SourcePart[];
}

/** One adapter's read of one content type. */
export type ListingResult =
  | {
      ok: true;
      contentType: ContentType;
      records: SourceRecord[];
      /** Non-secret shape notes for the preview: header labels, raw status values. */
      diagnostics: Record<string, unknown>;
    }
  | { ok: false; contentType: ContentType; code: string; message: string };

export interface FetchedFile {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
}

/** What a source connector gives the engine. */
export interface KnowledgeSourceConnector {
  readonly source: SourceSystem;
  /** Signs in and proves the right tenant is selected. Throws on failure. */
  connect(): Promise<ConnectionInfo>;
  /** Reads one content type. Never throws for an adapter-level failure: returns `ok: false`. */
  list(contentType: ContentType): Promise<ListingResult>;
  /** Obtains one part's bytes, fresh. Throws `PartFetchError` when it cannot. */
  fetchPart(item: {
    contentType: ContentType;
    entityId: string;
    partKey: string;
    locator: Record<string, string>;
    fileName: string | null;
    mimeType: string | null;
  }): Promise<FetchedFile>;
  readonly requestsMade: number;
}

export interface ConnectionInfo {
  /** The tenant the session is operating in, as the source displayed it. */
  companyLabel: string | null;
  companyVerified: boolean;
}

/** Why one part could not be fetched. `category` is a code; `message` is a user-safe sentence. */
export class PartFetchError extends Error {
  readonly category: string;
  readonly retryable: boolean;
  /** The source session ended: the engine stops starting items and leaves them for the next run. */
  readonly sessionLost: boolean;
  constructor(category: string, message: string, retryable: boolean, options: { sessionLost?: boolean } = {}) {
    super(message);
    this.name = "PartFetchError";
    this.category = category;
    this.retryable = retryable;
    this.sessionLost = options.sessionLost ?? false;
  }
}

/* ------------------------------------------------------------ manifest -- */

export interface ManifestItem {
  source: SourceSystem;
  contentType: ContentType;
  entityId: string;
  partKey: string;

  title: string;
  status: string | null;
  audience: string[] | null;
  version: string | null;
  versionId: string | null;
  sourceUpdatedAt: string | null;
  documentId: string | null;
  attachmentIds: string[];
  /** Non-secret fetch identifiers. Null when the part cannot be fetched. */
  locator: Record<string, string> | null;
  mimeType: string | null;
  fileName: string | null;

  /** Metadata fingerprint seen at the latest scan. */
  observedFingerprint: string;
  /** Fingerprint of the metadata last APPLIED to Ask Sunny. Null until first applied. */
  syncedFingerprint: string | null;
  /** SHA-256 of the bytes last ingested. */
  contentHash: string | null;

  /** The Ask Sunny knowledge document this item owns. Assigned before first ingest. */
  knowledgeDocumentId: string | null;
  /** True while that document is searchable in Ask Sunny. */
  inAskSunny: boolean;

  state: SyncState;
  previousState: SyncState | null;
  pendingAction: PendingAction;
  /** Why an item is blocked, excluded or held: a code, never a record's text. */
  reason: string | null;

  lastError: string | null;
  errorCategory: string | null;
  retryCount: number;
  nextRetryAt: string | null;

  firstSeenAt: string;
  lastSeenAt: string;
  lastSyncedAt: string | null;
}

export interface AudienceDecision {
  source: SourceSystem;
  /** The normalised audience key — see `audienceKey`. */
  audienceKey: string;
  decision: "company_wide" | "excluded";
  decidedBy: string;
  decidedAt: string;
}

export interface SyncSettings {
  source: SourceSystem;
  autoSyncEnabled: boolean;
  intervalDays: number;
  initialSyncCompletedAt: string | null;
  lastFullScanAt: string | null;
  lastSuccessAt: string | null;
}

/* ---------------------------------------------------------------- runs -- */

export type RunMode = "preview" | "sync" | "continue";
export type RunTrigger = "schedule" | "manual";
export type RunStatus = "running" | "succeeded" | "succeeded_with_warnings" | "failed";

export interface TypeReport {
  listing: "ok" | "failed" | "not_trusted" | "not_read";
  listingCode: string | null;
  discovered: number;
  items: number;
  eligible: number;
  excludedUnpublished: number;
  excludedUnsupported: number;
  excludedByDecision: number;
  needsReview: number;
  blocked: number;
  blockedCapabilities: string[];
  statusValues: Record<string, number>;
  new: number;
  updated: number;
  unchanged: number;
  permissionChanged: number;
  unpublished: number;
  removed: number;
  errors: number;
}

export interface AttentionItem {
  /** Stable code for tests and logs. */
  code: string;
  /** One plain sentence for a busy manager. No routes, hashes or tokens. */
  message: string;
  count?: number;
}

export interface SyncReport {
  mode: RunMode;
  trigger: RunTrigger;
  company: ConnectionInfo | null;
  byType: Partial<Record<ContentType, TypeReport>>;
  totals: {
    discovered: number;
    inSync: number;
    new: number;
    updated: number;
    metadataOnly: number;
    unchanged: number;
    permissionChanged: number;
    unpublished: number;
    removed: number;
    excluded: number;
    needsReview: number;
    blocked: number;
    errors: number;
    /** Planned work not reached within this run's time budget; the next tick continues it. */
    deferred: number;
    /** Removals held back by the mass-removal guard. */
    removalsHeld: number;
  };
  audiences: { audienceKey: string; label: string; items: number; decision: AudienceDecision["decision"] | "public" | null }[];
  /** Eligible items whose title matches a document uploaded to Ask Sunny by hand. */
  possibleManualDuplicates: number;
  attention: AttentionItem[];
  requestsMade: number;
  durationMs: number;
}

export interface SyncEvent {
  runId: string;
  contentType: ContentType;
  entityId: string;
  partKey: string;
  action: "ingest" | "update" | "metadata_only" | "retire" | "skip";
  result: "ok" | "error";
  contentHash: string | null;
  durationMs: number;
  errorCategory: string | null;
}
