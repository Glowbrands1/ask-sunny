import { NextResponse } from "next/server";

import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { authorizeRequest } from "@/lib/auth/server";
import { readWovenConfig, WOVEN_SYNC_ENABLED_ENV } from "@/lib/employees/woven/config";
import { runWovenLiveValidation } from "@/lib/employees/woven/validate";

/**
 * POST /api/admin/employees/woven/validate — the READ-ONLY live check of the
 * Woven Operations API against `contract.ts`.
 *
 * The token exchange and GETs only. Writes nothing to Woven and nothing to
 * Supabase, takes no run lock, and works before the directory migration
 * exists. The response is aggregates and key names only (see
 * `src/lib/employees/woven/validate.ts`) — no employee record, no id, no
 * credential.
 *
 * `manage_integrations`; refused in demo mode, where identity is a
 * presentation role switcher and could not be trusted to guard a call that
 * reaches an external system. Behind the same master switch as the sync.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    await authorizeRequest(request, "manage_integrations");
    assertWithinRateLimit(request, "mutate");

    const config = readWovenConfig();
    if (!config.enabled) {
      return NextResponse.json(
        { status: "disabled", reason: `${WOVEN_SYNC_ENABLED_ENV} is not on, so nothing reaches Woven.` },
        { status: 409, headers: NO_STORE },
      );
    }
    if (!config.credentials) {
      return NextResponse.json(
        { status: "not_configured", missing: config.missingCredentials },
        { status: 503, headers: NO_STORE },
      );
    }

    const report = await runWovenLiveValidation({ config });
    return NextResponse.json({ status: "ok", report }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error, "admin/employees/woven/validate");
  }
}
