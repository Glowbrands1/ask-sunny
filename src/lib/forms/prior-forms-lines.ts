import { priorActionLine } from "./prior-actions";

/**
 * The pure half of `prior-forms.ts`: which rows count as the employee's
 * history, and the line each one becomes on the Corrective Action Form's
 * "List previously received coaching and/or corrective action with date
 * signed". Browser-safe, so the chat read-back and the draft print the same
 * words.
 */

export interface PriorFormOnFile {
  readonly instanceId: string;
  readonly templateKey: string;
  /** `YYYY-MM-DD`, the date on the form. */
  readonly formDate: string;
  /** As it goes on the list: "Verbal corrective action — signed 09/21/2026". */
  readonly line: string;
  /** Where the form was filed, so a possible match can say which salon it is from. */
  readonly locationId: string | null;
  readonly locationName: string | null;
}

/** The templates whose finalized forms are history on a Corrective Action. */
const HISTORY_TEMPLATES = new Set(["coaching", "dpoa"]);

/** The Corrective Action's ticked level, as the list names it. */
const CORRECTIVE_STEP: Record<string, string> = {
  verbal: "Verbal corrective action",
  written: "Written corrective action",
  termination: "Termination",
  demotion: "Demotion",
};

interface HistoryRow {
  readonly id: string;
  readonly templateKey: string;
  readonly employeeName: string;
  readonly status: string;
  readonly formDate: string;
  readonly locationId?: string | null;
  readonly locationName?: string | null;
}

function nameKey(name: string): string {
  return name
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)
    .join(" ");
}

/**
 * The employee's finalized Coaching and Corrective Action forms, oldest first,
 * each as its line on the list.
 *
 * WORD FOR WORD ON THE NAME. "Paisley Peklo" is not "Paisley Smith", and a
 * history line on the wrong person's disciplinary record is the one mistake
 * this list cannot be allowed to make — so a partial match is no match.
 */
export function priorFormsFromRows(input: {
  rows: readonly HistoryRow[];
  employeeName: string;
  excludeInstanceId?: string;
  /**
   * The date of the form being drafted. A form dated after it is not
   * "previously received" (QA F-11, 22 Oct 2026), so it is left off.
   */
  before?: string;
  /** The `warning_type` ticks of each Corrective Action, by instance id. */
  warningLevels: ReadonlyMap<string, readonly string[]>;
}): PriorFormOnFile[] {
  const who = nameKey(input.employeeName);
  if (who === "") return [];
  const before = input.before && /^\d{4}-\d{2}-\d{2}$/.test(input.before) ? input.before : null;

  return input.rows
    .filter(
      (row) =>
        row.id !== input.excludeInstanceId &&
        row.status === "finalized" &&
        HISTORY_TEMPLATES.has(row.templateKey) &&
        nameKey(row.employeeName) === who &&
        /^\d{4}-\d{2}-\d{2}$/.test(row.formDate) &&
        (before === null || row.formDate <= before),
    )
    // Oldest first; on the same day the ladder's order — the coaching before
    // the corrective action — so the list reads the same however it was read.
    .sort(
      (a, b) =>
        a.formDate.localeCompare(b.formDate) ||
        Number(a.templateKey !== "coaching") - Number(b.templateKey !== "coaching") ||
        a.id.localeCompare(b.id),
    )
    .map((row) => {
      const level = (input.warningLevels.get(row.id) ?? []).find((key) => key in CORRECTIVE_STEP);
      const step =
        row.templateKey === "coaching" ? "Coaching" : level ? CORRECTIVE_STEP[level]! : "Corrective action";
      return {
        instanceId: row.id,
        templateKey: row.templateKey,
        formDate: row.formDate,
        line: priorActionLine(step, row.formDate),
        locationId: row.locationId ?? null,
        locationName: row.locationName ?? null,
      };
    });
}

/*
 * ============================================================================
 * A NAME IS NOT AN IDENTITY
 * ============================================================================
 *
 * QA, 22 Oct 2026 (F-11): forms carry the employee's NAME and a location, never
 * a person id, and the list was matched on the name alone across every salon
 * the manager can see — so a district manager drafting for one "Dana Moss"
 * could have another Dana Moss's Verbal CA written onto the form as history.
 *
 * A record on file is attached to the form only when the name can mean one
 * person: a full name (two words or more), the form being drafted has a salon,
 * every same-name form the manager can see is at THAT salon, and the read was
 * complete. Anything else is a POSSIBLE match — shown to the manager with its
 * salon to confirm, never written for them. Nothing on file is ever changed.
 */
export type PriorFormsIdentity =
  | "unambiguous"
  | "none"
  | "single_word_name"
  | "no_form_location"
  | "other_locations"
  | "incomplete";

export interface PriorFormsReading {
  /** Safe to write onto the form being drafted. */
  readonly attach: readonly PriorFormOnFile[];
  /** Same name, identity not established: for the manager to confirm. Never written. */
  readonly possible: readonly PriorFormOnFile[];
  readonly identity: PriorFormsIdentity;
}

export function classifyPriorForms(input: {
  /** The history lines `priorFormsFromRows` produced. */
  forms: readonly PriorFormOnFile[];
  employeeName: string;
  /** The salon on the form being drafted. */
  locationId: string | null;
  /**
   * Every location (null for none) at which the manager can see ANY form —
   * any template, any status — for exactly this name. Another salon here means
   * the name may be two people.
   */
  sameNameLocations: readonly (string | null)[];
  /** False when the read may have stopped before the oldest forms. */
  complete: boolean;
}): PriorFormsReading {
  const { forms } = input;
  if (forms.length === 0) return { attach: [], possible: [], identity: "none" };
  const possible = (identity: PriorFormsIdentity): PriorFormsReading => ({ attach: [], possible: forms, identity });
  if (nameKey(input.employeeName).split(" ").length < 2) return possible("single_word_name");
  if (!input.complete) return possible("incomplete");
  if (!input.locationId) return possible("no_form_location");
  const elsewhere = [...input.sameNameLocations, ...forms.map((form) => form.locationId)].some(
    (location) => location !== input.locationId,
  );
  if (elsewhere) return possible("other_locations");
  return { attach: forms, possible: [], identity: "unambiguous" };
}

/** Whether a row is a form for exactly this name (the same word-for-word rule). */
export function sameName(rowName: string, employeeName: string): boolean {
  const who = nameKey(employeeName);
  return who !== "" && nameKey(rowName) === who;
}
