import { NextResponse } from "next/server";

import { assertLiveMode, errorResponse } from "@/lib/api/respond";
import { ACTIVE_BRAND } from "@/lib/brand";
import { UPLOAD_LIMITS } from "@/lib/config/models";
import { IngestionError } from "@/lib/ingestion/errors";
import { ingestDocument } from "@/lib/ingestion/pipeline";
import { KNOWLEDGE_CATEGORIES } from "@/data/demo/knowledge";
import type { KnowledgeCategory } from "@/types";

/**
 * POST /api/knowledge/upload  (multipart/form-data)
 *
 * The live ingestion entry point:
 *   file -> validate -> private Storage -> extract -> chunk -> embed -> pgvector
 *
 * Everything a browser sent is treated as untrusted. The file type, the size
 * and the category are all re-checked here; the storage path is derived
 * server-side and never accepted from the request.
 *
 * SECURITY NOTE (not yet closed): no authentication. Uploading to the company
 * knowledge base must be gated behind real auth before this is deployed
 * anywhere reachable.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const VALID_CATEGORIES = new Set(KNOWLEDGE_CATEGORIES.map((entry) => entry.id));

export async function POST(request: Request) {
  try {
    assertLiveMode();

    const form = await request.formData().catch(() => null);
    if (!form) {
      throw new IngestionError("unsupported_type", "The upload could not be read.", 400);
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new IngestionError("unsupported_type", "No file was included in the upload.", 400);
    }

    // Checked before anything is read into memory.
    if (file.size > UPLOAD_LIMITS.maxBytes) {
      const limitMb = Math.round(UPLOAD_LIMITS.maxBytes / (1024 * 1024));
      throw new IngestionError(
        "too_large",
        `"${file.name}" is larger than the ${limitMb} MB limit.`,
        413,
      );
    }

    const categoryRaw = String(form.get("category") ?? "other");
    const category: KnowledgeCategory = VALID_CATEGORIES.has(categoryRaw as KnowledgeCategory)
      ? (categoryRaw as KnowledgeCategory)
      : "other";

    const scopeId = String(form.get("scopeId") ?? ACTIVE_BRAND.knowledgeScopeId);
    if (!/^[a-z0-9-]{1,64}$/i.test(scopeId)) {
      throw new IngestionError("unsupported_type", "A valid knowledge scope is required.", 400);
    }

    const result = await ingestDocument({
      file,
      // Only the leaf name matters; sanitizeFileName strips any path anyway.
      fileName: file.name,
      mimeType: file.type,
      title: String(form.get("title") ?? "").slice(0, 300),
      description: String(form.get("description") ?? "").slice(0, 2000),
      category,
      tags: String(form.get("tags") ?? "")
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 24),
      scopeId,
      uploadedByName: String(form.get("uploadedBy") ?? "Unknown").slice(0, 120),
    });

    return NextResponse.json({
      document: result.document,
      chunkCount: result.chunkCount,
      reusedExistingEmbeddings: result.reusedExistingEmbeddings,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
