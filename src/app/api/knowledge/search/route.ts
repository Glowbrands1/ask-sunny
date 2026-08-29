import { NextResponse } from "next/server";

import { AiError } from "@/lib/ai/errors";
import { assertLiveMode, assertNoConfigurationProblems, errorResponse } from "@/lib/api/respond";
import { RETRIEVAL } from "@/lib/config/models";
import { rowToCitation, rowToSearchResult } from "@/lib/knowledge/mappers";
import { SupabaseKnowledgeProvider } from "@/lib/knowledge/providers/supabase";
import type { KnowledgeQuery } from "@/lib/knowledge/types";

/**
 * POST /api/knowledge/search
 *
 * Retrieval without generation, used by RemoteKnowledgeProvider. Returns both
 * SearchResult[] and the matching SourceCitation[] so the browser never has to
 * reconstruct a citation from partial data.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();

    const body = (await request.json().catch(() => null)) as Partial<KnowledgeQuery> | null;
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    const scopeId = typeof body?.scopeId === "string" ? body.scopeId.trim() : "";

    if (!query) throw new AiError("bad_request", "A search query is required.", 400);
    if (!/^[a-z0-9-]{1,64}$/i.test(scopeId)) {
      throw new AiError("bad_request", "A valid knowledge scope is required.", 400);
    }

    const limit = Math.min(
      Math.max(1, Number(body?.limit) || RETRIEVAL.topK),
      RETRIEVAL.topK * 2,
    );

    const rows = await new SupabaseKnowledgeProvider().match({
      query: query.slice(0, 2000),
      scopeId,
      categories: body?.categories,
      limit,
    });

    return NextResponse.json({
      results: rows.map(rowToSearchResult),
      citations: rows.map(rowToCitation),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
