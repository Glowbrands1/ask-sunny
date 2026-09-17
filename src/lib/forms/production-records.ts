import "server-only";

import { PRODUCTION_SALONS } from "@/data/salons";

/**
 * ============================================================================
 * KEEPING NON-PRODUCTION RECORDS OFF A PRODUCTION SCREEN
 * ============================================================================
 *
 * THE FINDING THIS ANSWERS, from the 14 September review:
 *
 *   "The Overview follow-up queue includes 'Jordan Vance (test)', 'suzy
 *    sunshine', 'Ace Test', and a salon called Maple Crossing, which is not one
 *    of our 15 salons."
 *
 * Those are real rows in `form_instances`, created by real test submissions
 * against the live deployment. They are not seeded data — nothing in this
 * repository creates them — so there is no code change that makes them go away,
 * and deleting rows from a live Forms table is the wrong instrument for a
 * presentation problem: an HR record's audit trail is the thing that makes it
 * worth anything.
 *
 * ============================================================================
 * THREE MECHANISMS, IN ORDER OF PREFERENCE
 * ============================================================================
 *
 * 1. ARCHIVE, which already exists and is already honoured. Every follow-up
 *    read filters `archived_at is null`, and `manage_form_records` lets an
 *    administrator archive a filed form from Form Monitoring. Archiving is
 *    reversible, destroys nothing and keeps the record. FOR THE FOUR NAMED
 *    RECORDS THIS IS THE RIGHT ANSWER, and it is an administrator's action
 *    rather than a deployment's — see `docs/stakeholder-review-2026-09-14.md`.
 *
 * 2. THE ROSTER GUARD BELOW, which is structural and needs nobody to remember
 *    anything. A form filed against a salon that is not on the roster cannot be
 *    a production record for a salon this business operates, because the
 *    business operates those fifteen salons. "Maple Crossing" is caught by this
 *    without being named anywhere, which is the point: the next invented salon
 *    is caught too.
 *
 * 3. AN EXPLICIT, CONFIGURED EXCLUSION for anything the first two do not cover
 *    — a test employee filed against a real salon, say. It is EMPTY BY DEFAULT
 *    and read from the environment, because the alternative is a list of
 *    somebody's names compiled into the product. A name in a source file is a
 *    guess that ages badly and cannot be changed without a deploy; a name in
 *    configuration is a decision an administrator owns.
 *
 * NOTHING HERE DELETES, EDITS OR HIDES A RECORD FROM ITS OWN SCREEN. Form
 * Monitoring shows everything, which is what an administrator needs in order to
 * decide what to archive. This filters the OVERVIEW's queue, which is a
 * summary for a manager's morning and is the surface the review was reading.
 */

/** Environment variable holding the explicit exclusions. Empty by default. */
export const EXCLUDED_EMPLOYEE_NAMES_ENV = "ASK_SUNNY_EXCLUDED_EMPLOYEE_NAMES";

/** The salon names this business operates, normalized for comparison. */
function rosterNames(): Set<string> {
  return new Set(PRODUCTION_SALONS.map((location) => normalize(location.name)));
}

/** The salon IDs this business operates. */
function rosterIds(): Set<string> {
  return new Set(PRODUCTION_SALONS.map((location) => location.id));
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Names an administrator has marked as non-production, from configuration.
 *
 * Comma-separated, compared case- and whitespace-insensitively. An unset or
 * empty variable yields an empty set, which excludes nothing — the safe
 * default, because a filter that hides records nobody asked it to hide is worse
 * than one that hides none.
 */
export function configuredExcludedNames(
  env: Record<string, string | undefined> = process.env,
): Set<string> {
  const raw = env[EXCLUDED_EMPLOYEE_NAMES_ENV];
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((entry) => normalize(entry))
      .filter((entry) => entry.length > 0),
  );
}

/** The facts this filter needs from a form instance. */
export interface ProductionRecordFacts {
  readonly employeeName: string;
  readonly locationName: string | null;
  /**
   * The salon's ID, which is populated on rows where the NAME is not.
   *
   * WHY BOTH FIELDS ARE CHECKED. The roster guard originally read the name
   * only, and against the live table that catches almost nothing: of the
   * sixteen outstanding follow-ups on 14 September, thirteen carry a null
   * `location_name`. One of those — `suzy sunshine`, which the review named —
   * carries `loc-109`, a salon id from the retired twelve-store demo roster.
   * The same roster rule applied to the id catches it; applied to the name it
   * could not, because there was no name to apply it to.
   */
  readonly locationId?: string | null;
}

export type NonProductionReason =
  /** Filed against a salon this business does not operate. */
  | "salon_not_on_roster"
  /** Named in the configured exclusion list. */
  | "excluded_by_configuration";

/**
 * Why a record is not production data, or null when it is.
 *
 * A RECORD WITH NO SALON IS PRODUCTION DATA. A form can legitimately be filed
 * without one — an administrator's account covers every salon rather than one,
 * and `proposeLocation` fills in nothing for them — so treating a blank as
 * suspicious would hide an administrator's own real work.
 */
export function nonProductionReason(
  record: ProductionRecordFacts,
  options: { excludedNames?: Set<string> } = {},
): NonProductionReason | null {
  const excluded = options.excludedNames ?? configuredExcludedNames();
  if (excluded.has(normalize(record.employeeName))) {
    return "excluded_by_configuration";
  }

  if (record.locationName && !rosterNames().has(normalize(record.locationName))) {
    return "salon_not_on_roster";
  }

  /*
   * THE SAME RULE, ON THE FIELD THAT IS ACTUALLY POPULATED. A record filed
   * against a salon id this business does not operate is as much a
   * non-production record as one filed against a name it does not operate, and
   * on the live table the id is the field that survives.
   *
   * A NULL ID IS NOT AN OFFENCE. An administrator's form legitimately carries
   * no salon — see `proposeLocation` — so an absent id says nothing either way
   * and the record is kept. Only an id that is PRESENT and UNKNOWN is refused.
   */
  if (record.locationId && !rosterIds().has(record.locationId.trim())) {
    return "salon_not_on_roster";
  }

  return null;
}

/** True when a record belongs on a production summary screen. */
export function isProductionRecord(
  record: ProductionRecordFacts,
  options: { excludedNames?: Set<string> } = {},
): boolean {
  return nonProductionReason(record, options) === null;
}

/** What to tell an administrator about records this filter held back. */
export function excludedRecordsNote(count: number): string {
  return `${count} ${
    count === 1 ? "record is" : "records are"
  } filed against a salon that is not on the roster, or named in this deployment's exclusion list, so ${
    count === 1 ? "it is" : "they are"
  } not counted here. They are still in Form Monitoring, where they can be reviewed and archived.`;
}
