import "server-only";

import { activeKnowledgeCorpus } from "@/lib/knowledge/corpus";
import { IngestionError } from "@/lib/ingestion/errors";
import { retireDocument, supersedeDocument, updateDocumentMetadata } from "@/lib/ingestion/lifecycle";
import { ingestDocument } from "@/lib/ingestion/pipeline";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { KnowledgeCategory } from "@/types";
import { SinkError, type KnowledgeSink } from "./ports";
import { planSupersession, type LibraryDocument } from "./supersession";
import type { SourceSystem } from "./types";

/**
 * ASK SUNNY'S EXISTING KNOWLEDGE PIPELINE, as the sync engine's sink.
 *
 * No second knowledge system: a synced document goes through the same
 * validate → private Storage → extract → chunk → embed → pgvector path an
 * upload does (`ingestDocument`), lands in the same `knowledge_documents` row
 * shape, and is cited, searched and permissioned exactly like any other.
 *
 * What differs is identity: the engine passes the document id the manifest
 * owns, so a source item is one document for its whole life.
 */

const UPLOADER_LABEL: Record<SourceSystem, string> = { woven: "Woven sync" };

function asSinkError(error: unknown, fallback: string): SinkError {
  if (error instanceof IngestionError) {
    /* Not retryable: the file itself is the problem, and trying again tomorrow changes nothing. */
    const permanent = ["unsupported_type", "too_large", "empty_file", "no_text"].includes(error.code);
    return new SinkError(`ingest_${error.code}`, error.message.slice(0, 300), !permanent);
  }
  return new SinkError(fallback, "Ask Sunny could not save this document.", true);
}

export function createSupabaseKnowledgeSink(source: SourceSystem): KnowledgeSink {
  const scopeId = activeKnowledgeCorpus();

  return {
    async ingest(document) {
      try {
        const bytes = new Uint8Array(document.bytes);
        const result = await ingestDocument({
          file: new Blob([bytes], { type: document.mimeType }),
          fileName: document.fileName,
          mimeType: document.mimeType,
          title: document.title,
          description: document.description,
          category: document.category as KnowledgeCategory,
          tags: document.tags,
          scopeId,
          uploadedByName: UPLOADER_LABEL[source],
          uploadedById: null,
          documentId: document.documentId,
          source,
          supersededNote: "Updated in Woven",
        });
        return { reusedExistingEmbeddings: result.reusedExistingEmbeddings };
      } catch (error) {
        throw asSinkError(error, "ingest_failed");
      }
    },

    async updateMetadata(documentId, metadata) {
      try {
        await updateDocumentMetadata({ documentId, scopeId, ...metadata });
      } catch (error) {
        throw asSinkError(error, "metadata_failed");
      }
    },

    async retire(documentId) {
      try {
        await retireDocument({ documentId, scopeId });
      } catch (error) {
        /* Already gone is the outcome retirement wanted. */
        if (error instanceof IngestionError && error.status === 404) return;
        throw asSinkError(error, "retire_failed");
      }
    },

    async supersedeDuplicates(currentDocumentIds) {
      const admin = getSupabaseAdmin();
      const columns = "id, title, original_filename, file_type, content_hash";
      const indexed = (from: string) =>
        admin.from("knowledge_documents").select(columns).eq("knowledge_scope_id", scopeId).eq("source", from).eq("indexed", true).eq("status", "indexed");
      const [synced, uploads] = await Promise.all([indexed(source), indexed("upload")]);
      if (synced.error || uploads.error) throw new SinkError("library_unavailable", "The knowledge library could not be read.");
      const toDoc = (r: { id: string; title: string; original_filename: string; file_type: string; content_hash: string | null }): LibraryDocument => ({
        id: r.id,
        title: r.title,
        originalFilename: r.original_filename,
        fileType: r.file_type,
        contentHash: r.content_hash,
      });
      /* Only what this run holds as CURRENT can replace anything. */
      const wanted = new Set(currentDocumentIds);
      const current = ((synced.data ?? []) as Parameters<typeof toDoc>[0][]).filter((r) => wanted.has(r.id)).map(toDoc);
      const plan = planSupersession(current, ((uploads.data ?? []) as Parameters<typeof toDoc>[0][]).map(toDoc));
      const titleOf = new Map(current.map((d) => [d.id, d.title]));
      const superseded: { uploadTitle: string; currentTitle: string }[] = [];
      for (const s of plan.supersede) {
        try {
          if (await supersedeDocument({ documentId: s.uploadId, scopeId, supersededBy: s.supersededBy })) {
            superseded.push({ uploadTitle: s.uploadTitle, currentTitle: titleOf.get(s.supersededBy) ?? "" });
          }
        } catch (error) {
          throw asSinkError(error, "supersede_failed");
        }
      }
      return {
        superseded,
        held: plan.held.map((h) => ({ uploadTitle: h.uploadTitle, candidateTitles: h.candidates.map((c) => c.title), reason: h.reason })),
      };
    },

    async countManualTitleMatches(titles) {
      const { data, error } = await getSupabaseAdmin()
        .from("knowledge_documents")
        .select("title")
        .eq("knowledge_scope_id", scopeId)
        .eq("source", "upload");
      if (error) throw new SinkError("library_unavailable", "The knowledge library could not be read.");
      const manual = new Set(((data ?? []) as { title: string }[]).map((r) => r.title.trim().toLowerCase()));
      return titles.filter((title) => manual.has(title.trim().toLowerCase())).length;
    },
  };
}
