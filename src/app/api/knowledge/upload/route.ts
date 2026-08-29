import { NextResponse } from "next/server";

import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import {
  LIMITS,
  optionalString,
  parseTags,
  requireScopeId,
  requireString,
} from "@/lib/api/validation";
import { authorizeRequest } from "@/lib/auth/server";
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
 * Protected by `manage_knowledge`. In live mode that means the route is refused
 * outright until a real identity provider is configured — writing to the
 * company knowledge base is exactly the functionality that must stay closed
 * until authentication exists.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const VALID_CATEGORIES = new Set(KNOWLEDGE_CATEGORIES.map((entry) => entry.id));

export async function POST(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    await authorizeRequest(request, "manage_knowledge");
    assertWithinRateLimit(request, "upload");

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

    const result = await ingestDocument({
      file,
      // Only the leaf name matters; sanitizeFileName strips any path anyway.
      fileName: file.name,
      mimeType: file.type,
      title: requireString(form.get("title"), "A document title", LIMITS.title),
      description: optionalString(form.get("description"), LIMITS.description),
      category,
      tags: parseTags(form.get("tags")),
      scopeId: requireScopeId(form.get("scopeId") ?? ACTIVE_BRAND.knowledgeScopeId),
      uploadedByName: optionalString(
        form.get("uploadedBy"),
        LIMITS.personName,
        "Unknown",
      ),
    });

    return NextResponse.json({
      document: result.document,
      chunkCount: result.chunkCount,
      reusedExistingEmbeddings: result.reusedExistingEmbeddings,
    });
  } catch (error) {
    return errorResponse(error, "POST /api/knowledge/upload");
  }
}
