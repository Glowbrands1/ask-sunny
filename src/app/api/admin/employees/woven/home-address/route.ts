import { NextResponse } from "next/server";

import { assertLiveMode, errorResponse } from "@/lib/api/respond";
import { AuthError } from "@/lib/auth/types";
import { mayLookUpHomeAddress } from "@/lib/employees/woven/home-address-access";
import { lookUpWovenHomeAddress } from "@/lib/employees/woven/home-address-lookup";
import { authorizeWovenPeopleRequest, NO_STORE } from "@/lib/employees/woven/route-auth";

/**
 * GET /api/admin/employees/woven/home-address?id=<directory row id> — one employee's home address, read live from
 * Woven for the Employee Directory's "Show home address" (Pau, 26 Nov 2026, approved by Curt).
 *
 * `manage_integrations` AND `manage_users`, like every Woven people route, AND an admin console role
 * (`home-address-access.ts`). Read-only; the address is returned to the caller and stored nowhere.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  try {
    assertLiveMode();
    const context = await authorizeWovenPeopleRequest(request);
    if (!mayLookUpHomeAddress(context.identity.role)) {
      throw new AuthError("forbidden", "Only administrators can look up a home address.");
    }
    const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
    if (!UUID.test(id)) {
      return NextResponse.json({ status: "failed", reason: "An employee id is required." }, { status: 400, headers: NO_STORE });
    }
    const result = await lookUpWovenHomeAddress(id);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error, "admin/employees/woven/home-address");
  }
}
