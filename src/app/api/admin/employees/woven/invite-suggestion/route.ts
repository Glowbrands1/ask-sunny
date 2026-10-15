import { NextResponse } from "next/server";

import { assertLiveMode, errorResponse } from "@/lib/api/respond";
import { loadDirectoryRows } from "@/lib/employees/woven/directory";
import { suggestionForEmail } from "@/lib/employees/woven/invite-suggestion";
import { listWovenLocations } from "@/lib/employees/woven/locations";
import { listWovenPositions } from "@/lib/employees/woven/positions";
import { authorizeWovenPeopleRequest, NO_STORE, wovenStoreFailureResponse } from "@/lib/employees/woven/route-auth";

/**
 * GET /api/admin/employees/woven/invite-suggestion?email=… — what Woven can
 * suggest for an invitation to this address.
 *
 * A SUGGESTION ONLY. It changes nothing and grants nothing: the invitation form
 * shows it, an administrator chooses to apply it, and the invitation itself is
 * validated by `POST /api/admin/users` as if it had been typed by hand.
 *
 * Returns a name and position, so `manage_users` AND `manage_integrations`,
 * like every other Woven route that returns people. The address is read from
 * the query only to look it up; it is not stored or logged.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertLiveMode();
    await authorizeWovenPeopleRequest(request);

    const email = new URL(request.url).searchParams.get("email");
    if (!email || email.length > 254) {
      return NextResponse.json({ status: "invalid", reason: "An email address is required." }, { status: 400, headers: NO_STORE });
    }

    const [directory, positions, locations] = await Promise.all([
      loadDirectoryRows(),
      listWovenPositions(),
      listWovenLocations(),
    ]);
    return NextResponse.json(suggestionForEmail(email, directory, positions, locations), { headers: NO_STORE });
  } catch (error) {
    return wovenStoreFailureResponse(error) ?? errorResponse(error, "admin/employees/woven/invite-suggestion");
  }
}
