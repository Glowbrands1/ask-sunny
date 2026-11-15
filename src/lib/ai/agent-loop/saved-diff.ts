/**
 * ============================================================================
 * TOOLS RETURN EXACTLY WHAT WAS SAVED (rebuild plan PR 3, owner's audit, 15 Nov 2026)
 * ============================================================================
 *
 * A tool's claim about what it saved is read back from the database after the write, never from the input the model
 * sent and never from what a writer said it accepted. `savedDiff` compares the form's fields before the write and
 * after it (text, tick boxes such as the warning level and payroll, and the date alike) and lists each field that
 * really changed, with its value before and after. A field the tool was asked to write, or the reviser claimed to
 * write, that is the same after the write is `refused`, with a reason code. Pure; no reply wording lives here.
 */

export interface FormValueRow {
  readonly fieldKey: string;
  readonly value: string | null;
  readonly checked: readonly string[];
}

export interface SavedChange {
  readonly field: string;
  readonly before: string;
  readonly after: string;
}

export interface RefusedField {
  readonly field: string;
  readonly reason_code: string;
}

/** What the form holds in each field: its text, else the boxes ticked ("written", "yes"), else nothing. */
export function fieldStates(rows: readonly FormValueRow[]): Map<string, string> {
  const states = new Map<string, string>();
  for (const row of rows) {
    const text = (row.value ?? "").trim();
    states.set(row.fieldKey, text !== "" ? text : [...row.checked].sort().join(", "));
  }
  return states;
}

/** Every field whose state differs between the two reads, in the form's order (before first, then fields new after). */
export function savedDiff(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): SavedChange[] {
  const fields = [...new Set([...before.keys(), ...after.keys()])];
  return fields
    .map((field) => ({ field, before: before.get(field) ?? "", after: after.get(field) ?? "" }))
    .filter((change) => change.before !== change.after);
}

/**
 * Fields a tool claimed to write (by name) that the form does not show changed. A field the writer refused is `refused`,
 * with the writer's own code (`typed_by_manager`, `would_blank`, …), else `not_saved`. A field that already held the
 * value is not a refusal: it is `unchanged` (the writer's code `unchanged`, or no code at all with the form the same).
 */
export function refusedFields(
  claimed: readonly string[],
  saved: readonly SavedChange[],
  writerReasons: ReadonlyMap<string, string> = new Map(),
): { refused: RefusedField[]; unchanged: string[] } {
  const changed = new Set(saved.map((change) => change.field));
  const seen = new Set<string>();
  const refused: RefusedField[] = [];
  const unchanged: string[] = [];
  for (const field of claimed) {
    if (changed.has(field) || seen.has(field)) continue;
    seen.add(field);
    const reason = writerReasons.get(field);
    if (reason && reason !== "unchanged") refused.push({ field, reason_code: reason });
    else unchanged.push(field);
  }
  return { refused, unchanged };
}

/**
 * Edits in a row on one form add up: the field's first "before" and its latest "after". A field put back as it was
 * leaves the saved list and is named in `putBack` (it was changed and changed back, not saved). A different form starts again.
 */
export function mergeSaved(
  earlier: { readonly instanceId: string; readonly saved?: readonly SavedChange[]; readonly putBack?: readonly string[] } | null,
  instanceId: string,
  saved: readonly SavedChange[],
): { saved: SavedChange[]; putBack: string[] } {
  if (!earlier || earlier.instanceId !== instanceId) return { saved: [...saved], putBack: [] };
  const merged = new Map<string, SavedChange>();
  for (const change of earlier.saved ?? []) merged.set(change.field, change);
  const back = new Set(earlier.putBack ?? []);
  for (const change of saved) {
    const first = merged.get(change.field);
    merged.set(change.field, first ? { field: change.field, before: first.before, after: change.after } : change);
    back.delete(change.field);
  }
  for (const [field, change] of [...merged]) {
    if (change.before === change.after) {
      merged.delete(field);
      back.add(field);
    }
  }
  return { saved: [...merged.values()], putBack: [...back] };
}

const LABELS: Record<string, string> = {
  observation: "Observation",
  warning_type: "Type of warning",
  payroll_deduct: "Payroll deduct",
  payroll_deduct_amount: "Payroll deduction amount",
  form_date: "Date",
  incident_date: "Incident date",
  action_plan: "Action plan",
  coaching_details: "Details of coaching",
  employee_name: "Employee name",
  job_title: "Job title",
};

/** A field's name as a manager reads it. */
export function fieldLabel(field: string): string {
  if (LABELS[field]) return LABELS[field];
  const words = field.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The form's tick boxes: their ticked keys ("written", "yes") are shown capitalised. */
const TICK_BOXES = new Set(["warning_type", "payroll_deduct"]);

/** A saved value as a manager reads it: a date as M/D/YYYY, a ticked box capitalised ("Written", "Yes"), text shortened. */
export function readableValue(value: string, field = ""): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (iso) return `${Number(iso[2])}/${Number(iso[3])}/${iso[1]}`;
  if (TICK_BOXES.has(field)) return value.replace(/(^|, )([a-z])/g, (_m, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`);
  return value.length > 60 ? `${value.slice(0, 57)}...` : value;
}
