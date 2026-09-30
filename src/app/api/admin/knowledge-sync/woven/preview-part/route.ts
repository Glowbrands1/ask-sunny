import { NextResponse } from "next/server";

import { assertLiveMode, assertWithinRateLimit, errorResponse } from "@/lib/api/respond";
import { parseJsonBody } from "@/lib/api/validation";
import { authorizeRequest } from "@/lib/auth/server";
import { KnowledgeSyncStoreError } from "@/lib/knowledge-sync/store";
import { previewWovenPart } from "@/lib/knowledge-sync/woven/part-preview";

/**
 * POST /api/admin/knowledge-sync/woven/preview-part — `{ "ref": "<part ref>" }`.
 *
 * What Ask Sunny would read in one Woven item, before an audience choice or a
 * sync: the existing Ask Sunny document when it is already synced, otherwise
 * the text extracted in memory from a fresh read-only download. Nothing is
 * stored or indexed. `manage_integrations`.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  try {
    assertLiveMode();
    await authorizeRequest(request, "manage_integrations");
    assertWithinRateLimit(request, "mutate");
    const body = await parseJsonBody<{ ref?: unknown }>(request);
    const result = await previewWovenPart(typeof body.ref === "string" ? body.ref : "");
    const status = result.status === "ok" ? 200 : result.status === "not_found" ? 404 : result.status === "not_previewable" ? 422 : 502;
    return NextResponse.json(result, { status, headers: NO_STORE });
  } catch (error) {
    if (error instanceof KnowledgeSyncStoreError) {
      return NextResponse.json({ status: "failed", code: error.code, reason: error.message }, { status: 503, headers: NO_STORE });
    }
    return errorResponse(error, "admin/knowledge-sync/woven/preview-part");
  }
}
