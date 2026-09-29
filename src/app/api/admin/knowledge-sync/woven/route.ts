import { NextResponse } from "next/server";

import { assertLiveMode, assertNoConfigurationProblems, assertWithinRateLimit, errorResponse } from "@/lib/api/respond";
import { parseJsonBody } from "@/lib/api/validation";
import { authorizeRequest } from "@/lib/auth/server";
import { createSupabaseKnowledgeSyncStore, KnowledgeSyncStoreError } from "@/lib/knowledge-sync/store";
import { readWovenKnowledgeStatus } from "@/lib/knowledge-sync/woven/status";

/**
 * /api/admin/knowledge-sync/woven — the Woven Knowledge Sync's status and its
 * one setting an administrator controls.
 *
 * GET   the screen's status: headline state, counts, what needs attention.
 * PATCH `{ "autoSyncEnabled": true | false }` — "Enable Automatic Sync". Refused
 *       until the initial sync has completed, so the schedule can never be the
 *       thing that performs the first bulk ingestion.
 *
 * `manage_integrations`, like every integration screen. No response carries a
 * credential, a cookie, a URL or a Woven response body.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  try {
    assertLiveMode();
    await authorizeRequest(request, "manage_integrations");
    return NextResponse.json({ status: "ok", sync: await readWovenKnowledgeStatus() }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error, "admin/knowledge-sync/woven");
  }
}

export async function PATCH(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    await authorizeRequest(request, "manage_integrations");
    assertWithinRateLimit(request, "mutate");

    const body = await parseJsonBody<{ autoSyncEnabled?: unknown }>(request);
    if (typeof body.autoSyncEnabled !== "boolean") {
      return NextResponse.json({ status: "invalid", reason: "Send autoSyncEnabled as true or false." }, { status: 400, headers: NO_STORE });
    }

    const store = createSupabaseKnowledgeSyncStore();
    const settings = await store.loadSettings("woven");
    if (body.autoSyncEnabled && !settings.initialSyncCompletedAt) {
      return NextResponse.json(
        { status: "refused", code: "initial_sync_not_done", reason: "Run the initial sync before turning on automatic sync." },
        { status: 409, headers: NO_STORE },
      );
    }
    await store.saveSettings({ ...settings, autoSyncEnabled: body.autoSyncEnabled });
    return NextResponse.json({ status: "ok", sync: await readWovenKnowledgeStatus({ store }) }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof KnowledgeSyncStoreError) {
      return NextResponse.json({ status: "failed", code: error.code, reason: error.message }, { status: 503, headers: NO_STORE });
    }
    return errorResponse(error, "admin/knowledge-sync/woven");
  }
}
