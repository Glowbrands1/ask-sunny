import { NextResponse } from "next/server";

import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { requireScopeId } from "@/lib/api/validation";
import { authorizeRequest } from "@/lib/auth/server";
import { ACTIVE_BRAND } from "@/lib/brand";
import { SupabaseKnowledgeProvider } from "@/lib/knowledge/providers/supabase";

/**
 * GET /api/knowledge/documents?scope=<knowledgeScopeId>
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
    await authorizeRequest(request, "ask_questions");
    assertWithinRateLimit(request, "search");

    const scopeId = requireScopeId(
      new URL(request.url).searchParams.get("scope") ?? ACTIVE_BRAND.knowledgeScopeId,
    );

    const documents = await new SupabaseKnowledgeProvider().listDocuments(scopeId);
    return NextResponse.json({ documents });
  } catch (error) {
    return errorResponse(error, "GET /api/knowledge/documents");
  }
}
