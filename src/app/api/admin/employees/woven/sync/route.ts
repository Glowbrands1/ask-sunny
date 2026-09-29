import { NextResponse } from "next/server";

import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { parseJsonBody } from "@/lib/api/validation";
import { authorizeRequest } from "@/lib/auth/server";
import { readWovenSyncStatus, WovenStatusError } from "@/lib/employees/woven/status";
import { EmployeeStoreError } from "@/lib/employees/woven/store";
import { outcomeHttpStatus, runWovenEmployeeSync } from "@/lib/employees/woven/sync";

/**
 * /api/admin/employees/woven/sync — the MANUAL Woven employee sync, and its status.
 *
 * POST runs a sync now. It is a DRY RUN UNLESS THE BODY SAYS OTHERWISE:
 * `{}` or `{"dryRun": true}` reads Woven, normalises and compares, and writes
 * nothing — the first thing to do once Woven approves the subscription.
 * Only `{"dryRun": false}` asks to save, and a save ALSO needs
 * `WOVEN_SYNC_WRITES_ENABLED`: while it is off the request is refused with
 * 409 `writes_disabled` inside `runWovenEmployeeSync`, before the store is
 * opened or Woven is called, so nothing is written.
 *
 * GET reports whether the sync is switched on, which variables are missing (by
 * name), the last successful sync and recent runs' codes and counts.
 *
 * `manage_integrations` — admin, owner and developer — the same gate as the
 * Google review sync's manual controls. The audit label is taken from the
 * verified session, never from the body.
 *
 * Neither method returns a name or an email: a dry run's result is counts,
 * field coverage and issue codes, which is what validating the live API needs.
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

    const body = await parseJsonBody<{ dryRun?: unknown }>(request);
    /* Anything but an explicit `false` is a dry run. */
    const dryRun = body.dryRun !== false;

    const outcome = await runWovenEmployeeSync({
      requestedBy: `admin:${context.identity.email || context.identity.subject}`.slice(0, 120),
      dryRun,
    });
    return NextResponse.json(outcome, { status: outcomeHttpStatus(outcome), headers: NO_STORE });
  } catch (error) {
    if (error instanceof EmployeeStoreError) {
      return NextResponse.json(
        { status: "failed", code: error.code, reason: error.message },
        { status: 503, headers: NO_STORE },
      );
    }
    return errorResponse(error, "admin/employees/woven/sync");
  }
}

export async function GET(request: Request) {
  try {
    assertLiveMode();
    await authorizeRequest(request, "manage_integrations");
    return NextResponse.json({ status: "ok", sync: await readWovenSyncStatus() }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof WovenStatusError) {
      return NextResponse.json(
        { status: "failed", code: error.reason === "missing" ? "directory_not_created" : "store_unavailable", reason: error.message },
        { status: 503, headers: NO_STORE },
      );
    }
    if (error instanceof EmployeeStoreError) {
      return NextResponse.json(
        { status: "failed", code: error.code, reason: error.message },
        { status: 503, headers: NO_STORE },
      );
    }
    return errorResponse(error, "admin/employees/woven/sync");
  }
}
