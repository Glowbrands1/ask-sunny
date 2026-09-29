import { NextResponse } from "next/server";

import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { authorizeRequest } from "@/lib/auth/server";
import type { AuthorizedContext } from "@/lib/auth/types";
import { isDemoMode, isProductionDeployment } from "@/lib/config/runtime";
import {
  readWovenConfig,
  WOVEN_SYNC_ENABLED_ENV,
  WOVEN_VALIDATION_ENABLED_ENV,
  type WovenConfig,
} from "@/lib/employees/woven/config";
import { listSalonsForComparison } from "@/lib/employees/woven/locations";
import { runWovenLiveValidation, type SalonComparisonInput } from "@/lib/employees/woven/validate";
import {
  checkValidationAccessCode,
  MIN_ACCESS_CODE_LENGTH,
  WOVEN_VALIDATION_ACCESS_CODE_ENV,
} from "@/lib/employees/woven/validation-access";
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
 * `manage_integrations`.
 *
 * DEMO MODE: ONE NARROW EXCEPTION, BEHIND AN ACCESS CODE. On a demo-mode
 * deployment identity is the role switcher — anybody can claim a role with a
 * header — and the Preview is public, so a role check guards nothing there.
 * This route alone may still run there, and only when ALL of these hold:
 *
 *   - the deployment is not Vercel Production;
 *   - WOVEN_VALIDATION_ENABLED is on and WOVEN_SYNC_ENABLED is off;
 *   - the request body carries the code set in WOVEN_VALIDATION_ACCESS_CODE,
 *     compared server-side in constant time (`validation-access.ts`).
 *
 * It opens nothing else: the app stays in demo mode, authentication is
 * untouched, and the sync and cron routes still refuse demo mode outright.
 * The code is never logged, returned or echoed in an error. A LIVE deployment
 * takes the original path below and never reads the code.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE = { "Cache-Control": "no-store" };

const refuse = (body: Record<string, unknown>, status: number) => NextResponse.json(body, { status, headers: NO_STORE });

/** The largest access code read from a body; anything longer is simply wrong. */
const MAX_PRESENTED_CODE = 512;

async function presentedAccessCode(request: Request): Promise<string | null> {
  const body = (await request.json().catch(() => null)) as { accessCode?: unknown } | null;
  const code = body && typeof body === "object" ? body.accessCode : undefined;
  return typeof code === "string" && code.length <= MAX_PRESENTED_CODE ? code : null;
}

/**
 * The demo-mode gate. Returns the authorized context, or the refusal to send.
 * Every refusal is generic about the code: it says whether one is needed or
 * set, never anything about its value.
 */
async function admitInDemoMode(
  request: Request,
  config: WovenConfig,
): Promise<{ context: AuthorizedContext } | { refusal: NextResponse }> {
  if (isProductionDeployment()) {
    /* The demo-in-production escape hatch never opens this. */
    assertLiveMode();
  }
  if (!config.validationEnabled || config.enabled) {
    return {
      refusal: refuse(
        {
          status: "disabled",
          reason: `Ask Sunny is running in demo mode. The Woven connection test runs here only with ${WOVEN_VALIDATION_ENABLED_ENV} on and ${WOVEN_SYNC_ENABLED_ENV} off.`,
        },
        409,
      ),
    };
  }
  assertNoConfigurationProblems();
  /* Before the code is compared, so it cannot be guessed at speed. */
  assertWithinRateLimit(request, "mutate");
  const context = await authorizeRequest(request, "manage_integrations");

  switch (checkValidationAccessCode(await presentedAccessCode(request))) {
    case "ok":
      return { context };
    case "not_configured":
      return {
        refusal: refuse(
          {
            status: "not_configured",
            missing: [WOVEN_VALIDATION_ACCESS_CODE_ENV],
            reason: `In demo mode the Woven connection test needs ${WOVEN_VALIDATION_ACCESS_CODE_ENV} (at least ${MIN_ACCESS_CODE_LENGTH} characters) set for this deployment.`,
          },
          503,
        ),
      };
    default:
      return { refusal: refuse({ status: "refused", reason: "The access code is missing or incorrect." }, 403) };
  }
}

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
    const config = readWovenConfig();
    let context: AuthorizedContext;

    if (isDemoMode()) {
      const admitted = await admitInDemoMode(request, config);
      if ("refusal" in admitted) return admitted.refusal;
      context = admitted.context;
    } else {
      /* Live mode: unchanged. The access code is not read. */
      assertLiveMode();
      assertNoConfigurationProblems();
      context = await authorizeRequest(request, "manage_integrations");
      assertWithinRateLimit(request, "mutate");
    }

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
