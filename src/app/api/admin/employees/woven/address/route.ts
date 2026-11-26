import { NextResponse } from "next/server";

import { assertLiveMode, errorResponse } from "@/lib/api/respond";
import { loadDirectoryRows } from "@/lib/employees/woven/directory";
import { authorizeWovenPeopleRequest, NO_STORE, wovenStoreFailureResponse } from "@/lib/employees/woven/route-auth";
import { wovenAddressForEmployee } from "@/lib/forms/exit-woven-address";

/**
 * GET /api/admin/employees/woven/address?id=<directory row id> — one employee's home address, read live from Woven
 * for the Employee Directory's "Show address" (Pau, 26 Nov 2026).
 *
 * The same people as the directory itself (`manage_users` AND `manage_integrations`). Only an id the directory
 * holds is looked up, so this cannot be pointed at an arbitrary Woven id. The address goes back in this response
 * only: never stored, never logged, never cached.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertLiveMode();
    await authorizeWovenPeopleRequest(request);
    const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
    if (!id) return NextResponse.json({ status: "failed", reason: "Which employee?" }, { status: 400, headers: NO_STORE });
    const row = (await loadDirectoryRows()).find((entry) => entry.id === id);
    if (!row) return NextResponse.json({ status: "failed", reason: "That employee is not in the directory." }, { status: 404, headers: NO_STORE });
    const result = await wovenAddressForEmployee(row.externalEmployeeId);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return wovenStoreFailureResponse(error) ?? errorResponse(error, "admin/employees/woven/address");
  }
}
