import { NextResponse } from "next/server";

import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { requireDocumentId, requireScopeId } from "@/lib/api/validation";
import { authorizeRequest } from "@/lib/auth/server";
import { ACTIVE_BRAND } from "@/lib/brand";
import { OriginalFileError, originalFileLink } from "@/lib/knowledge/original-file";

/**
 * GET /api/knowledge/documents/[id]/file?scope=…&mode=download|preview
 *
 * A short-lived signed URL for the document's ORIGINAL stored file — the bytes
 * the manager uploaded, not a reconstruction from extracted text or chunks.
 *
 * ============================================================================
 * `view_knowledge`, AND WHY THAT IS NOT A BROADENING
 * ============================================================================
 *
 * It is the permission the Knowledge Base page itself requires, and the library
 * listing already returns every document's title, description, category, size
 * and uploader to anybody holding it. The retrieval path goes further: a
 * grounded answer quotes the document's own text. Somebody who may read the
 * policy through Sunny and see it listed by name is not being given anything
 * new by being able to open it — and a manager who cannot re-open a document
 * they uploaded is the problem this route exists to fix.
 *
 * `manage_knowledge` stays what it is: upload, re-index, delete. Reading the
 * file is not managing it.
 *
 * ============================================================================
 * WHAT THE BROWSER MAY SAY
 * ============================================================================
 *
 * A DOCUMENT ID, A SCOPE, AND A MODE. Never a storage path — there is no
 * parameter for one. The path is read from the row and re-validated against the
 * scope before it is signed, so a row edited outside this app cannot become a
 * way to read another corpus's objects either.
 *
 * The row is selected on id AND scope together, so editing the id in the URL
 * does not cross a scope boundary — it returns nothing and answers 404.
 *
 * NOTHING INTERNAL CROSSES THE BOUNDARY. No storage path, no bucket layout, no
 * provider error text. Failures carry a category and a sentence a manager can
 * act on.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    await authorizeRequest(request, "view_knowledge");
    assertWithinRateLimit(request, "search");

    const { id } = await params;
    const documentId = requireDocumentId(id);

    const url = new URL(request.url);
    const scopeId = requireScopeId(
      url.searchParams.get("scope") ?? ACTIVE_BRAND.knowledgeScopeId,
    );
    // Anything that is not the literal "preview" is a download. An unknown mode
    // must not fall through to the inline one.
    const mode = url.searchParams.get("mode") === "preview" ? "preview" : "download";

    const link = await originalFileLink({ documentId, scopeId, mode });

    return NextResponse.json(link, {
      // A signed URL is a credential with a clock on it.
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof OriginalFileError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    return errorResponse(error, "GET /api/knowledge/documents/[id]/file");
  }
}
