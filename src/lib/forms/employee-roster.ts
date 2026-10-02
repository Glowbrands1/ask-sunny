import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { AccessScope } from "@/types";

import { isServiceAccountName, type RosterEmployee } from "./employee-match";
import { authorizedSalonIds } from "./location-scope";

/**
 * ============================================================================
 * THE EMPLOYEES A FORM-FILER MAY NAME — FROM THE WOVEN DIRECTORY, IN SCOPE
 * ============================================================================
 *
 * READ-ONLY USE OF THE PHASE-ONE DIRECTORY. `employee_access_directory` is the
 * observe-only Woven sync (docs/woven-employee-sync.md). Nothing here writes to
 * it, and nothing here grants access: it is read to check a SPELLING and to
 * learn which salon an employee works at, after the actor's own scope has
 * already decided which salons they may file against.
 *
 * SCOPE IS APPLIED HERE, BEFORE ANY NAME LEAVES THE SERVER:
 *
 *   salon     employees with an active, person-mapped affiliation at one of the
 *             actor's own salons. Nobody else is ever a candidate.
 *   global    every active employee — a global scope excludes no salon.
 *   district  NOBODY, for the same reason form creation fails closed for these
 *   region    scopes (`location-scope.ts`): the forms path cannot yet verify
 *             which salons an area contains. An empty roster means the typed
 *             name is used as typed, exactly as before.
 *   demo      NOBODY. A demo actor has no verified scope.
 *
 * FAILS TO "UNCHECKED", NEVER TO "EVERYONE". Any read error returns an empty
 * roster, and an empty roster changes nothing about the form: the name the
 * manager typed is used, as it always was.
 *
 * TERMINATED EMPLOYEES ARE LEFT OUT. A coaching form is about somebody on the
 * team today. `unknown` statuses stay in — the sync never reads `unknown` as
 * terminated, and neither does this.
 *
 * SHARED AND SERVICE ACCOUNTS ARE LEFT OUT. "Risk Management", "No Manager"
 * and "GlowBrands IT Support" are directory rows, not people; a row is left
 * out only when every word of its name is a department, role or system word.
 * See `isServiceAccountName`. The directory itself is never changed.
 */

export interface DirectoryRosterRow {
  readonly id: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly preferredFirstName: string | null;
  readonly employmentStatus: string | null;
  readonly salonIds: readonly string[];
}

/** Restricts the directory to what this actor may see. Pure. */
export function scopeRoster(
  rows: readonly DirectoryRosterRow[],
  scope: AccessScope | null,
): RosterEmployee[] {
  if (!scope) return [];
  if (scope.level === "district" || scope.level === "region") return [];
  const allowed = scope.level === "salon" ? new Set(authorizedSalonIds(scope)) : null;
  if (allowed && allowed.size === 0) return [];

  const roster: RosterEmployee[] = [];
  for (const row of rows) {
    if (row.employmentStatus === "terminated") continue;
    const first = row.firstName?.trim() ?? "";
    const last = row.lastName?.trim() ?? "";
    if (!first || !last) continue;
    // "Risk Management", "No Manager": a shared or service account, never a suggestion.
    if (isServiceAccountName(first, last)) continue;
    const salonIds = allowed ? row.salonIds.filter((id) => allowed.has(id)) : [...row.salonIds];
    if (allowed && salonIds.length === 0) continue;
    roster.push({
      id: row.id,
      firstName: first,
      lastName: last,
      preferredFirstName: row.preferredFirstName?.trim() || null,
      salonIds,
    });
  }
  return roster;
}

/** `loc-NNNN` — the id every Ask Sunny scope and form uses for a salon. */
function locationIdForSalonNumber(salonNumber: string): string {
  return `loc-${salonNumber}`;
}

/**
 * The whole directory, joined to Ask Sunny salons through the person-reviewed
 * location map. Four small reads joined in memory: the directory is a few
 * hundred rows, and none of these tables has a foreign key to join through.
 */
export async function readDirectoryRoster(): Promise<DirectoryRosterRow[]> {
  const supabase = getSupabaseAdmin();
  const [people, affiliations, map, salons] = await Promise.all([
    supabase
      .from("employee_access_directory")
      .select("id, first_name, last_name, preferred_first_name, employment_status")
      .limit(5000),
    supabase
      .from("employee_location_affiliations")
      .select("employee_id, woven_location_id")
      .eq("active", true)
      .limit(20000),
    supabase
      .from("woven_location_map")
      .select("woven_location_id, salon_id")
      .eq("status", "mapped")
      .limit(1000),
    supabase.from("salons").select("id, salon_number").limit(1000),
  ]);
  if (people.error || affiliations.error || map.error || salons.error) {
    throw new Error("The employee directory could not be read.");
  }

  const salonNumberById = new Map(
    (salons.data ?? []).map((row) => [String(row.id), String(row.salon_number)]),
  );
  const locationByWoven = new Map<string, string>();
  for (const row of map.data ?? []) {
    const number = row.salon_id ? salonNumberById.get(String(row.salon_id)) : undefined;
    if (number) locationByWoven.set(String(row.woven_location_id), locationIdForSalonNumber(number));
  }
  const salonsByEmployee = new Map<string, Set<string>>();
  for (const row of affiliations.data ?? []) {
    const location = locationByWoven.get(String(row.woven_location_id));
    if (!location) continue;
    const key = String(row.employee_id);
    if (!salonsByEmployee.has(key)) salonsByEmployee.set(key, new Set());
    salonsByEmployee.get(key)!.add(location);
  }

  return (people.data ?? []).map((row) => ({
    id: String(row.id),
    firstName: (row.first_name as string | null) ?? null,
    lastName: (row.last_name as string | null) ?? null,
    preferredFirstName: (row.preferred_first_name as string | null) ?? null,
    employmentStatus: (row.employment_status as string | null) ?? null,
    salonIds: [...(salonsByEmployee.get(String(row.id)) ?? [])].sort(),
  }));
}

/**
 * The scoped roster for one actor, or empty when it cannot be established.
 * Never throws: a directory outage must not stop a manager filing a form.
 */
export async function loadScopedRoster(scope: AccessScope | null): Promise<RosterEmployee[]> {
  if (!scope || scope.level === "district" || scope.level === "region") return [];
  try {
    return scopeRoster(await readDirectoryRoster(), scope);
  } catch {
    return [];
  }
}
