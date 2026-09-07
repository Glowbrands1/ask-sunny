import { NextResponse } from "next/server";

import { authorizeRequest } from "@/lib/auth/server";
import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { parseJsonBody, requireDocumentId } from "@/lib/api/validation";
import { activeKnowledgeCorpus } from "@/lib/knowledge/corpus";
import { reindexDocument } from "@/lib/ingestion/lifecycle";

/**
 * POST /api/knowledge/documents/[id]/reindex
 *
 * Runs the pipeline again over the stored original: extract -> chunk -> embed
 * -> persist. This is the recovery path for a failed document AND the refresh
 * path for an indexed one — the same operation, so the recovery route is the
 * one that gets exercised.
 *
 * `force: true` re-embeds even when the extracted content is unchanged, which
 * is what a deliberate re-index means (say, after an embedding model change).
 * A plain retry reuses unchanged embeddings rather than paying for them twice.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    await authorizeRequest(request, "manage_knowledge");
    assertWithinRateLimit(request, "reindex");

    const { id } = await params;
    const documentId = requireDocumentId(id);

    const body = await parseJsonBody<{ scopeId?: string; force?: boolean }>(request);
    // `force` is still the caller's to choose. The corpus is not.
    const scopeId = activeKnowledgeCorpus();

    const result = await reindexDocument({
      documentId,
      scopeId,
      force: body.force === true,
    });

    return NextResponse.json({
      document: result.document,
      chunkCount: result.chunkCount,
      reusedExistingEmbeddings: result.reusedExistingEmbeddings,
    });
  } catch (error) {
    return errorResponse(error, "POST /api/knowledge/documents/[id]/reindex");
  }
}
