import "server-only";

import { canAccessAdminConsole } from "@/lib/permissions";
import { pageAuthorizationEnforced, pageIdentity } from "./page";

/**
 * Supabase Auth user ids (`auth.users.id` = `app_users.id`, Ask Sunny project)
 * of people who are offered the switcher without being administrators: one
 * District Manager and one Regional Manager, by owner approval. Ids only — the
 * people are not named in this repository.
 */
export const APP_SWITCHER_USER_IDS: readonly string[] = [
  "03a11228-ac36-4d2d-908d-ff2e171b866a", // a District Manager
  "e66addda-5d3d-4afc-b24d-064c6409e83b", // a Regional Manager
];

/**
 * WHETHER THIS RENDER OFFERS THE APP SWITCHER — administrators only.
 *
 * Decided here, on the server, from the VERIFIED identity: the role comes from
 * the auth provider and this app's own profile record, never from the browser.
 * "Administrator" is this app's existing answer, `canAccessAdminConsole`, so no
 * role is added and an administrator of Ask Bubbles is not thereby one here.
 *
 * It fails closed. Demo mode has no verified identity (its role is the
 * presenter's switcher), so the switcher is never shown there; an unverified or
 * missing identity, or any error, also answers false. A non-administrator's
 * page therefore never contains the switcher at all.
 *
 * ONE NAMED EXCEPTION. Two non-administrators are offered the switcher too, by
 * stable Supabase user id (`APP_SWITCHER_USER_IDS`), never by email or role. It
 * changes their VISIBILITY of a link only: their role, scope and permissions —
 * and so their Admin Console access — are untouched.
 *
 * IT IS NOT A BOUNDARY. The switcher is a link to the other app's public login;
 * that app's own sign-in and permissions decide what happens on arrival.
 */
export async function pageShowsAppSwitcher(): Promise<boolean> {
  try {
    if (!pageAuthorizationEnforced()) return false;
    const identity = await pageIdentity();
    if (!identity?.verified) return false;
    return canAccessAdminConsole(identity.role) || APP_SWITCHER_USER_IDS.includes(identity.subject);
  } catch {
    return false;
  }
}
