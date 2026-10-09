import "server-only";

import { canAccessAdminConsole } from "@/lib/permissions";
import { pageAuthorizationEnforced, pageIdentity } from "./page";

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
 * IT IS NOT A BOUNDARY. The switcher is a link to the other app's public login;
 * that app's own sign-in and permissions decide what happens on arrival.
 */
export async function pageShowsAppSwitcher(): Promise<boolean> {
  try {
    if (!pageAuthorizationEnforced()) return false;
    const identity = await pageIdentity();
    return Boolean(identity?.verified) && canAccessAdminConsole(identity!.role);
  } catch {
    return false;
  }
}
