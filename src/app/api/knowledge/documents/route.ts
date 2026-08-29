import { NextResponse } from "next/server";

import { AiError } from "@/lib/ai/errors";
import { assertLiveMode, errorResponse } from "@/lib/api/respond";
import { ACTIVE_BRAND } from "@/lib/brand";
import { SupabaseKnowledgeProvider } from "@/lib/knowledge/providers/supabase";

/**
 * GET /api/knowledge/documents?scope=<knowledgeScopeId>
 *
 * The library listing in live mode. Returns KnowledgeDocument objects — the
 * same shape the Knowledge Base screen already renders — so the UI is unchanged
 * between modes.
 *
 * Storage paths are deliberately NOT included in the response. A browser cannot
 * name an object path, which is what keeps arbitrary storage access impossible
 * even before authentication ships.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertLiveMode();

    const scope =
      new URL(request.url).searchParams.get("scope") ?? ACTIVE_BRAND.knowledgeScopeId;

    if (!/^[a-z0-9-]{1,64}$/i.test(scope)) {
      throw new AiError("bad_request", "A valid knowledge scope is required.", 400);
    }

    const documents = await new SupabaseKnowledgeProvider().listDocuments(scope);
    return NextResponse.json({ documents });
  } catch (error) {
    return errorResponse(error);
  }
}
