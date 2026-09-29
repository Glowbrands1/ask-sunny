import { NextResponse } from "next/server";

import { assertLiveMode, assertNoConfigurationProblems, assertWithinRateLimit, errorResponse } from "@/lib/api/respond";
import { parseJsonBody } from "@/lib/api/validation";
import { authorizeRequest } from "@/lib/auth/server";
import { outcomeHttpStatus } from "@/lib/knowledge-sync/engine";
import { KnowledgeSyncStoreError } from "@/lib/knowledge-sync/store";
import { runWovenKnowledgeSync } from "@/lib/knowledge-sync/woven/sync";

/**
 * POST /api/admin/knowledge-sync/woven/run — "Run Initial Scan" and "Sync Now".
 *
 *   `{ "mode": "preview" }`  the initial scan / dry run: reads Woven, counts,
 *                            writes nothing but the run's own report.
 *   `{ "mode": "sync" }`     Sync Now: exactly the engine the monthly schedule
 *                            runs. The very first one is refused unless a
 *                            preview ran in the last seven days.
 *   `"confirmLargeRemoval": true` releases removals the mass-removal guard held.
 *
 * Anything but `"sync"` is a preview. The audit label comes from the verified
 * session, never from the body.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeRequest(request, "manage_integrations");
    assertWithinRateLimit(request, "mutate");

    const body = await parseJsonBody<{ mode?: unknown; confirmLargeRemoval?: unknown }>(request);
    const outcome = await runWovenKnowledgeSync({
      mode: body.mode === "sync" ? "sync" : "preview",
      trigger: "manual",
      requestedBy: `admin:${context.identity.email || context.identity.subject}`.slice(0, 120),
      confirmLargeRemoval: body.confirmLargeRemoval === true,
    });
    const status =
      outcome.status === "disabled" ? 200 : outcome.status === "not_configured" ? 503 : outcomeHttpStatus(outcome);
    return NextResponse.json(outcome, { status, headers: NO_STORE });
  } catch (error) {
    if (error instanceof KnowledgeSyncStoreError) {
      return NextResponse.json({ status: "failed", code: error.code, reason: error.message }, { status: 503, headers: NO_STORE });
    }
    return errorResponse(error, "admin/knowledge-sync/woven/run");
  }
}
