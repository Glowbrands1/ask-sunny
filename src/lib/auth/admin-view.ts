import "server-only";

import { canAccessAdminConsole } from "@/lib/permissions";
import { pageAuthorizationEnforced, pageIdentity } from "./page";

/**
 * ============================================================================
 * IS THIS READER AN ADMINISTRATOR? — FOR CONTENT, NOT FOR ACCESS
 * ============================================================================
 *
 * THE REQUEST, from the 14 September review: "'Data Source & Quality,'
 * including the parser name, parser version, and source columns, is
 * engineering-facing information and should be admin-only."
 *
 * NOT A SECURITY BOUNDARY, AND IT MUST NOT BE MISTAKEN FOR ONE. Everything this
 * hides is lineage about a report the reader is already authorized to see — a
 * parser key, a file name, a sheet list. Hiding it is an editorial decision
 * about what belongs on a manager's screen, and the pages guard ACCESS with
 * `requirePagePermission` before any of this runs.
 *
 * That distinction is why this returns false rather than throwing, and why it
 * is named for the VIEW rather than for a permission: a caller reading it as a
 * gate would be reading it wrongly, and `canAccessAdminConsole` next door is
 * the thing that actually gates the admin console.
 *
 * IN DEMO MODE EVERYBODY IS AN ADMINISTRATOR, for the same reason the page
 * guards do not enforce there: a presenter switching roles must be able to see
 * the whole product, and there is no verified identity to enforce against.
 */
export async function viewerIsAdmin(): Promise<boolean> {
  if (!pageAuthorizationEnforced()) return true;
  const identity = await pageIdentity();
  if (!identity || !identity.verified) return false;
  return canAccessAdminConsole(identity.role);
}
