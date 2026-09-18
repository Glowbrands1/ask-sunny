import { NextResponse } from "next/server";

import { authorizeAdminConsoleRequest, authorizeRequest } from "@/lib/auth/server";
import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { requireDocumentId } from "@/lib/api/validation";
import { activeKnowledgeCorpus } from "@/lib/knowledge/corpus";
import { deleteDocument } from "@/lib/ingestion/lifecycle";
import { SupabaseKnowledgeProvider } from "@/lib/knowledge/providers/supabase";

/**
 * ONE DOCUMENT: read it, or delete it. The two verbs sit at deliberately
 * different heights.
 *
 * GET is `view_knowledge` — the same permission the original-file route asks
 * for, and for the same reason given there. Somebody Sunny just quoted a policy
 * to, by name, is not being told anything new by being shown that policy's own
 * record. This is what keeps a citation clickable for a Regional Manager or an
 * Employee now that the Knowledge Base SCREEN is administrators-only.
 *
 * DELETE is the admin console. Destroying a document is administration of the
 * corpus, not use of it.
 *
 * The asymmetry is the whole point: reading the one document you were cited is
 * not the same act as managing the library it lives in.
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
    // SERVER-DERIVED, as everywhere else — a `?scope=` is not read.
    const scopeId = activeKnowledgeCorpus();

    const document = await new SupabaseKnowledgeProvider().getDocument(
      documentId,
      scopeId,
    );

    if (!document) {
      /*
       * ONE ANSWER FOR "no such document" AND "not in this corpus". Telling the
       * two apart would let a caller probe another brand's ids.
       */
      return NextResponse.json({ error: "That document could not be found." }, { status: 404 });
    }

    return NextResponse.json({ document });
  } catch (error) {
    return errorResponse(error, "GET /api/knowledge/documents/[id]");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    await authorizeAdminConsoleRequest(request, "manage_knowledge");
    assertWithinRateLimit(request, "mutate");

    const { id } = await params;
    const documentId = requireDocumentId(id);
    /*
     * SERVER-DERIVED. A corpus on the request is not read — see
     * `activeKnowledgeCorpus` for why a valid scope id is not an authorized one.
     */
    const scopeId = activeKnowledgeCorpus();

    const result = await deleteDocument({ documentId, scopeId });

    return NextResponse.json({
      deleted: true,
      documentId,
      deletedObjects: result.deletedObjects,
    });
  } catch (error) {
    return errorResponse(error, "DELETE /api/knowledge/documents/[id]");
  }
}
