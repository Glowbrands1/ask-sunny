import { NextResponse } from "next/server";

import { assertLiveMode, assertNoConfigurationProblems, assertWithinRateLimit, errorResponse } from "@/lib/api/respond";
import { parseJsonBody } from "@/lib/api/validation";
import { authorizeRequest } from "@/lib/auth/server";
import { wovenDocumentKeepOutEnabled } from "@/lib/config/chat-quality-flags";
import { keepOutKey, partRef } from "@/lib/knowledge-sync/inventory";
import { createSupabaseKnowledgeSyncStore, KnowledgeSyncStoreError } from "@/lib/knowledge-sync/store";
import { readWovenKnowledgeStatus } from "@/lib/knowledge-sync/woven/status";

/**
 * PUT /api/admin/knowledge-sync/woven/documents — an administrator keeps ONE Woven document out of Ask Sunny, or undoes
 * that (WOVEN_DOCUMENT_KEEP_OUT_ENABLED; QA, 10 Nov 2026).
 *
 *   `{ "ref": "<the part's ref from the Content view>", "keepOut": true }`   keep out of Ask Sunny
 *   `{ "ref": "...", "keepOut": false }`                                      undo
 *
 * Stored beside the audience decisions (`document:<ref>`, decision "excluded"). It takes effect on the next sync, which
 * retires the document if it is live and never ingests it again while the choice stands. The ref must name a part the
 * sync knows; nothing else can be stored.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function PUT(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeRequest(request, "manage_integrations");
    assertWithinRateLimit(request, "mutate");
    if (!wovenDocumentKeepOutEnabled()) {
      return NextResponse.json({ status: "disabled", reason: "Keeping one document out is not switched on." }, { status: 404, headers: NO_STORE });
    }

    const body = await parseJsonBody<{ ref?: unknown; keepOut?: unknown }>(request);
    const ref = typeof body.ref === "string" ? body.ref.trim() : "";
    if (!/^[0-9a-f]{16}$/.test(ref) || typeof body.keepOut !== "boolean") {
      return NextResponse.json({ status: "invalid", reason: "Send a document ref and keepOut true or false." }, { status: 400, headers: NO_STORE });
    }

    const store = createSupabaseKnowledgeSyncStore();
    const item = (await store.loadManifest("woven")).find((entry) => partRef(entry) === ref);
    if (!item) {
      return NextResponse.json({ status: "not_found", reason: "No Woven document has that reference." }, { status: 404, headers: NO_STORE });
    }
    if (body.keepOut) {
      await store.saveDecision({
        source: "woven",
        audienceKey: keepOutKey(item),
        decision: "excluded",
        decidedBy: `admin:${context.identity.email || context.identity.subject}`.slice(0, 120),
        decidedAt: new Date().toISOString(),
      });
    } else {
      await store.removeDecision("woven", keepOutKey(item));
    }
    return NextResponse.json({ status: "ok", sync: await readWovenKnowledgeStatus({ store }) }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof KnowledgeSyncStoreError) {
      return NextResponse.json({ status: "failed", code: error.code, reason: error.message }, { status: 503, headers: NO_STORE });
    }
    return errorResponse(error, "admin/knowledge-sync/woven/documents");
  }
}
