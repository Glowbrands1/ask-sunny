import { NextResponse } from "next/server";

import { assertLiveMode, assertNoConfigurationProblems } from "@/lib/api/respond";
import { defaultLandingForRole } from "@/lib/auth/page";
import { getAppUser } from "@/lib/auth/app-user";
import { isRole } from "@/lib/admin/user-directory";
import { getSupabaseSessionClient } from "@/lib/supabase/auth-clients";

/**
 * ============================================================================
 * POST /api/auth/accept-invitation — invited becomes active.
 * ============================================================================
 *
 * THE ONE ROUTE IN ASK SUNNY THAT DOES NOT CALL `authorizeRequest`, and the
 * reason is structural rather than an exemption. `authorizeRequest` resolves
 * the caller's profile and refuses an INVITED one — correctly, because a
 * credential that has never been used is not yet a user of this application.
 * The person this route exists for is precisely the person it would refuse.
 *
 * So authorization moves to the database. `public.accept_invitation()` takes
 * NO ARGUMENTS: its subject is `auth.uid()` from the JWT PostgREST verified, so
 * there is no id, role, status or email a caller could supply, and this route
 * reads NOTHING from the request body. It does not parse one.
 *
 * What the function enforces, and what this route therefore cannot get wrong:
 *
 *   - a real session, or it raises;
 *   - the caller's OWN row and no other;
 *   - `invited` -> `active` only, so a disabled account cannot re-enable
 *     itself and an active one cannot disable itself;
 *   - a confirmed email address, which is what ties the change to "they
 *     followed a real invitation link" rather than "they hold a token";
 *   - status only — role, scope and email are not in the UPDATE statement at
 *     all, so no call of any shape can alter them;
 *   - idempotent, writing no second audit row for a repeat.
 *
 * The session client is used rather than the privileged one. That is what makes
 * `auth.uid()` mean anything: the admin client acts as `service_role`, for
 * which `auth.uid()` is null and the function would refuse — and if it somehow
 * did not, it would be activating whoever the caller named rather than whoever
 * the caller IS.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();

    const supabase = await getSupabaseSessionClient();

    /*
     * The session is checked here as well, so an unauthenticated caller gets a
     * 401 rather than a database error surfaced as a 500. The function refuses
     * independently — this only chooses a better status code.
     */
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth?.user) {
      return NextResponse.json(
        { error: "You are not signed in.", code: "unauthenticated" },
        { status: 401 },
      );
    }

    const { error } = await supabase.rpc("accept_invitation");

    if (error) {
      /*
       * Every refusal the function raises is a sentence written for a person —
       * "This account is disabled", "No Ask Sunny profile exists for this
       * account" — so they are safe to pass on and are the only thing somebody
       * can act on. A message we did not write is not returned.
       */
      const known = [
        "Not signed in.",
        "No Ask Sunny profile exists for this account.",
        "This account is disabled.",
        "This account has not confirmed its email address.",
      ];
      const message = known.find((candidate) => error.message.includes(candidate));

      return NextResponse.json(
        {
          error:
            message ??
            "Your account could not be activated. Ask an administrator to check it.",
          code: "activation_refused",
        },
        { status: 403 },
      );
    }

    /*
     * WHERE TO SEND THEM, decided on the server from the now-active profile.
     *
     * The alternative is navigating to `/` and letting the page guard bounce
     * anybody without `view_overview` — which works, but greets a new Employee
     * with a "denied" notice as the first thing they ever see in Ask Sunny.
     *
     * Only a PATH crosses back, never the role.
     */
    const profile = await getAppUser(supabase, auth.user.id);
    const landing =
      profile.ok && isRole(profile.profile.role)
        ? defaultLandingForRole(profile.profile.role)
        : "/";

    return NextResponse.json({ activated: true, landing });
  } catch {
    /*
     * Deliberately generic and deliberately not `errorResponse`. This route
     * runs for somebody with no profile the application will vouch for, and an
     * unexpected error's message can carry request content.
     */
    return NextResponse.json(
      { error: "Your account could not be activated right now.", code: "internal" },
      { status: 500 },
    );
  }
}
