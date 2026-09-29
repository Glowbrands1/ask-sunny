import { NextResponse } from "next/server";

import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { authorizeRequest } from "@/lib/auth/server";
import { readWovenConfig, WOVEN_VALIDATION_ENABLED_ENV } from "@/lib/employees/woven/config";
import { listSalonsForComparison } from "@/lib/employees/woven/locations";
import { runWovenLiveValidation, type SalonComparisonInput } from "@/lib/employees/woven/validate";
import { DEFAULT_PERMISSION_MATRIX, hasPermission } from "@/lib/permissions";

/**
 * POST /api/admin/employees/woven/validate — the READ-ONLY live check of the
 * Woven Operations API against `contract.ts`: "Test Woven connection".
 *
 * The token exchange and GETs only. Writes nothing to Woven and nothing to
 * Supabase, takes no run lock, and works before the directory migration
 * exists. The response is aggregates, enum labels and key names only (see
 * `src/lib/employees/woven/validate.ts`) — no employee record, name, email or
 * id, and no credential.
 *
 * ITS OWN SWITCH. It needs `WOVEN_VALIDATION_ENABLED`, NOT `WOVEN_SYNC_ENABLED`,
 * so the first live connection test runs while every sync path is closed.
 * Nothing here calls the sync.
 *
 * SALON COVERAGE. The existing `salons` table is read (SELECT only) and
 * compared with Woven's `/locations` by exact number. Every caller gets the
 * counts; the location numbers and names behind them go only to a caller who
 * also holds `manage_users`. They are locations, never employees.
 *
 * `manage_integrations`; refused in demo mode, where identity is a
 * presentation role switcher and could not be trusted to guard a call that
 * reaches an external system.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE = { "Cache-Control": "no-store" };

async function salonsToCompare(): Promise<SalonComparisonInput> {
  try {
    return { outcome: "loaded", salons: await listSalonsForComparison() };
  } catch {
    /* The comparison is reported as unavailable; the Woven checks still run. */
    return { outcome: "unavailable", salons: [] };
  }
}

export async function POST(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeRequest(request, "manage_integrations");
    assertWithinRateLimit(request, "mutate");

    const config = readWovenConfig();
    if (!config.validationEnabled) {
      return NextResponse.json(
        { status: "disabled", reason: `${WOVEN_VALIDATION_ENABLED_ENV} is not on, so the read-only check does not reach Woven.` },
        { status: 409, headers: NO_STORE },
      );
    }
    if (!config.credentials) {
      return NextResponse.json(
        { status: "not_configured", missing: config.missingCredentials },
        { status: 503, headers: NO_STORE },
      );
    }

    const report = await runWovenLiveValidation({
      config,
      salons: await salonsToCompare(),
      includeLocationReview: hasPermission(DEFAULT_PERMISSION_MATRIX, context.identity.role, "manage_users"),
    });
    return NextResponse.json({ status: "ok", report }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error, "admin/employees/woven/validate");
  }
}
