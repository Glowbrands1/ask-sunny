import { NextResponse } from "next/server";

import { assertLiveMode, assertNoConfigurationProblems, assertWithinRateLimit, errorResponse } from "@/lib/api/respond";
import { parseJsonBody } from "@/lib/api/validation";
import { authorizeRequest } from "@/lib/auth/server";
import { createSupabaseKnowledgeSyncStore, KnowledgeSyncStoreError } from "@/lib/knowledge-sync/store";
import { readWovenKnowledgeStatus } from "@/lib/knowledge-sync/woven/status";

/**
 * PUT /api/admin/knowledge-sync/woven/audiences — an administrator's answer to
 * "Woven shares these items with only some teams. Who should see them in Ask
 * Sunny?"
 *
 *   `{ "audienceKey": "managers", "decision": "company_wide" }`  share with everyone in Ask Sunny
 *   `{ "audienceKey": "managers", "decision": "excluded" }`      keep out of Ask Sunny
 *   `{ "audienceKey": "managers", "decision": null }`            undo; held for review again
 *
 * Decided once per audience, not per item. It takes effect on the next sync —
 * the decision alone ingests nothing, so it can be made without waiting.
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

    const body = await parseJsonBody<{ audienceKey?: unknown; decision?: unknown }>(request);
    const audienceKey = typeof body.audienceKey === "string" ? body.audienceKey.trim() : "";
    const decision = body.decision;
    if (!audienceKey || audienceKey.length > 500 || !(decision === null || decision === "company_wide" || decision === "excluded")) {
      return NextResponse.json({ status: "invalid", reason: "Send an audienceKey and a decision of company_wide, excluded or null." }, { status: 400, headers: NO_STORE });
    }

    const store = createSupabaseKnowledgeSyncStore();
    if (decision === null) {
      await store.removeDecision("woven", audienceKey);
    } else {
      await store.saveDecision({
        source: "woven",
        audienceKey,
        decision,
        decidedBy: `admin:${context.identity.email || context.identity.subject}`.slice(0, 120),
        decidedAt: new Date().toISOString(),
      });
    }
    return NextResponse.json({ status: "ok", sync: await readWovenKnowledgeStatus({ store }) }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof KnowledgeSyncStoreError) {
      return NextResponse.json({ status: "failed", code: error.code, reason: error.message }, { status: 503, headers: NO_STORE });
    }
    return errorResponse(error, "admin/knowledge-sync/woven/audiences");
  }
}
