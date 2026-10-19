import { canAccessAdminConsole } from "@/lib/permissions";
import type { AccessScope, Role } from "@/types";

import { authorizedSalonIds } from "./location-scope";

/**
 * ============================================================================
 * WHICH SALONS' FORMS A PERSON MAY READ — ONE DECISION, ONE PLACE
 * ============================================================================
 *
 * THE DEFECT. Form Monitoring, the Overview's follow-up queue and the rail's
 * overdue badge read `form_instance_overview` with no salon filter at all, so
 * every manager saw every salon's HR records. `GET /api/forms/instances` was
 * already narrowed; the pages that read the same table directly were not.
 *
 * A SECOND, QUIETER DEFECT SAT BEHIND IT. The database stores
 * `scope_level = 'global'` on ordinary district-manager accounts (Rachael,
 * Sarah) as well as on the administrators. Trusting the stored level would
 * have made "global" mean "may read every salon's disciplinary records" for
 * anyone an administrator ever ticked it for. Reading ALL salons' forms is
 * therefore decided here, from the verified identity, by exactly two rules:
 *
 *   1. an administrator role (`canAccessAdminConsole`), or
 *   2. a user id on `FORMS_ALL_SALONS_USER_IDS` — Colene and DJ.
 *
 * Ids, never display names or emails: a name is something an account holder
 * can edit, a Supabase user id is not. The ids are this app's own
 * (`auth.users.id` = `app_users.id` in the Ask Sunny project); they differ from
 * the same people's ids in the sister app.
 *
 * EVERYONE ELSE reads their assigned salon(s) only, and a stored `global` level
 * is NOT honoured — it resolves to a salon scope with no salon, which reads
 * nothing. District and region scopes are passed through untouched: the forms
 * code already fails them closed (`authorizedSalonIds` is empty for any level
 * but `salon`), and reporting resolves their membership separately.
 *
 * Every forms read — API routes through `authorizeForms`, the Monitoring page,
 * the Overview queue and the badge — calls this, so they cannot disagree.
 */
export const FORMS_ALL_SALONS_USER_IDS: readonly string[] = [
  // INTENTIONALLY EMPTY. All-store access for non-administrators is to come from Woven
  // location assignments, not from user ids. Pending design approval.
];

const GLOBAL_SCOPE: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

/** A salon scope naming no salon: valid, and it reads nothing. */
const NO_SALON_SCOPE: AccessScope = { level: "salon", primaryAreaId: null, alsoCoversAreaIds: [] };

export interface FormsReader {
  subject: string;
  role: Role;
  scope: AccessScope;
}

/** Whether this verified identity may read every salon's forms. */
export function readsAllSalonsForms(reader: Pick<FormsReader, "subject" | "role">): boolean {
  return canAccessAdminConsole(reader.role) || FORMS_ALL_SALONS_USER_IDS.includes(reader.subject);
}

/**
 * The scope a verified reader's FORM reads are decided by. `null` is for an
 * unverified (demo) caller only, and means "not enforced" — callers pass `null`
 * through exactly as they did before.
 */
export function formsScopeFor(reader: FormsReader | null): AccessScope | null {
  if (!reader) return null;
  if (readsAllSalonsForms(reader)) return GLOBAL_SCOPE;
  if (reader.scope.level === "global") return NO_SALON_SCOPE;
  return reader.scope;
}

/**
 * True when a verified reader has no salon to read: no home-store assignment,
 * or an area scope forms cannot expand. The screens say so instead of showing
 * an empty list that looks like "no forms yet".
 */
export function lacksHomeSalon(scope: AccessScope | null): boolean {
  if (!scope || scope.level === "global") return false;
  return authorizedSalonIds(scope).length === 0;
}

/** Salon ids to narrow a query by, or null for unrestricted. Empty means nothing. */
export function formsSalonIdsFor(scope: AccessScope | null): string[] | null {
  if (!scope || scope.level === "global") return null;
  return authorizedSalonIds(scope);
}

export const NO_HOME_SALON_MESSAGE =
  "Your account has no home salon assigned, so no forms are shown. Ask an administrator to set your salon in User Management.";
