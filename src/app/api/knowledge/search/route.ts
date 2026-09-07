import { NextResponse } from "next/server";

import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import {
  LIMITS,
  boundedInt,
  parseJsonBody,
  requireString,
} from "@/lib/api/validation";
import { authorizeRequest } from "@/lib/auth/server";
import { activeKnowledgeCorpus } from "@/lib/knowledge/corpus";
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
    await authorizeRequest(request, "ask_questions");
    assertWithinRateLimit(request, "search");

    const body = await parseJsonBody<KnowledgeQuery>(request);

    const rows = await new SupabaseKnowledgeProvider().match({
      query: requireString(body.query, "A search query", LIMITS.searchQuery),
      /*
       * THE CORPUS IS NOT A SEARCH PARAMETER. Query, category and limit are the
       * caller's; which company's knowledge is searched is not. This route
       * returns document text, so a caller-chosen corpus here is a
       * confidentiality boundary rather than a listing one.
       */
      scopeId: activeKnowledgeCorpus(),
      categories: body.categories,
      limit: boundedInt(body.limit, {
        min: 1,
        max: RETRIEVAL.topK * 2,
        fallback: RETRIEVAL.topK,
      }),
    });

    return NextResponse.json({
      results: rows.map(rowToSearchResult),
      citations: rows.map(rowToCitation),
    });
  } catch (error) {
    return errorResponse(error, "POST /api/knowledge/search");
  }
}
