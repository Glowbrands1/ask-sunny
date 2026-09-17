/**
 * ============================================================================
 * THE PRODUCTION SALON ROSTER — THE ONLY ONE
 * ============================================================================
 *
 * The fifteen salons this business operates.
 *
 * ============================================================================
 * THIS FILE IS PRESENTATION METADATA. IT IS NOT THE SECURITY AUTHORITY.
 * ============================================================================
 *
 * It names salons and areas for a picker, a caption and a search result. It
 * does NOT decide who may read whose figures, and the distinction is load
 * bearing rather than stylistic.
 *
 * It used to decide. District and region scopes resolved by iterating it, and
 * that has one failure mode which fails OPEN: reporting moves a salon to a
 * different manager, nobody updates this file, and the district it LEFT keeps
 * matching it and keeps receiving its protected rows. Every other staleness
 * here hides data; that one discloses it, and no test over this file could
 * catch it, because the file stays internally consistent and simply disagrees
 * with production.
 *
 * So area membership moved to `scope/reporting-areas.ts`, which asks
 * `salon_period_attributes` — the rows the reports themselves are drawn from —
 * and fails closed on every error rather than falling back here.
 *
 * WHAT A STALE ENTRY IN THIS FILE CAN STILL DO, in full:
 *
 *   A MISSING SALON is absent from global search and the admin scope picker,
 *   and its forms are treated as non-production and kept out of the Overview
 *   queue. All three HIDE. None of them exposes another salon's figures.
 *
 *   A WRONG DISTRICT here changes a caption and a picker grouping. It does not
 *   change one row anybody can read.
 *
 *   A SALON-LEVEL SCOPE DOES NOT READ THIS FILE AT ALL. `salonNumberOf` parses
 *   the number out of the id, so the account type most likely to exist is
 *   immune to this file being wrong.
 *
 * ============================================================================
 * WHY IT MOVED OUT OF `data/demo/locations.ts`
 * ============================================================================
 *
 * It used to live beside the seeded review counts and invented coaching forms,
 * exported as `DEMO_LOCATIONS`, and production authorization imported it under
 * that name. The roster itself had been real for some time — its own header
 * said so — but the path did not, and several call sites had written comments
 * declining to trust it *because of the name*. A file that decides who may read
 * whose figures cannot be one whose path tells every reader it is fake.
 *
 * WHAT IS STILL DEMO. Everything that was ATTACHED to these salons — seeded
 * review counts, revenue, coaching forms, employee names — stays in
 * `src/data/demo` and is still invented. Only the roster moved.
 *
 * ============================================================================
 * WHERE THESE VALUES COME FROM, AND HOW THEY STAY TRUE
 * ============================================================================
 *
 * Reporting is the authority. The Reports salon picklist is built from
 * `salon_period_attributes` joined to the `salons` table (see
 * `listSalons`), and every value below was taken from that join rather than
 * typed from memory: fifteen rows, their salon numbers, their store names, and
 * their `district_label` / `region_label`.
 *
 * THE DISTRICTS ARE PEOPLE, and that is the correction that mattered most. The
 * retired file grouped the salons into invented districts — "District 1 —
 * Omaha & St Joseph", "District 2 — Lincoln & Central Nebraska" — that exist
 * nowhere in the reporting data. Production groups them by the manager who
 * runs them: Patterson, Dugan, Cotton. So a district-scoped account resolved
 * through a taxonomy that did not correspond to the business, and the salons it
 * would have admitted were not the salons that district contains. No live
 * account holds a district scope today, so nothing was mis-authorized — but
 * the first one created would have been.
 *
 * `salonRosterMatches` compares this file with a live list from reporting, and
 * `docs/salon-roster-audit.md` records what a stale roster can and cannot do.
 *
 * ============================================================================
 * WHY THIS IS STATIC CONFIGURATION RATHER THAN A QUERY
 * ============================================================================
 *
 * Authorization has to answer with no database round trip and no failure mode.
 * `authorizedSalonNumbers` runs on every reporting read and on every chat turn;
 * a query there would mean an outage could either fail the request or — far
 * worse — fall back to something permissive. A checked-in roster answers
 * instantly and fails closed.
 *
 * The cost is that it can go stale, which is why it is validated rather than
 * trusted: `salons.test.ts` checks its internal consistency, and the reporting
 * comparison above catches drift against the source.
 *
 * NO CITY IS RECORDED. The reporting source does not carry one, and inventing a
 * plausible city for a real salon is exactly the class of thing this file
 * exists to stop. `state` is read from the store name's own prefix, which is
 * the source's own convention rather than a guess.
 */

export interface ProductionSalon {
  /** `loc-0306`. The id `app_users.scope_primary_area_id` stores. */
  readonly id: string;
  /** `0306`. The key every reporting table joins on. Text, never a number. */
  readonly salonNumber: string;
  /** The store name exactly as reporting carries it. */
  readonly name: string;
  /** From the name's own prefix. `MO`, `NE`, `KS`. */
  readonly state: string;
  readonly districtId: string;
  /** `district_label` from reporting — the manager who runs it. */
  readonly districtName: string;
  readonly regionId: string;
  /** `region_label` from reporting. */
  readonly regionName: string;
}

export interface ProductionArea {
  readonly id: string;
  readonly name: string;
}

/** A district, and the region it reports into. Both from reporting's labels. */
export interface ProductionDistrict extends ProductionArea {
  readonly regionId: string;
}

const PATTERSON = "Patterson, Madeline";
const DUGAN = "Dugan, Rachael";
const COTTON = "Cotton, Sarah";

const DIST_PATTERSON = "dist-patterson-madeline";
const DIST_DUGAN = "dist-dugan-rachael";
const DIST_COTTON = "dist-cotton-sarah";
const REGION_PATTERSON = "reg-patterson-madeline";

function salon(
  salonNumber: string,
  name: string,
  districtId: string,
  districtName: string,
): ProductionSalon {
  return {
    id: `loc-${salonNumber}`,
    salonNumber,
    name,
    // The source's own prefix convention: `MO Kansas City Wornall`.
    state: name.slice(0, 2),
    districtId,
    districtName,
    regionId: REGION_PATTERSON,
    regionName: PATTERSON,
  };
}

/** The fifteen, in salon-number order, as reporting lists them. */
export const PRODUCTION_SALONS: readonly ProductionSalon[] = [
  salon("0306", "MO Kansas City Wornall", DIST_PATTERSON, PATTERSON),
  salon("0307", "NE Grand Island", DIST_DUGAN, DUGAN),
  salon("0309", "NE Kearney", DIST_DUGAN, DUGAN),
  salon("0310", "NE Lincoln 27th Street", DIST_DUGAN, DUGAN),
  salon("0311", "NE Lincoln O Street", DIST_DUGAN, DUGAN),
  salon("0312", "NE Lincoln Pine Lake", DIST_DUGAN, DUGAN),
  salon("0313", "NE Omaha 132nd and Maple", DIST_COTTON, COTTON),
  salon("0314", "NE Omaha 144th and Center", DIST_COTTON, COTTON),
  salon("0394", "MO Kansas City Liberty", DIST_PATTERSON, PATTERSON),
  salon("0410", "NE Omaha Pacific", DIST_COTTON, COTTON),
  salon("0462", "KS Manhattan", DIST_PATTERSON, PATTERSON),
  salon("0463", "KS Shawnee Mission Pkwy", DIST_PATTERSON, PATTERSON),
  salon("0468", "KS Lawrence", DIST_PATTERSON, PATTERSON),
  salon("0476", "KS Overland Park", DIST_PATTERSON, PATTERSON),
  salon("0495", "MO St Joseph", DIST_COTTON, COTTON),
];

/*
 * ALL THREE REPORT INTO ONE REGION, which is what reporting says: every row's
 * `region_label` is the same name. A second region would arrive as data rather
 * than as a code change.
 */
export const PRODUCTION_DISTRICTS: readonly ProductionDistrict[] = [
  { id: DIST_COTTON, name: COTTON, regionId: REGION_PATTERSON },
  { id: DIST_DUGAN, name: DUGAN, regionId: REGION_PATTERSON },
  { id: DIST_PATTERSON, name: PATTERSON, regionId: REGION_PATTERSON },
];

export const PRODUCTION_REGIONS: readonly ProductionArea[] = [
  { id: REGION_PATTERSON, name: PATTERSON },
];

export function salonById(id: string): ProductionSalon | undefined {
  return PRODUCTION_SALONS.find((entry) => entry.id === id);
}

export function salonByNumber(salonNumber: string): ProductionSalon | undefined {
  return PRODUCTION_SALONS.find((entry) => entry.salonNumber === salonNumber);
}

/**
 * An area's own name, for a sentence telling somebody what they are seeing.
 *
 * Returns the id unchanged when nothing matches, because the callers that want
 * a softer failure have their own. See `scopeAreaLabel`, which returns null so
 * it can fall back rather than print `dist-9` at a Salon Director.
 */
export function areaLabel(areaId: string | null): string {
  if (!areaId) return "All areas";
  return (
    salonById(areaId)?.name ??
    PRODUCTION_DISTRICTS.find((entry) => entry.id === areaId)?.name ??
    PRODUCTION_REGIONS.find((entry) => entry.id === areaId)?.name ??
    areaId
  );
}

/**
 * Whether this roster still agrees with what reporting holds.
 *
 * THE POINT OF A CHECKED-IN ROSTER IS THAT IT ANSWERS INSTANTLY; the cost is
 * that it can drift. This is how the drift is caught — hand it the salon
 * numbers a reporting read returned and it names what is missing on each side.
 *
 * Deliberately NOT called from the authorization path. A roster that is stale
 * must keep answering, because failing every request is worse than admitting a
 * closed salon; this is for a health surface and for tests.
 */
export function salonRosterMatches(reportingSalonNumbers: readonly string[]): {
  readonly matches: boolean;
  readonly missingFromRoster: readonly string[];
  readonly missingFromReporting: readonly string[];
} {
  const roster = new Set(PRODUCTION_SALONS.map((entry) => entry.salonNumber));
  const reporting = new Set(reportingSalonNumbers);

  const missingFromRoster = [...reporting].filter((number) => !roster.has(number)).sort();
  const missingFromReporting = [...roster].filter((number) => !reporting.has(number)).sort();

  return {
    matches: missingFromRoster.length === 0 && missingFromReporting.length === 0,
    missingFromRoster,
    missingFromReporting,
  };
}
