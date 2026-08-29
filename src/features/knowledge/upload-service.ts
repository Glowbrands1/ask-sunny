import { isDemoMode } from "@/lib/config/runtime";
import { SUPPORTED_LABEL, validateUpload } from "@/lib/ingestion/validation";
import type { KnowledgeCategory, KnowledgeDocument } from "@/types";

/**
 * The upload dialog's one route to the outside world.
 *
 * demo -> nothing is sent anywhere. The caller stores the file in IndexedDB
 *         through the StorageProvider, exactly as the prototype always has.
 *
 * live -> the file is POSTed to /api/knowledge/upload, which validates it
 *         again, stores the original in the private bucket, extracts, chunks,
 *         embeds and indexes it, then returns the persisted document.
 *
 * The component itself imports no Supabase client and no key — it calls this.
 */

export { SUPPORTED_LABEL };

/** Client-side pre-check, for a fast message. The server re-checks everything. */
export function precheckFile(file: File): string | null {
  try {
    validateUpload({
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "This file cannot be uploaded.";
  }
}

export interface UploadRequest {
  file: File;
  title: string;
  description: string;
  category: KnowledgeCategory;
  tags: string[];
  scopeId: string;
  uploadedBy: string;
}

export interface UploadOutcome {
  document: KnowledgeDocument;
  chunkCount: number;
}

export function uploadsAreLive(): boolean {
  return !isDemoMode();
}

export async function uploadToKnowledgeBase(
  request: UploadRequest,
): Promise<UploadOutcome> {
  const form = new FormData();
  form.set("file", request.file);
  form.set("title", request.title);
  form.set("description", request.description);
  form.set("category", request.category);
  form.set("tags", request.tags.join(","));
  form.set("scopeId", request.scopeId);
  form.set("uploadedBy", request.uploadedBy);

  const response = await fetch("/api/knowledge/upload", {
    method: "POST",
    body: form,
  });

  const payload = (await response.json().catch(() => ({}))) as {
    document?: KnowledgeDocument;
    chunkCount?: number;
    error?: string;
  };

  if (!response.ok || !payload.document) {
    throw new Error(payload.error ?? "The document could not be indexed.");
  }

  return { document: payload.document, chunkCount: payload.chunkCount ?? 0 };
}
