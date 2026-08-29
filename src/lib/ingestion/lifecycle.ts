import "server-only";

import { EMBEDDING_DIMENSIONS } from "@/lib/config/models";
import { MissingConfigurationError } from "@/lib/config/server-env";
import { getEmbeddingProvider } from "@/lib/embeddings";
import { rowToDocument, type KnowledgeDocumentRow } from "@/lib/knowledge/mappers";
import { KNOWLEDGE_BUCKET, getSupabaseAdmin } from "@/lib/supabase/server";
import type { KnowledgeDocument } from "@/types";
import { chunkSegments } from "./chunking";
import { IngestionError } from "./errors";
import { extractDocument } from "./extract";
import { hashChunks } from "./pipeline";
import { assertPathWithinScope } from "./paths";
import type { SupportedFileType } from "./validation";

/**
 * DOCUMENT LIFECYCLE OPERATIONS beyond first upload.
 *
 *   retry     — a failed document runs the pipeline again from its stored file
 *   re-index  — an indexed document is re-chunked and re-embedded in place
 *   delete    — the row, every version's chunks, and every stored object
 *
 * Retry and re-index are the same operation. A failed run and a deliberate
 * refresh both mean "process the bytes we already have again", and having one
 * code path means the recovery route is the one that gets exercised.
 *
 * Neither re-uploads the file: the original is already in the private bucket,
 * which is precisely why a failure is recoverable without asking a manager to
 * find the document again.
 */

export interface ReindexResult {
  document: KnowledgeDocument;
  chunkCount: number;
  /** True when the content was unchanged and embeddings were reused. */
  reusedExistingEmbeddings: boolean;
}

export async function reindexDocument(input: {
  documentId: string;
  scopeId: string;
  /** Set true by an explicit re-index to re-embed even unchanged content. */
  force?: boolean;
}): Promise<ReindexResult> {
  const supabase = getSupabaseAdmin();
  const row = await loadDocument(input.documentId, input.scopeId);

  // Never trust a path from a row without re-checking it: a row edited outside
  // this app must not become a way to read another scope's objects.
  const storagePath = assertPathWithinScope(row.storage_path, input.scopeId);

  await setProcessing(input.documentId);

  try {
    /* 1. Re-read the original from the private bucket. */
    const { data: blob, error: downloadError } = await supabase.storage
      .from(KNOWLEDGE_BUCKET)
      .download(storagePath);

    if (downloadError || !blob) {
      throw new IngestionError(
        "persistence_failed",
        "The original file could not be read from storage, so this document cannot be re-indexed. Upload it again.",
        502,
      );
    }

    /* 2. Extract and chunk exactly as first upload does. */
    const buffer = new Uint8Array(await blob.arrayBuffer());
    const extracted = await extractDocument(row.file_type as SupportedFileType, buffer);
    const chunks = chunkSegments(extracted.segments);

    if (chunks.length === 0) {
      throw new IngestionError(
        "no_text",
        "No indexable text was found in this document.",
        422,
      );
    }

    const contentHash = hashChunks(chunks);

    /* 3. Embed, unless the content is unchanged and this is a retry rather
          than a forced re-index. A retry of a failure that happened after
          embedding should not pay for embedding twice. */
    const unchanged = row.content_hash === contentHash;
    const existingChunkCount = await countChunks(input.documentId, row.version);
    const canReuse =
      !input.force && unchanged && existingChunkCount === chunks.length;

    if (!canReuse) {
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
      if (vectors.some((vector) => vector.length !== EMBEDDING_DIMENSIONS)) {
        throw new IngestionError(
          "embedding_failed",
          "An embedding of the wrong width was produced; nothing was indexed.",
          502,
        );
      }

      /* 4. Replace this version's chunks. Deleted first here, unlike a new
            upload: re-indexing a version in place has no other copy to fall
            back to, and the unique constraint on (document, version, index)
            would reject the insert otherwise. The document is already marked
            not-indexed above, so nothing is citable during the gap. */
      const { error: deleteError } = await supabase
        .from("knowledge_chunks")
        .delete()
        .eq("document_id", input.documentId);
      if (deleteError) {
        throw new IngestionError(
          "persistence_failed",
          `Existing chunks could not be cleared: ${deleteError.message}`,
          502,
        );
      }

      const { error: insertError } = await supabase.from("knowledge_chunks").insert(
        chunks.map((chunk, index) => ({
          document_id: input.documentId,
          knowledge_scope_id: input.scopeId,
          chunk_index: chunk.index,
          version: row.version,
          content: chunk.content,
          locator: chunk.locator,
          page: chunk.page,
          section: chunk.section,
          metadata: {
            tokenEstimate: chunk.tokenEstimate,
            charCount: chunk.charCount,
            fileType: row.file_type,
            reindexed: true,
          },
          embedding_model: embeddings.model,
          embedding: vectors[index]!,
        })),
      );

      if (insertError) {
        throw new IngestionError(
          "persistence_failed",
          `Chunks could not be saved: ${insertError.message}`,
          502,
        );
      }
    }

    /* 5. Indexed only now. */
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
      .eq("id", input.documentId)
      .eq("knowledge_scope_id", input.scopeId)
      .select("*")
      .single();

    if (error || !data) {
      throw new IngestionError(
        "persistence_failed",
        `The document was re-indexed but its status could not be saved: ${error?.message ?? "unknown error"}`,
        502,
      );
    }

    return {
      document: rowToDocument(data as KnowledgeDocumentRow),
      chunkCount: chunks.length,
      reusedExistingEmbeddings: canReuse,
    };
  } catch (error) {
    const reason =
      error instanceof IngestionError
        ? error.message
        : "Re-indexing failed unexpectedly.";
    await setFailed(input.documentId, reason);
    throw error instanceof IngestionError
      ? error
      : new IngestionError("extraction_failed", reason, 500);
  }
}

/**
 * Deletes a document completely: every version's stored bytes, every chunk, and
 * the row.
 *
 * Order matters. Storage objects go first, because an orphaned row is visible
 * and fixable while an orphaned private object is invisible and pays rent
 * forever. Chunks cascade from the row's foreign key, but they are removed
 * explicitly so the intent is in the code rather than only in the schema.
 */
export async function deleteDocument(input: {
  documentId: string;
  scopeId: string;
}): Promise<{ deletedObjects: number }> {
  const supabase = getSupabaseAdmin();
  const row = await loadDocument(input.documentId, input.scopeId);

  // Every version of this document lives under its own id prefix, so listing
  // that prefix is how earlier versions are found — no path is guessed and
  // nothing outside the prefix can be reached.
  const prefix = `${input.scopeId}/${input.documentId}`;
  const paths = await listObjectPaths(prefix);

  // The current version's path is included even if listing missed it.
  const currentPath = assertPathWithinScope(row.storage_path, input.scopeId);
  if (!paths.includes(currentPath)) paths.push(currentPath);

  const safePaths = paths.filter((path) => {
    try {
      assertPathWithinScope(path, input.scopeId);
      return path.startsWith(`${prefix}/`);
    } catch {
      return false;
    }
  });

  if (safePaths.length > 0) {
    const { error } = await supabase.storage.from(KNOWLEDGE_BUCKET).remove(safePaths);
    if (error) {
      throw new IngestionError(
        "persistence_failed",
        `The stored files could not be removed: ${error.message}`,
        502,
      );
    }
  }

  const { error: chunkError } = await supabase
    .from("knowledge_chunks")
    .delete()
    .eq("document_id", input.documentId)
    .eq("knowledge_scope_id", input.scopeId);
  if (chunkError) {
    throw new IngestionError(
      "persistence_failed",
      `The document's chunks could not be removed: ${chunkError.message}`,
      502,
    );
  }

  const { error: rowError } = await supabase
    .from("knowledge_documents")
    .delete()
    .eq("id", input.documentId)
    .eq("knowledge_scope_id", input.scopeId);
  if (rowError) {
    throw new IngestionError(
      "persistence_failed",
      `The document record could not be removed: ${rowError.message}`,
      502,
    );
  }

  return { deletedObjects: safePaths.length };
}

/* ------------------------------------------------------------- helpers --- */

async function loadDocument(
  documentId: string,
  scopeId: string,
): Promise<KnowledgeDocumentRow> {
  const { data, error } = await getSupabaseAdmin()
    .from("knowledge_documents")
    .select("*")
    // Scoped on both columns: an id alone must never reach another corpus.
    .eq("id", documentId)
    .eq("knowledge_scope_id", scopeId)
    .maybeSingle();

  if (error) {
    throw new IngestionError(
      "persistence_failed",
      `The document could not be read: ${error.message}`,
      502,
    );
  }
  if (!data) {
    throw new IngestionError("not_configured", "That document no longer exists.", 404);
  }

  return data as KnowledgeDocumentRow;
}

async function listObjectPaths(prefix: string): Promise<string[]> {
  const supabase = getSupabaseAdmin();
  const { data: versionFolders } = await supabase.storage
    .from(KNOWLEDGE_BUCKET)
    .list(prefix, { limit: 200 });

  const paths: string[] = [];
  for (const folder of versionFolders ?? []) {
    const { data: files } = await supabase.storage
      .from(KNOWLEDGE_BUCKET)
      .list(`${prefix}/${folder.name}`, { limit: 200 });
    for (const file of files ?? []) {
      paths.push(`${prefix}/${folder.name}/${file.name}`);
    }
  }
  return paths;
}

async function countChunks(documentId: string, version: number): Promise<number> {
  const { count } = await getSupabaseAdmin()
    .from("knowledge_chunks")
    .select("id", { count: "exact", head: true })
    .eq("document_id", documentId)
    .eq("version", version);
  return count ?? 0;
}

/** A document being reprocessed is never citable while the run is in flight. */
async function setProcessing(documentId: string): Promise<void> {
  await getSupabaseAdmin()
    .from("knowledge_documents")
    .update({ status: "processing", indexed: false, failure_reason: null })
    .eq("id", documentId);
}

async function setFailed(documentId: string, reason: string): Promise<void> {
  await getSupabaseAdmin()
    .from("knowledge_documents")
    .update({ status: "failed", indexed: false, failure_reason: reason })
    .eq("id", documentId);
}
