import type { AccessScope } from "@/types";
import {
  PRODUCTION_DISTRICTS,
  PRODUCTION_REGIONS,
  PRODUCTION_SALONS,
} from "@/data/salons";

/**
 * ============================================================================
 * WHICH SALONS' FIGURES A PERSON MAY BE SHOWN
 * ============================================================================
 *
 * THE GAP THIS CLOSES, from the 14 September review of the restricted account
 * scoped to MO Kansas City Wornall:
 *
 *   "I pulled Salon Performance side by side with the admin session, and it was
 *    identical line for line. An account assigned to one salon can see all 15
 *    salons' revenue, chain rank, quintile, and every director's name."
 *
 *   "The chip says MO Kansas City Wornall, but the page shows Total Revenue of
 *    $676.3K and 7,120 Unique Tanners — the full regional figures."
 *
 *   "It returned a complete ranked list of all 15 salons... Sunny is choosing
 *    to lead with the user's assigned salon, but nothing prevents the user from
 *    asking for information outside of that scope."
 *
 * All three are one defect. `AccessScope` existed, was carried on every
 * authenticated identity, and was read by Forms and by nothing else: the
 * reporting read layer, the Overview and the chat briefing all queried the
 * whole delivery. Scope was a preference in how Sunny opened its answer, not a
 * boundary on what it could retrieve.
 *
 * ============================================================================
 * WHAT THIS MODULE IS, AND WHAT IT IS NOT
 * ============================================================================
 *
 * It is ONE FUNCTION: an authenticated `AccessScope` in, the set of salon
 * NUMBERS that scope proves entitlement to out. It is not a second permission
 * system — the role matrix still decides what a person may DO, and this decides
 * only which salons' rows they may be shown while doing it.
 *
 * It returns `null` for "not restricted", which is deliberately distinct from
 * "restricted to nothing". A global scope and an empty allowlist are opposite
 * answers, and a caller that conflated them would either show a Salon Director
 * the whole chain or show an administrator nothing.
 *
 * ============================================================================
 * WHERE THE ROSTER COMES FROM
 * ============================================================================
 *
 * `PRODUCTION_SALONS` — which, as its own header records, stopped being demo data
 * when it was replaced with the fifteen salons Reporting actually ingests, with
 * the same salon numbers, the same store names and the same three districts. It
 * is the only mapping in the codebase from a district or region id to the
 * salons inside it, and the ids the User Management screen writes into
 * `app_users.scope_primary_area_id` are its ids.
 *
 * A SALON ID IS `loc-0306` AND A SALON NUMBER IS `0306`. The reporting tables
 * are keyed on the number, so the translation happens here, once. It is a
 * strict prefix strip and never a parse: `0306` must keep its leading zero, and
 * `Number("0306")` is how a salon's history gets split across two rows.
 *
 * WHEN THE ROSTER CANNOT ANSWER, THIS FAILS CLOSED. A district or region scope
 * naming an area the roster does not contain yields an EMPTY allowlist, not an
 * absent one — the caller then shows no salon figures and says so. The
 * alternative, treating "I cannot tell which salons these are" as "all of
 * them", is the exact failure the review found.
 */

/** Every salon number on the roster, in roster order. */
export function rosterSalonNumbers(): string[] {
  return PRODUCTION_SALONS.map((location) => salonNumberOf(location.id)).filter(
    (value): value is string => value !== null,
  );
}

/** `loc-0306` -> `0306`. Null for an id that is not a salon id. */
export function salonNumberOf(locationId: string): string | null {
  if (!locationId.startsWith("loc-")) return null;
  const number = locationId.slice("loc-".length);
  return number.length > 0 ? number : null;
}

/**
 * The salons an authenticated scope entitles its holder to see.
 *
 * `null` means UNRESTRICTED — a global scope, or an unverified (demo) actor for
 * whom there is no scope to enforce. Every other answer is an explicit list,
 * and an empty list means "no salon", which callers must render as no figures
 * rather than as all of them.
 */
export function authorizedSalonNumbers(
  scope: AccessScope | null | undefined,
): string[] | null {
  /*
   * NO SCOPE MEANS NOT ENFORCED, and that is the same decision Forms already
   * made in `forms/location-scope.ts`: a demo actor has no verified identity,
   * so enforcing against a scope the browser asserted about itself would be
   * theatre and would break preview QA for nothing. In live mode every request
   * carries a verified identity or is refused before it reaches here.
   */
  if (!scope) return null;

  if (scope.level === "global") return null;

  /*
   * DEFENSIVE ABOUT THE SHAPE, because this function must not THROW.
   *
   * `AccessScope` declares `alsoCoversAreaIds` as an array and the profile
   * mapper always fills one, but this is an authorization decision reached from
   * several call sites and one of them will eventually hand it a scope built by
   * hand. A thrown TypeError here does not fail closed — it fails the whole
   * request, which on the chat path takes down an answer that had nothing to do
   * with scope. A missing list is simply no additional areas.
   */
  const alsoCovers = Array.isArray(scope.alsoCoversAreaIds) ? scope.alsoCoversAreaIds : [];
  const areaIds = [scope.primaryAreaId, ...alsoCovers].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );

  const numbers = new Set<string>();

  for (const areaId of areaIds) {
    if (scope.level === "salon") {
      const number = salonNumberOf(areaId);
      if (number) numbers.add(number);
      continue;
    }

    if (scope.level === "district") {
      for (const location of PRODUCTION_SALONS) {
        if (location.districtId !== areaId) continue;
        const number = salonNumberOf(location.id);
        if (number) numbers.add(number);
      }
      continue;
    }

    if (scope.level === "region") {
      for (const location of PRODUCTION_SALONS) {
        if (location.regionId !== areaId) continue;
        const number = salonNumberOf(location.id);
        if (number) numbers.add(number);
      }
    }
  }

  // Sorted so an allowlist is stable across requests and easy to compare in a
  // test failure; the order carries no meaning.
  return [...numbers].sort();
}

/**
 * The area's own name, for a sentence that tells somebody what they are seeing.
 *
 * Returns null rather than the raw id when the roster does not know the area:
 * showing `dist-9` to a Salon Director explains nothing, and the caller has a
 * better fallback than an internal identifier.
 */
export function scopeAreaLabel(scope: AccessScope | null | undefined): string | null {
  if (!scope || scope.level === "global" || !scope.primaryAreaId) return null;
  const id = scope.primaryAreaId;

  const location = PRODUCTION_SALONS.find((entry) => entry.id === id);
  if (location) return location.name;
  const district = PRODUCTION_DISTRICTS.find((entry) => entry.id === id);
  if (district) return district.name;
  const region = PRODUCTION_REGIONS.find((entry) => entry.id === id);
  if (region) return region.name;
  return null;
}

/**
 * What a reporting surface needs to know about the caller's reach, resolved
 * once and passed down rather than re-derived per query.
 */
export interface ReportingScope {
  /** True when nothing is withheld — a global scope, or an unverified actor. */
  readonly unrestricted: boolean;
  /**
   * The salon numbers that may be read. Empty when the scope resolves to no
   * salon, which is a real state and must not be read as "everything".
   * Meaningless when `unrestricted`.
   */
  readonly salonNumbers: readonly string[];
  /** The assignment's own name, for the sentence a reader is shown. */
  readonly areaLabel: string | null;
  /** The breadth of the assignment, for wording. */
  readonly level: AccessScope["level"] | null;
}

export function reportingScopeOf(scope: AccessScope | null | undefined): ReportingScope {
  const numbers = authorizedSalonNumbers(scope);
  return {
    unrestricted: numbers === null,
    salonNumbers: numbers ?? [],
    areaLabel: scopeAreaLabel(scope),
    level: scope?.level ?? null,
  };
}

/**
 * Narrows a requested salon selection to what the caller may actually see.
 *
 * THE INTERSECTION, NEVER THE UNION. A request naming salons is narrowed to
 * those inside the allowlist; a request naming none is narrowed to the whole
 * allowlist. A filter must never broaden itself, and a URL must never be able
 * to reach past a boundary by asking for something outside it — asking for a
 * salon you may not see yields nothing, not everything.
 */
export function narrowSalonSelection(
  scope: ReportingScope,
  requested: readonly string[],
): string[] {
  if (scope.unrestricted) return [...requested];
  if (requested.length === 0) return [...scope.salonNumbers];
  const allowed = new Set(scope.salonNumbers);
  return requested.filter((number) => allowed.has(number));
}

/** True when a salon number may be shown to this caller. */
export function admitsSalonNumber(
  scope: ReportingScope,
  salonNumber: string | null | undefined,
): boolean {
  if (scope.unrestricted) return true;
  if (!salonNumber) {
    /*
     * A ROW WITH NO SALON NUMBER CANNOT BE PROVED IN SCOPE, so a restricted
     * caller does not see it. The bed and spa workbooks carry rows whose salon
     * could not be resolved to a canonical number, and admitting them "because
     * they are probably ours" is exactly the reasoning a boundary exists to
     * refuse. An unrestricted caller still sees them, and the reports already
     * report unresolved salons as a data-quality warning.
     */
    return false;
  }
  return scope.salonNumbers.includes(salonNumber);
}

/**
 * The same entitlement, expressed as LOCATION IDS rather than salon numbers.
 *
 * Forms store `location_id` (`loc-0306`) while reporting stores the salon
 * number (`0306`); they are two spellings of one salon and this returns the
 * other one, so the Overview's follow-up queue can be narrowed by the same
 * assignment its figures are.
 *
 * IT IS ONLY EVER USED TO NARROW A READ. `forms/location-scope.ts` still
 * decides which salon a form may be WRITTEN against, and still refuses a
 * district or regional actor for the reason it records — an unverified salon on
 * a disciplinary record outlives the caveat. Using the roster to show fewer
 * rows takes nothing on trust; using it to authorize a write would.
 */
export function authorizedLocationIds(
  scope: AccessScope | null | undefined,
): string[] | null {
  const numbers = authorizedSalonNumbers(scope);
  if (numbers === null) return null;
  const byNumber = new Map(
    PRODUCTION_SALONS.map((location) => [salonNumberOf(location.id), location.id]),
  );
  return numbers
    .map((number) => byNumber.get(number))
    .filter((id): id is string => typeof id === "string");
}

/**
 * The same mapping, from an ALREADY RESOLVED scope.
 *
 * `authorizedLocationIds` resolves the scope itself, which for a district or a
 * region means the static roster. This one takes the scope a caller has already
 * resolved — through `resolveScopeFor`, which asks reporting — so a surface
 * that has done the data-backed work does not throw it away on the last step.
 *
 * The number -> id mapping stays static and that is fine: it is a spelling of
 * the same salon (`0306` <-> `loc-0306`), not a membership decision, and
 * `salonNumberOf` already parses one from the other.
 */
export function locationIdsForScope(scope: ReportingScope): string[] | null {
  if (scope.unrestricted) return null;
  return scope.salonNumbers.map((number) => `loc-${number}`);
}

/** The sentence a restricted reader is shown instead of a chain-wide one. */
export function scopeNoticeSentence(scope: ReportingScope): string | null {
  if (scope.unrestricted) return null;
  const count = scope.salonNumbers.length;
  const where = scope.areaLabel ? ` for ${scope.areaLabel}` : "";
  if (count === 0) {
    return `Your account has no salon assigned to it yet, so no salon figures are shown${where}. An administrator can set your assignment in User Management.`;
  }
  return `Scoped to your assignment${where}: ${count} ${
    count === 1 ? "salon" : "salons"
  }. Figures on this page cover only those salons.`;
}
