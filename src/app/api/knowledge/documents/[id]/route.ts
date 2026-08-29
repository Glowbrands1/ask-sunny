import { NextResponse } from "next/server";

import { authorizeRequest } from "@/lib/auth/server";
import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { requireDocumentId, requireScopeId } from "@/lib/api/validation";
import { ACTIVE_BRAND } from "@/lib/brand";
import { deleteDocument } from "@/lib/ingestion/lifecycle";

/**
 * DELETE /api/knowledge/documents/[id]?scope=…
 *
 * Removes a document completely: stored bytes for every version, every chunk,
 * and the row. Protected by `manage_knowledge`, which in live mode means it is
 * refused outright until a real identity provider is configured.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    await authorizeRequest(request, "manage_knowledge");
    assertWithinRateLimit(request, "mutate");

    const { id } = await params;
    const documentId = requireDocumentId(id);
    const scopeId = requireScopeId(
      new URL(request.url).searchParams.get("scope") ?? ACTIVE_BRAND.knowledgeScopeId,
    );

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
