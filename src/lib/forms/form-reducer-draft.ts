import "server-only";

import { businessToday } from "@/lib/business-date";

import { fixedActionPlanKey } from "./ca-action-plan";
import { syncCorrectiveActionPlan } from "./ca-action-plan-sync";
import { blocksForVariant, checkboxGroupsForVariant, parseFormDocument, type FormField } from "./document";
import { datesInText } from "./form-date-answer";
import {
  applyPatch,
  diffDrafts,
  draftFromRows,
  fold,
  wordsOf,
  type CheckboxGroup,
  type FieldValue,
  type FormDiff,
  type FormDraft,
  type PatchRules,
} from "./form-reducer";
import { loadInstance, type LoadedInstance } from "./instances";
import { PAYROLL_DEDUCT_KEY } from "./payroll-deduct";
import { PAYROLL_AMOUNT_KEY } from "./payroll-amount-field";
import { DERIVED_POLICY_FIELD_KEYS } from "./policy-fields";
import { NO_PRIOR_ACTION, PRIOR_ACTIONS_KEY } from "./prior-actions";
import { draftableCheckboxGroups, draftableFields } from "./responsibility";
import type { DraftValues } from "./responsibility";

/**
 * ============================================================================
 * THE DRAFT ROUTE'S WRITE, THROUGH THE REDUCER (FORM_PATCH_REDUCER_ENABLED)
 * ============================================================================
 *
 * Step B. The drafting route builds its draft exactly as before; with the
 * flag on, what reaches `applyAssistantDraft` is decided here: the form is
 * read again, the draft's values become a patch, and `applyPatch` in draft
 * mode merges it — a manager-typed field kept, an assistant field replaced, a
 * key the draft leaves out left alone, nothing blanked, Prior Actions united
 * line by line. Only what changes is written.
 *
 * Keys the reducer does not own — the derived policy lines, the
 * policy-grounded quotation and the Action Plan code builds — keep the route's
 * own decision and are passed through as the route made them.
 *
 * Every rule comes from the template and the saved rows; nothing is matched on
 * words.
 */

/** The payroll answer and its amount: written only as the manager stated them. */
export const MANAGER_STATED_KEYS: ReadonlySet<string> = new Set([PAYROLL_DEDUCT_KEY, PAYROLL_AMOUNT_KEY]);

export interface TemplateRules {
  /** The reducer's writable keys: AI fields and groups minus derived, policy-grounded and code-built ones. */
  readonly writable: ReadonlySet<string>;
  readonly dateKeys: ReadonlySet<string>;
  readonly checkboxGroups: Readonly<Record<string, CheckboxGroup>>;
  /** Every checkbox group on the version, manager's included. */
  readonly allGroups: ReadonlySet<string>;
}

/** The reducer's rules for this form, from its template version only. */
export function templateRules(loaded: LoadedInstance): TemplateRules {
  const document = parseFormDocument(loaded.version.document);
  const variantKey = loaded.instance.variantKey;
  const plan = fixedActionPlanKey(loaded.instance.templateKey, document, variantKey);
  const fields = draftableFields(document, variantKey).filter(
    (field) => !DERIVED_POLICY_FIELD_KEYS.has(field.key) && !field.policyGrounded && field.key !== plan?.key,
  );
  const groups = draftableCheckboxGroups(document, variantKey).filter((group) => !DERIVED_POLICY_FIELD_KEYS.has(group.key));
  return {
    writable: new Set([...fields.map((field) => field.key), ...groups.map((group) => group.key)]),
    dateKeys: new Set(fields.filter((field) => field.input === "date").map((field) => field.key)),
    checkboxGroups: Object.fromEntries(
      groups.map((group) => [group.key, { options: group.options.map((option) => option.key), single: group.single === true }]),
    ),
    allGroups: new Set(checkboxGroupsForVariant(document, variantKey).map((group) => group.key)),
  };
}

/** The ISO dates a text states, read by the app's one date reader. */
export function statedDates(today: string): (text: string) => string[] {
  return (text) => datesInText(text, today).map((date) => date.iso);
}

function asText(value: FieldValue): string {
  return typeof value === "string" ? value : value.join("\n");
}

function asOptions(value: FieldValue): string[] {
  return typeof value === "string" ? (value.trim() === "" ? [] : [value.trim()]) : [...value];
}

/** Payroll deduct is Yes and an amount is on the form. */
export function payrollYesWithAmount(draft: FormDraft): boolean {
  const answer = draft[PAYROLL_DEDUCT_KEY]?.value;
  const amount = draft[PAYROLL_AMOUNT_KEY]?.value;
  return answer !== undefined && asOptions(answer).includes("yes") && amount !== undefined && asText(amount).trim() !== "";
}

/**
 * A drafted text that only restates who the form is about: the employee's
 * position, with the salon or the name (QA's live test, 3 Nov 2026, both apps:
 * "<position> at <salon>" written as the Other topic). Read from the form's own
 * header — the instance's columns and its Job Title, Location and Name rows,
 * which come from the roster — never from a word list: every word of the
 * value is a header word but at most one joining word, and it names the
 * position (its whole text, or a word of it together with a word of the
 * salon or the name).
 */
export function restatesHeader(value: string, loaded: LoadedInstance): boolean {
  const row = (key: string) => loaded.values.find((entry) => entry.fieldKey === key)?.value ?? "";
  const role = [loaded.instance.employeeRole ?? "", row("job_title")].join(" ");
  const place = [loaded.instance.locationName ?? "", row("location"), loaded.instance.employeeName, row("employee_name")].join(" ");
  const roleWords = new Set(wordsOf(role));
  const placeWords = new Set(wordsOf(place));
  const words = wordsOf(value);
  if (words.length === 0 || roleWords.size === 0) return false;
  const wholeRole = [loaded.instance.employeeRole ?? "", row("job_title")].some((text) => text.trim() !== "" && fold(value) === fold(text));
  const other = words.filter((word) => !roleWords.has(word) && !placeWords.has(word));
  const namesRole = words.some((word) => roleWords.has(word));
  const namesPlace = words.some((word) => placeWords.has(word) && !roleWords.has(word));
  return wholeRole || (other.length <= 1 && namesRole && namesPlace);
}

/**
 * The write-in line of a checkbox option, from the template's own layout: a
 * field placed directly after a checkbox group, whose label is the label of
 * one of that group's options ("Other" beside the "Other" box). Field key →
 * the group and the option. No key or word is named here.
 */
export function writeInsOf(loaded: LoadedInstance): Map<string, { group: string; option: string }> {
  const blocks = blocksForVariant(parseFormDocument(loaded.version.document), loaded.instance.variantKey);
  const found = new Map<string, { group: string; option: string }>();
  blocks.forEach((block, index) => {
    if (block.kind !== "checkbox_group") return;
    const next = blocks[index + 1];
    const fields: FormField[] = next?.kind === "field" ? [next.field] : next?.kind === "field_row" ? next.fields : [];
    for (const field of fields) {
      const option = block.options.find((entry) => fold(entry.label) === fold(field.label));
      if (option) found.set(field.key, { group: block.key, option: option.key });
    }
  });
  return found;
}

export interface ReducedDraftWrite {
  /** What `applyAssistantDraft` writes: the changed reducer keys, and the route's own keys as it made them. */
  readonly write: DraftValues;
  /** What the reducer changed and refused, before the write. */
  readonly diff: FormDiff;
  /**
   * After the write: the Action Plan's payroll sentence through the existing
   * `syncCorrectiveActionPlan` when payroll is Yes with an amount, then the
   * realized diff — the form read again, before against after.
   */
  settle(): Promise<FormDiff>;
}

export async function reduceDraftWrite(input: {
  readonly id: string;
  readonly values: Record<string, string>;
  readonly checked: Record<string, string[]>;
  /** Keys a draft may replace although the manager typed them (a citable policy line). */
  readonly typedExempt: ReadonlySet<string>;
  readonly notes: string;
  readonly actorId: string;
}): Promise<ReducedDraftWrite | null> {
  const loaded = await loadInstance(input.id);
  if (!loaded || loaded.instance.status !== "draft") return null;
  const template = templateRules(loaded);
  const before = draftFromRows(loaded.values);

  const set: Record<string, FieldValue> = {};
  const passValues: Record<string, string> = {};
  const passChecked: Record<string, string[]> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(input.values)) {
    // The employee's position and salon are the header's, never a drafted field's text.
    if (template.writable.has(key) && restatesHeader(value, loaded)) {
      dropped.push(key);
      continue;
    }
    if (template.writable.has(key)) set[key] = value;
    else passValues[key] = value;
  }
  for (const [key, options] of Object.entries(input.checked)) {
    if (template.writable.has(key)) set[key] = options;
    else passChecked[key] = options;
  }
  /* A write-in left out takes its box with it: "Other" is not ticked with nothing beside it. */
  const writeIns = writeInsOf(loaded);
  for (const key of dropped) {
    const box = writeIns.get(key);
    const ticked = box ? set[box.group] : undefined;
    if (box && ticked !== undefined && typeof ticked !== "string") set[box.group] = ticked.filter((option) => option !== box.option);
  }

  const rules: PatchRules = {
    mode: "draft",
    writable: template.writable,
    typedExempt: input.typedExempt,
    dateKeys: template.dateKeys,
    datesIn: statedDates(businessToday()),
    checkboxGroups: template.checkboxGroups,
    listKeys: new Set([PRIOR_ACTIONS_KEY]),
    listNone: NO_PRIOR_ACTION,
    // What the manager said: a date is written only if they stated it (the notes are their turns, one per line).
    sources: {
      manager: input.notes,
      managerTurns: input.notes.split("\n").map((line) => line.trim()).filter((line) => line !== ""),
    },
  };
  const { diff } = applyPatch(before, { set, clear: [] }, rules);

  const write: DraftValues = { values: { ...passValues }, checked: { ...passChecked } };
  for (const change of diff.changed) {
    if (template.allGroups.has(change.key)) write.checked[change.key] = asOptions(change.after);
    else write.values[change.key] = asText(change.after);
  }

  return {
    write,
    diff,
    async settle() {
      const written = await loadInstance(input.id);
      if (!written) return diff;
      if (payrollYesWithAmount(draftFromRows(written.values))) {
        await syncCorrectiveActionPlan(input.id, input.actorId, { amountSentence: true, notes: input.notes });
      }
      const after = await loadInstance(input.id);
      return { changed: diffDrafts(before, draftFromRows((after ?? written).values)), refused: diff.refused };
    },
  };
}
