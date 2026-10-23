/**
 * A show-or-edit that must keep what the draft already holds.
 *
 * "Show draft with edits" merges. An empty Type of Offense or an empty
 * Action Plan is not an edit, so it is not written over a value the form
 * already has. A manager who names the field and asks to clear it still can.
 */

const PRESERVED = [
  { key: "offense_type", label: "offense" },
  { key: "action_plan", label: "action plan" },
  { key: "plan_of_action", label: "action plan" },
] as const;

export function showDraftWithEdits(question: string): boolean {
  return /\bshow\b/i.test(question) && /\bwith\s+edits\b/i.test(question);
}

export function asksToClearField(question: string, label: string): boolean {
  const words = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const clear = "(?:remove|clear|blank|delete|empty)";
  return new RegExp(`\\b${clear}\\b[^.]{0,48}\\b${words}\\b`, "i").test(question)
    || new RegExp(`\\b${words}\\b[^.]{0,48}\\b${clear}\\b`, "i").test(question);
}

export function retainFilledFields(input: {
  readonly question: string;
  readonly existing: readonly { fieldKey: string; value: string | null; checked: readonly string[] }[];
  readonly values: Record<string, string>;
  readonly checked: Record<string, string[]>;
}): { values: Record<string, string>; checked: Record<string, string[]> } {
  const values = { ...input.values };
  const checked = { ...input.checked };
  for (const field of PRESERVED) {
    if (asksToClearField(input.question, field.label)) continue;
    const held = input.existing.find((row) => row.fieldKey === field.key);
    const heldValue = (held?.value ?? "").trim();
    const heldChecked = held?.checked ?? [];
    if (field.key in values && values[field.key]!.trim() === "" && heldValue !== "") {
      delete values[field.key];
    }
    if (field.key in checked && checked[field.key]!.length === 0 && heldChecked.length > 0) {
      delete checked[field.key];
    }
    if (!(field.key in values) && heldValue !== "" && field.key === "action_plan") {
      // Absent is a merge: the stored plan stays. Nothing is written.
    }
  }
  return { values, checked };
}

/**
 * Fields a merge wiped. An empty Type of Offense or Action Plan is put back
 * unless the manager asked to clear that field. A real edit that wrote new
 * text is left as written.
 */
export function fieldsToRestore(input: {
  readonly question: string;
  readonly before: readonly { fieldKey: string; value: string | null; checked: readonly string[] }[];
  readonly after: readonly { fieldKey: string; value: string | null; checked: readonly string[] }[];
}): { values: Record<string, string>; checked: Record<string, string[]> } {
  const values: Record<string, string> = {};
  const checked: Record<string, string[]> = {};
  for (const field of PRESERVED) {
    if (asksToClearField(input.question, field.label)) continue;
    const held = input.before.find((row) => row.fieldKey === field.key);
    const now = input.after.find((row) => row.fieldKey === field.key);
    const heldValue = (held?.value ?? "").trim();
    const nowValue = (now?.value ?? "").trim();
    const heldChecked = held?.checked ?? [];
    const nowChecked = now?.checked ?? [];
    if (heldValue !== "" && nowValue === "") values[field.key] = held!.value!;
    if (heldChecked.length > 0 && nowChecked.length === 0) checked[field.key] = [...heldChecked];
  }
  return { values, checked };
}
