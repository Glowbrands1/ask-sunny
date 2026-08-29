import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { EMBEDDING_DIMENSIONS } from "@/lib/config/models";
import { MissingConfigurationError } from "@/lib/config/server-env";
import { getEmbeddingProvider } from "@/lib/embeddings";
import { KNOWLEDGE_BUCKET, getSupabaseAdmin } from "@/lib/supabase/server";
import type { KnowledgeCategory, KnowledgeDocument } from "@/types";
import { rowToDocument, type KnowledgeDocumentRow } from "@/lib/knowledge/mappers";
import { chunkSegments, type DocumentChunk } from "./chunking";
import { IngestionError } from "./errors";
import { extractDocument } from "./extract";
import { buildStoragePath, sanitizeFileName } from "./paths";
import { validateUpload } from "./validation";

/**
 * INGESTION PIPELINE
 *
 *   file -> validate -> store original -> extract -> chunk -> embed -> persist
 *
 * Ordering rules that are not negotiable:
 *
 *   * The document row exists BEFORE the bytes are read, in status
 *     "uploading". A crash mid-run leaves a visible, recoverable record rather
 *     than an orphaned file.
 *   * `indexed` flips to true, and status to "indexed", only AFTER every chunk
 *     row has been written. A partially embedded document is never citable:
 *     the retrieval RPC filters on `indexed = true` and on the current version.
 *   * Chunks for the previous version are deleted only once the new version's
 *     chunks are in, so retrieval is never left with nothing.
 *   * A failure writes status "failed" plus a user-safe reason. Re-running is
 *     the recovery path, and it is idempotent.
 */

export interface IngestInput {
  file: Blob;
  fileName: string;
  mimeType: string;
  title: string;
  description?: string;
  category: KnowledgeCategory;
  tags?: string[];
  scopeId: string;
  uploadedByName: string;
}

export interface IngestResult {
  document: KnowledgeDocument;
  chunkCount: number;
  /** True when an unchanged version meant embeddings were reused. */
  reusedExistingEmbeddings: boolean;
}

export async function ingestDocument(input: IngestInput): Promise<IngestResult> {
  /* 1. Validate, server-side, whatever the browser claimed.
        Deliberately before any service is touched, so an unsupported file gets
        the reason it was actually rejected rather than a configuration error
        that happens to fire first. */
  const validated = validateUpload({
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.file.size,
  });

  const title = input.title.trim();
  if (!title) {
    throw new IngestionError("empty_file", "A document title is required.");
  }

  const supabase = getSupabaseAdmin();

  /* 2. Versioning: same title in the same scope supersedes, matching the
        behaviour the prototype's library already has. */
  const existing = await findByTitle(input.scopeId, title);
  const version = existing ? existing.version + 1 : 1;
  const previousVersions = existing
    ? [
        ...(existing.previous_versions ?? []),
        {
          version: existing.version,
          uploadedAt: existing.created_at,
          uploadedBy: existing.uploaded_by_name,
          sizeBytes: Number(existing.size_bytes),
          note: "Superseded by a newer upload",
        },
      ]
    : [];

  const documentId = existing?.id ?? randomUUID();

  // The path is derived entirely server-side. Nothing a client sent chooses it.
  const storagePath = buildStoragePath({
    scopeId: input.scopeId,
    documentId,
    version,
    fileName: sanitizeFileName(input.fileName),
  });

  /* 3. Record first, in "uploading". */
  const baseRow = {
    id: documentId,
    knowledge_scope_id: input.scopeId,
    title,
    description: input.description?.trim() ?? "",
    category: input.category,
    tags: input.tags ?? [],
    original_filename: sanitizeFileName(input.fileName),
    mime_type: validated.mimeType,
    file_type: validated.fileType,
    storage_path: storagePath,
    size_bytes: input.file.size,
    source: "upload" as const,
    status: "uploading" as const,
    indexed: false,
    failure_reason: null,
    version,
    previous_versions: previousVersions,
    uploaded_by_name: input.uploadedByName,
  };

  const { error: upsertError } = await supabase
    .from("knowledge_documents")
    .upsert(baseRow);
  if (upsertError) {
    throw new IngestionError(
      "persistence_failed",
      `The document record could not be saved: ${upsertError.message}`,
      502,
    );
  }

  try {
    /* 4. Store the original bytes in the PRIVATE bucket. */
    const { error: uploadError } = await supabase.storage
      .from(KNOWLEDGE_BUCKET)
      .upload(storagePath, input.file, {
        contentType: validated.mimeType,
        upsert: false,
      });
    if (uploadError) {
      throw new IngestionError(
        "persistence_failed",
        `The file could not be stored: ${uploadError.message}`,
        502,
      );
    }

    await setStatus(documentId, "processing");

    /* 5. Extract, preserving page/section locators. */
    const buffer = new Uint8Array(await input.file.arrayBuffer());
    const extracted = await extractDocument(validated.fileType, buffer);

    /* 6. Chunk. Deterministic, so an unchanged version hashes identically. */
    const chunks = chunkSegments(extracted.segments);
    if (chunks.length === 0) {
      throw new IngestionError(
        "no_text",
        "No indexable text was found in this document.",
        422,
      );
    }

    const contentHash = hashChunks(chunks);

    /* 7. Embed. Skipped entirely when the content is identical to the version
          already indexed, so re-uploading the same file costs nothing. */
    let reused = false;
    if (existing?.content_hash === contentHash && existing.indexed) {
      reused = true;
      await supabase
        .from("knowledge_chunks")
        .update({ version })
        .eq("document_id", documentId)
        .eq("version", existing.version);
    } else {
      const embeddings = getEmbeddingProvider();
      let vectors: number[][];
      try {
        vectors = await embeddings.embedDocuments(chunks.map((chunk) => chunk.content));
      } catch (error) {
        if (error instanceof MissingConfigurationError) {
          throw new IngestionError("not_configured", error.message, 503);
        }
        throw new IngestionError(
          "embedding_failed",
          error instanceof Error ? error.message : "Embedding failed.",
          502,
        );
      }

      if (vectors.length !== chunks.length) {
        throw new IngestionError(
          "embedding_failed",
          "The embedding service returned the wrong number of vectors.",
          502,
        );
      }

      /* 8. Persist chunks for the new version. */
      const rows = chunks.map((chunk, index) => ({
        document_id: documentId,
        knowledge_scope_id: input.scopeId,
        chunk_index: chunk.index,
        version,
        content: chunk.content,
        locator: chunk.locator,
        page: chunk.page,
        section: chunk.section,
        metadata: {
          tokenEstimate: chunk.tokenEstimate,
          charCount: chunk.charCount,
          fileType: validated.fileType,
        },
        embedding_model: embeddings.model,
        embedding: vectors[index]!,
      }));

      if (rows.some((row) => row.embedding.length !== EMBEDDING_DIMENSIONS)) {
        throw new IngestionError(
          "embedding_failed",
          "An embedding of the wrong width was produced; nothing was indexed.",
          502,
        );
      }

      const { error: chunkError } = await supabase.from("knowledge_chunks").insert(rows);
      if (chunkError) {
        throw new IngestionError(
          "persistence_failed",
          `Chunks could not be saved: ${chunkError.message}`,
          502,
        );
      }
    }

    /* 9. Retire the previous version's chunks, after the new ones landed. */
    if (existing && !reused) {
      await supabase
        .from("knowledge_chunks")
        .delete()
        .eq("document_id", documentId)
        .neq("version", version);
    }

    /* 10. Only now is the document indexed. */
    const { data, error } = await supabase
      .from("knowledge_documents")
      .update({
        status: "indexed",
        indexed: true,
        indexed_at: new Date().toISOString(),
        character_count: extracted.characterCount,
        content_hash: contentHash,
        failure_reason: null,
      })
      .eq("id", documentId)
      .select("*")
      .single();

    if (error || !data) {
      throw new IngestionError(
        "persistence_failed",
        `The document was indexed but its status could not be saved: ${error?.message ?? "unknown error"}`,
        502,
      );
    }

    return {
      document: rowToDocument(data as KnowledgeDocumentRow),
      chunkCount: chunks.length,
      reusedExistingEmbeddings: reused,
    };
  } catch (error) {
    // Recoverable failure: the record stays, marked failed with a reason a
    // manager can act on. Re-uploading re-runs the pipeline from the top.
    const reason =
      error instanceof IngestionError ? error.message : "Processing failed unexpectedly.";
    await setStatus(documentId, "failed", reason);
    throw error instanceof IngestionError
      ? error
      : new IngestionError("extraction_failed", reason, 500);
  }
}

/* ------------------------------------------------------------- helpers --- */

async function findByTitle(
  scopeId: string,
  title: string,
): Promise<KnowledgeDocumentRow | null> {
  const { data } = await getSupabaseAdmin()
    .from("knowledge_documents")
    .select("*")
    .eq("knowledge_scope_id", scopeId)
    .ilike("title", title)
    .order("version", { ascending: false })
    .limit(1);
  return ((data ?? [])[0] as KnowledgeDocumentRow | undefined) ?? null;
}

async function setStatus(
  documentId: string,
  status: "uploading" | "processing" | "indexed" | "failed",
  failureReason?: string,
): Promise<void> {
  await getSupabaseAdmin()
    .from("knowledge_documents")
    .update({
      status,
      // A document must never look indexed while work is outstanding.
      ...(status === "indexed" ? {} : { indexed: false }),
      failure_reason: failureReason ?? null,
    })
    .eq("id", documentId);
}

/**
 * Content digest over the chunk text. Deterministic chunking makes this a
 * stable identity for "this version's indexable content", which is what lets an
 * unchanged re-upload skip embedding entirely.
 */
export function hashChunks(chunks: DocumentChunk[]): string {
  const hash = createHash("sha256");
  for (const chunk of chunks) {
    hash.update(chunk.locator);
    hash.update("|");
    hash.update(chunk.content);
    hash.update("|");
  }
  return hash.digest("hex");
}
