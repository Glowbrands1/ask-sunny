import { NextResponse } from "next/server";

import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { activeKnowledgeCorpus } from "@/lib/knowledge/corpus";
import { authorizeAdminConsoleRequest } from "@/lib/auth/server";
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
     * THE INVENTORY, SO ADMINISTRATORS ONLY — still matching the page this
     * serves, which is now `requireAdminConsolePage("view_knowledge")`.
     *
     * `view_knowledge` alone was not enough, and hiding the screen would not
     * have been either: this route answers "what documents does this company
     * hold" in one call, with every title, description, category, size,
     * uploader and processing state. A Regional Manager holding `view_knowledge`
     * could fetch the whole library from the address bar while the rail said
     * nothing about it.
     *
     * READING ONE CITED DOCUMENT IS NOT THIS. `GET /api/knowledge/documents/[id]`
     * and the original-file route still ask for `view_knowledge` alone, so a
     * citation stays openable for every role Sunny answers for.
     */
    await authorizeAdminConsoleRequest(request, "view_knowledge");
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
