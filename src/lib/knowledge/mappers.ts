import type {
  DocumentFileType,
  DocumentStatus,
  DocumentVersion,
  KnowledgeCategory,
  KnowledgeDocument,
  SearchResult,
  SourceCitation,
} from "@/types";

/**
 * The single translation layer between database rows and the domain types the
 * UI already renders. Nothing else in the codebase knows a column name.
 */

/** Processing lifecycle as stored. Richer than DocumentStatus by one state. */
export type ProcessingStage = "uploading" | "processing" | "indexed" | "failed";

/**
 * Maps the four processing states onto the DocumentStatus union the library
 * screen and DocumentStatusBadge already handle. No new frontend status model
 * is invented: "uploading" and "processing" are both in-flight, and the
 * existing "Processing" badge is the honest label for both.
 */
export function toDocumentStatus(stage: ProcessingStage): DocumentStatus {
  switch (stage) {
    case "indexed":
      return "ready";
    case "failed":
      return "failed";
    case "uploading":
    case "processing":
      return "processing";
  }
}

/** A document is only ever "indexed" once every chunk is persisted. */
export function isIndexed(stage: ProcessingStage, indexed: boolean): boolean {
  return stage === "indexed" && indexed;
}

export interface KnowledgeDocumentRow {
  id: string;
  knowledge_scope_id: string;
  title: string;
  description: string;
  category: string;
  tags: string[] | null;
  original_filename: string;
  mime_type: string;
  file_type: string;
  storage_path: string;
  size_bytes: number;
  character_count: number;
  source: string;
  status: ProcessingStage;
  indexed: boolean;
  failure_reason: string | null;
  version: number;
  previous_versions: DocumentVersion[] | null;
  content_hash: string | null;
  uploaded_by: string | null;
  uploaded_by_name: string;
  created_at: string;
  updated_at: string;
  indexed_at: string | null;
}

export function rowToDocument(row: KnowledgeDocumentRow): KnowledgeDocument {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    category: row.category as KnowledgeCategory,
    fileName: row.original_filename,
    fileType: row.file_type as DocumentFileType,
    sizeBytes: Number(row.size_bytes),
    characterCount: row.character_count ?? 0,
    status: toDocumentStatus(row.status),
    source: row.source as KnowledgeDocument["source"],
    version: row.version,
    previousVersions: row.previous_versions ?? [],
    uploadedBy: row.uploaded_by_name,
    uploadedAt: row.created_at,
    updatedAt: row.updated_at,
    indexed: isIndexed(row.status, row.indexed),
    // Only meaningful on a failure, and written by the pipeline to be shown to
    // a manager. It never contains document text.
    failureReason: row.status === "failed" ? (row.failure_reason ?? undefined) : undefined,
    tags: row.tags ?? [],
  };
}

export interface MatchedChunkRow {
  chunk_id: string;
  document_id: string;
  document_title: string;
  category: string;
  locator: string;
  page: number | null;
  section: string | null;
  content: string;
  similarity: number;
}

export function rowToSearchResult(row: MatchedChunkRow): SearchResult {
  return {
    chunkId: row.chunk_id,
    documentId: row.document_id,
    documentTitle: row.document_title,
    locator: row.locator,
    content: row.content,
    score: clamp01(row.similarity),
  };
}

/**
 * Retrieval result -> source card.
 *
 * Every field comes from a row the database actually returned. The model is
 * never consulted for a document id, a title, a page number or an excerpt —
 * which is what makes it structurally impossible for Sunny to cite a document
 * that was not retrieved.
 */
export function rowToCitation(row: MatchedChunkRow): SourceCitation {
  return {
    documentId: row.document_id,
    documentTitle: row.document_title,
    locator: row.locator,
    category: (row.category ?? "other") as KnowledgeCategory,
    excerpt: row.content,
    relevance: clamp01(row.similarity),
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
