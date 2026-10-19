import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { canAccessAdminConsole } from "@/lib/permissions";
import type { AccessScope, Role } from "@/types";

/**
 * ============================================================================
 * WHICH SALONS' FORMS A PERSON MAY READ — DECIDED HERE, ONCE
 * ============================================================================
 *
 * THE DEFECT. Form Monitoring, the Overview queue and the rail's badge read
 * `form_instance_overview` with no salon filter, so every manager saw every
 * salon's HR forms. `GET /api/forms/instances` was narrowed; the pages reading
 * the same table directly were not. And the stored `scope_level = 'global'` sits
 * on ordinary district and regional manager accounts, not only administrators,
 * so it cannot mean "may read every salon's disciplinary records".
 *
 * THE RULE, by role and role alone — the stored scope level is not consulted
 * for a non-salon scope:
 *
 *   all salons   an administrator role, or an account with an unrevoked row in
 *                `forms_all_store_access` (admin-managed, keyed to the account
 *                id; Colene and DJ). Independent of Woven verification.
 *   home salon   everyone else, whatever their role: the salons on a `salon`
 *                scope, else the primary salon Woven maps to their account.
 *   nothing      no resolvable home salon. Fails closed, never to "all".
 *
 * Every lookup failure resolves to LESS access. This is the VISIBILITY scope
 * only: creating a form is still authorized against the stored scope.
 */

const ALL_SALONS: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const NO_SALON: AccessScope = { level: "salon", primaryAreaId: null, alsoCoversAreaIds: [] };

export interface VisibilityIdentity {
  subject: string;
  role: Role;
  scope: AccessScope;
}

/** Whether an admin-managed designation grants this account all salons. Fails closed. */
async function isDesignatedAllSalons(subject: string): Promise<boolean> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("forms_all_store_access")
      .select("app_user_id")
      .eq("app_user_id", subject)
      .is("revoked_at", null)
      .maybeSingle();
    return !error && data !== null;
  } catch {
    return false;
  }
}

/** The primary salon Woven maps to this account, as a location id (`loc-<salon number>`). */
async function wovenHomeSalon(subject: string): Promise<string | null> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("employee_access_preview")
      .select("mapped_primary_salon_number")
      .eq("app_user_id", subject)
      .limit(2);
    if (error || !data || data.length !== 1) return null;
    const number = (data[0] as { mapped_primary_salon_number: unknown }).mapped_primary_salon_number;
    return typeof number === "string" && number.length > 0 ? `loc-${number}` : null;
  } catch {
    return null;
  }
}

/** The scope this verified identity may READ forms under. */
export async function resolveFormsVisibility(identity: VisibilityIdentity): Promise<AccessScope> {
  if (canAccessAdminConsole(identity.role)) return ALL_SALONS;
  if (await isDesignatedAllSalons(identity.subject)) return ALL_SALONS;

  /*
   * A `salon` scope IS a home-store assignment, so it is honoured as assigned.
   * Every other level (global, district, region) names no salon, so the salon
   * comes from Woven's mapping instead.
   */
  const { scope } = identity;
  if (scope?.level === "salon" && scope.primaryAreaId) return scope;

  const woven = await wovenHomeSalon(identity.subject);
  return woven ? { level: "salon", primaryAreaId: woven, alsoCoversAreaIds: [] } : NO_SALON;
}
