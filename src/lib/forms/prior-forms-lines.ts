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
  /** The `warning_type` ticks of each Corrective Action, by instance id. */
  warningLevels: ReadonlyMap<string, readonly string[]>;
}): PriorFormOnFile[] {
  const who = nameKey(input.employeeName);
  if (who === "") return [];

  return input.rows
    .filter(
      (row) =>
        row.id !== input.excludeInstanceId &&
        row.status === "finalized" &&
        HISTORY_TEMPLATES.has(row.templateKey) &&
        nameKey(row.employeeName) === who &&
        /^\d{4}-\d{2}-\d{2}$/.test(row.formDate),
    )
    .sort((a, b) => a.formDate.localeCompare(b.formDate))
    .map((row) => {
      const level = (input.warningLevels.get(row.id) ?? []).find((key) => key in CORRECTIVE_STEP);
      const step =
        row.templateKey === "coaching" ? "Coaching" : level ? CORRECTIVE_STEP[level]! : "Corrective action";
      return {
        instanceId: row.id,
        templateKey: row.templateKey,
        formDate: row.formDate,
        line: priorActionLine(step, row.formDate),
      };
    });
}
