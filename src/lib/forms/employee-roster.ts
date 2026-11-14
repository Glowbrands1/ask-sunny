import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { AccessScope } from "@/types";

import { rosterStoreScopedEnabled } from "@/lib/config/chat-quality-flags";

import { noteAccountNames } from "./account-names";
import { isServiceAccountName, type RosterEmployee } from "./employee-match";
import { authorizedSalonIds } from "./location-scope";
import { isNonPersonWovenId } from "./roster-non-person";

/**
 * Directory ids the grounded path already chose. Unset, the scoped roster
 * is the one `loadScopedRoster` already returned. An empty set does not filter.
 */
const rosterLimit = new AsyncLocalStorage<ReadonlySet<string>>();

/**
 * The roster cut to the turn's `withRosterLimit`, when one is set. Exported so the replay pack's roster stand-in applies
 * the same limit production's `loadScopedRoster` does (a choice between two same-named people is carried this way).
 */
export function withinRosterLimit<T extends { readonly id: string }>(roster: readonly T[]): T[] {
  // ACCOUNT_TYPOS_FIXED_ENABLED / SPELLING_CLEANUP_ENABLED (QA's bar, 14 Nov 2026): every roster name is kept from a
  // spelling fix (`account-names.ts`).
  noteAccountNames(roster as readonly { readonly firstName?: string | null; readonly lastName?: string | null }[]);
  const limit = rosterLimit.getStore();
  if (!limit || limit.size === 0) return [...roster];
  return roster.filter((person) => limit.has(person.id));
}

export function withRosterLimit<T>(ids: readonly string[] | null, run: () => T): T {
  if (!ids || ids.length === 0) return rosterLimit.run(new Set(), run);
  return rosterLimit.run(new Set(ids), run);
}

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
    const roster = rosterStoreScopedEnabled()
      ? (await readStoreRoster(scope)).map(rosterEmployeeOf)
      : scopeRoster(await readDirectoryRoster(), scope);
    return withinRosterLimit(roster);
  } catch {
    return [];
  }
}

/** Roster row plus the Woven title and primary location the name check does not read. */
export interface DirectoryFact extends RosterEmployee {
  readonly title: string | null;
  readonly primaryLocationName: string | null;
  /** Ask Sunny salon id for `primary_woven_location_id`, when that salon is in scope. */
  readonly primarySalonId: string | null;
}

/**
 * The same scoped roster, plus job title and primary location.
 *
 * A separate read so `readDirectoryRoster` keeps the select it has today.
 * Called only when grounded entities are on. A missing column or a failed
 * read returns an empty list; the caller then uses `loadScopedRoster`.
 */
export async function readDirectoryFacts(scope: AccessScope | null): Promise<DirectoryFact[]> {
  if (!scope || scope.level === "district" || scope.level === "region") return [];
  if (rosterStoreScopedEnabled()) {
    try {
      return await readStoreRoster(scope);
    } catch {
      return [];
    }
  }
  try {
    const supabase = getSupabaseAdmin();
    const [people, affiliations, map, salons] = await Promise.all([
      supabase
        .from("employee_access_directory")
        .select(
          "id, first_name, last_name, preferred_first_name, employment_status, position_name, primary_woven_location_id, primary_location_name",
        )
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
    if (people.error || affiliations.error || map.error || salons.error) return [];

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

    const allowed = scope.level === "salon" ? new Set(authorizedSalonIds(scope)) : null;
    if (allowed && allowed.size === 0) return [];

    const facts: DirectoryFact[] = [];
    for (const row of people.data ?? []) {
      const first = String(row.first_name ?? "").trim();
      const last = String(row.last_name ?? "").trim();
      if (!first || !last) continue;
      if (row.employment_status === "terminated") continue;
      if (isServiceAccountName(first, last)) continue;
      const affiliated = [...(salonsByEmployee.get(String(row.id)) ?? [])];
      const primaryWoven = row.primary_woven_location_id ? String(row.primary_woven_location_id) : "";
      const primaryId = primaryWoven ? locationByWoven.get(primaryWoven) : undefined;
      const salonIds = affiliated.length > 0 ? affiliated : primaryId ? [primaryId] : [];
      const inScope = allowed ? salonIds.filter((id) => allowed.has(id)) : salonIds;
      if (allowed && inScope.length === 0) continue;
      facts.push({
        id: String(row.id),
        firstName: first,
        lastName: last,
        preferredFirstName: String(row.preferred_first_name ?? "").trim() || null,
        salonIds: [...inScope].sort(),
        title: String(row.position_name ?? "").trim() || null,
        primaryLocationName: String(row.primary_location_name ?? "").trim() || null,
        primarySalonId: primaryId && inScope.includes(primaryId) ? primaryId : null,
      });
    }
    return facts;
  } catch {
    return [];
  }
}

/**
 * ============================================================================
 * ROSTER_STORE_SCOPED_ENABLED — ONLY THE MANAGER'S OWN SALONS, NEVER THE WHOLE
 * DIRECTORY (master plan step 1, 3 Nov 2026; same mechanism in both apps)
 * ============================================================================
 *
 * The flag-off reads above load the whole directory (`.limit(5000)`,
 * `.limit(20000)`) and scope it in memory. The database answers at most 1,000
 * rows per request whatever the limit says, so a directory past that would be
 * cut short without an error.
 *
 * READ FROM THE WOVEN-SYNCED TABLES, NEVER FROM WOVEN. The daily sync keeps
 * `employee_access_directory` and `employee_location_affiliations` current;
 * nothing here calls the Woven API.
 *
 *   1. the actor's salons (`authorizedSalonIds`; a global scope is every
 *      salon) → their `salons` rows → their mapped Woven locations
 *   2. → the ACTIVE affiliations at those locations
 *   3. → those people, `employment_status = 'active'` only
 *   4. minus shared or service accounts by name (`isServiceAccountName`, as
 *      before) and reviewed shared logins by Woven id (`roster-non-person.ts`)
 *
 * A district or region scope stays unchecked, exactly as the flag-off read
 * (callers return before this). Every read is paged with `.range()` and
 * ordered. Throws on a read error; the callers return an empty roster, which
 * is "unchecked" (the typed name is used as typed), never "everyone".
 */
export const ROSTER_PAGE_ROWS = 1000;
/** Ids per `.in()` filter, so a request URL stays short. */
const IN_CHUNK = 200;

type Page<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

/** Every row of one read, a page of `ROSTER_PAGE_ROWS` at a time. */
async function readAllPages<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += ROSTER_PAGE_ROWS) {
    const { data, error } = await page(from, from + ROSTER_PAGE_ROWS - 1);
    if (error) throw new Error("The employee directory could not be read.");
    rows.push(...(data ?? []));
    if ((data ?? []).length < ROSTER_PAGE_ROWS) return rows;
  }
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

type Row = Record<string, unknown>;
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim());

/** The active people at the actor's own salons, with title and primary salon. */
export async function readStoreRoster(scope: AccessScope | null): Promise<DirectoryFact[]> {
  if (!scope || (scope.level !== "salon" && scope.level !== "global")) return [];
  const wanted = scope.level === "salon" ? authorizedSalonIds(scope) : null;
  if (wanted && wanted.length === 0) return [];
  const supabase = getSupabaseAdmin();

  const salons = await readAllPages<Row>((from, to) => {
    const query = supabase.from("salons").select("id, salon_number");
    const scoped = wanted ? query.in("salon_number", wanted.map((id) => id.replace(/^loc-/, ""))) : query;
    return scoped.order("id", { ascending: true }).range(from, to);
  });
  const salonIdByRow = new Map<string, string>();
  for (const row of salons) {
    const number = text(row.salon_number);
    if (!number) continue;
    const salonId = locationIdForSalonNumber(number);
    if (!wanted || wanted.includes(salonId)) salonIdByRow.set(text(row.id), salonId);
  }
  if (salonIdByRow.size === 0) return [];

  const map: Row[] = [];
  for (const rowIds of chunks([...salonIdByRow.keys()], IN_CHUNK)) {
    map.push(
      ...(await readAllPages<Row>((from, to) =>
        supabase
          .from("woven_location_map")
          .select("woven_location_id, salon_id")
          .eq("status", "mapped")
          .in("salon_id", rowIds)
          .order("woven_location_id", { ascending: true })
          .range(from, to),
      )),
    );
  }
  const salonByWoven = new Map<string, string>();
  for (const row of map) {
    const salonId = salonIdByRow.get(text(row.salon_id));
    if (salonId) salonByWoven.set(text(row.woven_location_id), salonId);
  }
  if (salonByWoven.size === 0) return [];

  const affiliations: Row[] = [];
  for (const wovenIds of chunks([...salonByWoven.keys()], IN_CHUNK)) {
    affiliations.push(
      ...(await readAllPages<Row>((from, to) =>
        supabase
          .from("employee_location_affiliations")
          .select("employee_id, woven_location_id")
          .eq("active", true)
          .in("woven_location_id", wovenIds)
          // A unique order (employee, location), so no row is skipped or repeated between pages.
          .order("employee_id", { ascending: true })
          .order("woven_location_id", { ascending: true })
          .range(from, to),
      )),
    );
  }
  const salonsByEmployee = new Map<string, Set<string>>();
  for (const row of affiliations) {
    const salonId = salonByWoven.get(text(row.woven_location_id));
    if (!salonId) continue;
    const key = text(row.employee_id);
    if (!salonsByEmployee.has(key)) salonsByEmployee.set(key, new Set());
    salonsByEmployee.get(key)!.add(salonId);
  }
  if (salonsByEmployee.size === 0) return [];

  const people: Row[] = [];
  for (const ids of chunks([...salonsByEmployee.keys()], IN_CHUNK)) {
    people.push(
      ...(await readAllPages<Row>((from, to) =>
        supabase
          .from("employee_access_directory")
          .select(
            "id, external_employee_id, first_name, last_name, preferred_first_name, employment_status, position_name, primary_woven_location_id, primary_location_name",
          )
          .in("id", ids)
          .eq("employment_status", "active")
          .order("id", { ascending: true })
          .range(from, to),
      )),
    );
  }

  const facts: DirectoryFact[] = [];
  for (const row of people) {
    const first = text(row.first_name);
    const last = text(row.last_name);
    if (!first || !last) continue;
    if (row.employment_status !== "active") continue;
    if (isServiceAccountName(first, last)) continue;
    if (isNonPersonWovenId(text(row.external_employee_id))) continue;
    const salonIds = [...(salonsByEmployee.get(text(row.id)) ?? [])].sort();
    const primary = salonByWoven.get(text(row.primary_woven_location_id));
    facts.push({
      id: text(row.id),
      firstName: first,
      lastName: last,
      preferredFirstName: text(row.preferred_first_name) || null,
      salonIds,
      title: text(row.position_name) || null,
      primaryLocationName: text(row.primary_location_name) || null,
      primarySalonId: primary && salonIds.includes(primary) ? primary : null,
    });
  }
  return facts.sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName) || a.id.localeCompare(b.id));
}

/** A store-roster row as the name checks read it. */
function rosterEmployeeOf(fact: DirectoryFact): RosterEmployee {
  return {
    id: fact.id,
    firstName: fact.firstName,
    lastName: fact.lastName,
    preferredFirstName: fact.preferredFirstName,
    salonIds: fact.salonIds,
  };
}
