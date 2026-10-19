import "server-only";

import type { AuthenticatedIdentity } from "@/lib/auth/types";

import type { FormsActor } from "./access";
import { resolveFormsVisibility } from "./forms-visibility";
import { authorizedSalonIds } from "./location-scope";

/**
 * What a SERVER-RENDERED page may read from the forms record: the same
 * visibility the API routes apply through `authorizeForms`, resolved from the
 * VERIFIED identity, so a page and its API cannot disagree.
 *
 *   locationIds   salon ids the read must be narrowed to; null = unrestricted
 *                 (administrators, designated accounts, and unverified preview,
 *                 whose scope the browser asserted about itself)
 *   noSalon       a verified reader with no resolvable home salon: nothing is
 *                 read at all and the page says why
 */
export interface PageFormsAccess {
  actor: FormsActor;
  locationIds: string[] | null;
  noSalon: boolean;
}

export async function pageFormsAccess(
  identity: AuthenticatedIdentity | null,
): Promise<PageFormsAccess> {
  const visibility =
    identity?.verified === true ? await resolveFormsVisibility(identity) : null;
  const actor: FormsActor = {
    id: identity?.subject ?? "preview",
    role: identity?.role ?? null,
    verified: identity?.verified === true,
    scope: identity?.scope ?? null,
    visibility,
  };
  if (!visibility || visibility.level === "global") {
    return { actor, locationIds: null, noSalon: false };
  }
  const locationIds = authorizedSalonIds(visibility);
  return { actor, locationIds, noSalon: locationIds.length === 0 };
}
