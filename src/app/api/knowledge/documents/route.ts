import { NextResponse } from "next/server";

import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { activeKnowledgeCorpus } from "@/lib/knowledge/corpus";
import { authorizeRequest } from "@/lib/auth/server";
import { SupabaseKnowledgeProvider } from "@/lib/knowledge/providers/supabase";

/**
 * GET /api/knowledge/documents
 *
 * The library listing in live mode. Returns KnowledgeDocument objects — the
 * same shape the Knowledge Base screen already renders — so the UI is unchanged
 * between modes.
 *
 * Storage paths are deliberately NOT included in the response: `rowToDocument`
 * drops the column. A browser cannot name an object path, which is what keeps
 * arbitrary storage access impossible even before authentication ships.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    /*
     * `view_knowledge`, MATCHING THE PAGE THIS SERVES. The Knowledge Base page
     * requires `view_knowledge`; this route backed it while asking only for
     * `ask_questions`. Every role holds both today, so no access changes — but
     * the route now states the permission it actually implements rather than a
     * weaker neighbour.
     */
    await authorizeRequest(request, "view_knowledge");
    assertWithinRateLimit(request, "search");

    /*
     * SERVER-DERIVED. A corpus on the request is not read — see
     * `activeKnowledgeCorpus` for why a valid scope id is not an authorized one.
     */
    const scopeId = activeKnowledgeCorpus();

    const documents = await new SupabaseKnowledgeProvider().listDocuments(scopeId);
    return NextResponse.json({ documents });
  } catch (error) {
    return errorResponse(error, "GET /api/knowledge/documents");
  }
}
