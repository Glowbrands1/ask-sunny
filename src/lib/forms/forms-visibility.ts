import "server-only";

import { businessToday } from "@/lib/business-date";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { canAccessAdminConsole } from "@/lib/permissions";
import { authorizedSalonIds } from "./location-scope";
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
 *   their salons everyone else, whatever their role: the salons on a `salon`
 *                scope, PLUS every location Woven assigns them — the primary
 *                and each active additional or unexpired temporary location
 *                that maps to a salon. A manager covering several locations
 *                reads all of them (20 Oct 2026); one covering one reads one.
 *   nothing      no resolvable salon. Fails closed, never to "all".
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

interface WovenEmployee {
  employeeId: string | null;
  primarySalon: string | null;
}

/** The Woven employee behind this account, and the primary salon it maps to. */
async function wovenEmployee(subject: string): Promise<WovenEmployee | null> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("employee_access_preview")
      .select("employee_id, mapped_primary_salon_number")
      .eq("app_user_id", subject)
      .limit(2);
    if (error || !data || data.length !== 1) return null;
    const row = data[0] as { employee_id?: unknown; mapped_primary_salon_number: unknown };
    const number = row.mapped_primary_salon_number;
    return {
      employeeId: typeof row.employee_id === "string" && row.employee_id.length > 0 ? row.employee_id : null,
      primarySalon: typeof number === "string" && number.length > 0 ? `loc-${number}` : null,
    };
  } catch {
    return null;
  }
}

/**
 * Every OTHER location Woven assigns this employee, as location ids: active
 * affiliations, not past their ExpiresOn, whose Woven location is mapped to a
 * salon. An unmapped location names no salon and is skipped; any lookup
 * failure returns nothing, so the reader falls back to their primary salon.
 */
async function wovenAffiliatedSalons(employeeId: string): Promise<string[]> {
  try {
    const supabase = getSupabaseAdmin();
    const today = businessToday();
    const affiliations = await supabase
      .from("employee_location_affiliations")
      .select("woven_location_id, expires_on")
      .eq("employee_id", employeeId)
      .eq("active", true)
      .limit(200);
    if (affiliations.error || !affiliations.data) return [];
    const wovenIds = (affiliations.data as { woven_location_id: unknown; expires_on: unknown }[])
      .filter((row) => typeof row.expires_on !== "string" || row.expires_on >= today)
      .map((row) => row.woven_location_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (wovenIds.length === 0) return [];

    const mapped = await supabase
      .from("woven_location_map")
      .select("salon_id")
      .in("woven_location_id", wovenIds)
      .eq("status", "mapped")
      .limit(200);
    if (mapped.error || !mapped.data) return [];
    const salonIds = (mapped.data as { salon_id: unknown }[])
      .map((row) => row.salon_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (salonIds.length === 0) return [];

    const salons = await supabase.from("salons").select("salon_number").in("id", salonIds).limit(200);
    if (salons.error || !salons.data) return [];
    return (salons.data as { salon_number: unknown }[])
      .map((row) => row.salon_number)
      .filter((number): number is string => typeof number === "string" && number.length > 0)
      .map((number) => `loc-${number}`);
  } catch {
    return [];
  }
}

/** The scope this verified identity may READ forms under. */
export async function resolveFormsVisibility(identity: VisibilityIdentity): Promise<AccessScope> {
  if (canAccessAdminConsole(identity.role)) return ALL_SALONS;
  if (await isDesignatedAllSalons(identity.subject)) return ALL_SALONS;

  /*
   * A `salon` scope IS a store assignment, so its salons are honoured as
   * assigned. Every other level (global, district, region) names no salon. In
   * both cases Woven's locations for the account are added: the primary, and
   * each further location they are assigned to.
   */
  const { scope } = identity;
  const assigned = scope?.level === "salon" ? authorizedSalonIds(scope) : [];
  const woven = await wovenEmployee(identity.subject);
  const affiliated = woven?.employeeId ? await wovenAffiliatedSalons(woven.employeeId) : [];
  const salons = [
    ...new Set([...assigned, ...(woven?.primarySalon ? [woven.primarySalon] : []), ...affiliated]),
  ];
  if (salons.length === 0) return NO_SALON;
  const [primary, ...rest] = salons;
  return { level: "salon", primaryAreaId: primary!, alsoCoversAreaIds: rest };
}
