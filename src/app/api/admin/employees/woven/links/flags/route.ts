import { NextResponse } from "next/server";

import { DirectoryError } from "@/lib/admin/user-directory";
import { parseManagedFlagsRequest, setManagedFlags } from "@/lib/admin/woven-managed-flags";
import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { parseJsonBody } from "@/lib/api/validation";
import { authorizeWovenPeopleRequest, NO_STORE } from "@/lib/employees/woven/route-auth";

/**
 * POST /api/admin/employees/woven/links/flags — what Woven may manage for
 * linked accounts (adoption).
 *
 *   { "accounts": [ { "appUserId": "…", "managedStatus": true, "managedLocation": true, "managedRole": true }, … ] }
 *
 * Up to 50 accounts per request, each decided on its own: one refused account
 * never blocks the others, and the response says what happened to each.
 *
 * `manage_users` AND `manage_integrations`, live mode only, rate-limited. The
 * actor comes from the session. The owner's policy is enforced on the server
 * for every account (`managed-policy.ts`); a flag it does not allow is refused.
 * Writes only the three managed flags; changes nobody's access by itself.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ACCOUNTS = 50;

export async function POST(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeWovenPeopleRequest(request);
    assertWithinRateLimit(request, "mutate");

    const body = await parseJsonBody<Record<string, unknown>>(request);
    const accounts = Array.isArray(body?.accounts) ? body.accounts : null;
    if (!accounts || accounts.length === 0 || accounts.length > MAX_ACCOUNTS) {
      return NextResponse.json(
        { status: "invalid_input", reason: `Send between 1 and ${MAX_ACCOUNTS} accounts.` },
        { status: 400, headers: NO_STORE },
      );
    }

    const actor = { id: context.identity.subject, email: context.identity.email, role: context.identity.role };
    const results = [];
    for (const entry of accounts) {
      try {
        const result = await setManagedFlags(parseManagedFlagsRequest(entry), actor);
        results.push({ appUserId: result.appUserId, status: result.changed ? "changed" : "unchanged", after: result.after });
      } catch (error) {
        if (!(error instanceof DirectoryError)) throw error;
        const appUserId = typeof (entry as { appUserId?: unknown })?.appUserId === "string" ? (entry as { appUserId: string }).appUserId : null;
        results.push({ appUserId, status: "refused", code: error.code, reason: error.message });
      }
    }
    return NextResponse.json({ results }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error, "admin/employees/woven/links/flags");
  }
}
