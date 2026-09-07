import { NextResponse } from "next/server";

import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { requireDocumentId } from "@/lib/api/validation";
import { authorizeRequest } from "@/lib/auth/server";
import { ACTIVE_BRAND } from "@/lib/brand";
import { OriginalFileError, originalFileLink } from "@/lib/knowledge/original-file";

/**
 * GET /api/knowledge/documents/[id]/file?mode=download|preview
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
 * THE CORPUS IS THE BUILD'S, NOT THE CALLER'S
 * ============================================================================
 *
 * THE GAP THIS CLOSES. This route read the corpus from `?scope=`, validated
 * only that it was SHAPED like a scope id, and used it. `bcs-core` is a real
 * scope — `src/lib/brand` defines it — so an authenticated Sun Tan City manager
 * holding `view_knowledge` could request a Beach Comber Suns document by id with
 * `?scope=bcs-core` and be handed a signed URL for its file.
 *
 * `authorizeRequest` did not stop it and was never going to: it proves WHO the
 * caller is and WHAT they may do, not WHICH company's corpus this deployment
 * serves. That is a property of the build, so it is read from the build.
 *
 * NOT FROM THE USER'S `AccessScope` EITHER. Salon, district and region scope
 * describe which locations a manager covers inside one brand; the knowledge
 * corpus is the brand itself. Deriving one from the other would conflate two
 * unrelated concepts and would break the moment a second brand shipped.
 *
 * ============================================================================
 * WHAT THE BROWSER MAY SAY
 * ============================================================================
 *
 * A DOCUMENT ID AND A MODE. Not a corpus, and not a storage path — there is no
 * parameter for either. The path is read from the row and re-validated against
 * the server-derived scope before it is signed, so a row edited outside this app
 * cannot become a way to read another corpus's objects either.
 *
 * The row is selected on id AND scope together, so a foreign document's id
 * simply matches nothing and answers 404.
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

    /*
     * SERVER-DERIVED, AND THERE IS NO PARAMETER THAT CAN INFLUENCE IT. A
     * `?scope=` on the URL is not read, not validated and not consulted — it is
     * simply not part of this route's input any more.
     */
    const scopeId = ACTIVE_BRAND.knowledgeScopeId;

    const url = new URL(request.url);
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
