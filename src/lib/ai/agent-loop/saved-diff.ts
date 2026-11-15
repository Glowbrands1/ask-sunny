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
 * Fields a tool claimed to write (by name) that the form does not show changed: refused, with the writer's own code when
 * it gave one (`typed_by_manager`, `unchanged`, …), else `not_saved`.
 */
export function refusedFields(
  claimed: readonly string[],
  saved: readonly SavedChange[],
  writerReasons: ReadonlyMap<string, string> = new Map(),
): RefusedField[] {
  const changed = new Set(saved.map((change) => change.field));
  const seen = new Set<string>();
  return claimed
    .filter((field) => {
      if (changed.has(field) || seen.has(field)) return false;
      seen.add(field);
      return true;
    })
    .map((field) => ({ field, reason_code: writerReasons.get(field) ?? "not_saved" }));
}

/**
 * Edits in a row on one form add up: the field's first "before" and its latest "after" (a field put back as it was
 * drops out). A different form starts again.
 */
export function mergeSaved(
  earlier: { readonly instanceId: string; readonly saved?: readonly SavedChange[] } | null,
  instanceId: string,
  saved: readonly SavedChange[],
): SavedChange[] {
  if (!earlier || earlier.instanceId !== instanceId) return [...saved];
  const merged = new Map<string, SavedChange>();
  for (const change of earlier.saved ?? []) merged.set(change.field, change);
  for (const change of saved) {
    const first = merged.get(change.field);
    merged.set(change.field, first ? { field: change.field, before: first.before, after: change.after } : change);
  }
  return [...merged.values()].filter((change) => change.before !== change.after);
}
