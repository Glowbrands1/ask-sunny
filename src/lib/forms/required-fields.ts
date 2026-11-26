import {
  blocksForVariant,
  fieldsForVariant,
  interpolate,
  numberedListLines,
  type FieldResponsibility,
  type FormDocument,
  type FormVariant,
} from "./document";

/**
 * ============================================================================
 * REQUIRED FIELDS (HR via Pau, 19 Nov 2026)
 * ============================================================================
 *
 * A field the version marks `required` must hold a value before the form is
 * finalized — the two history boxes on the Corrective Action Form. A DRAFT may
 * stay blank while the manager works on it; only Finalize refuses. Read from
 * the stored values, so neither the model nor a stale screen can skip it.
 * Versions published without the mark keep filing with the field optional.
 * Pure and browser-safe.
 */
export const REQUIRED_FIELDS_BLANK = "required_fields_blank";

export interface RequiredFieldRow {
  readonly fieldKey: string;
  readonly value: string | null;
}

export function blankRequiredFields(
  document: FormDocument,
  variantKey: string | null,
  values: readonly RequiredFieldRow[],
): { key: string; label: string }[] {
  const rows = new Map(values.map((row) => [row.fieldKey, row.value ?? ""]));
  return fieldsForVariant(document, variantKey)
    .filter((field) => field.required === true)
    .filter((field) => (rows.get(field.key) ?? "").trim() === "")
    .map((field) => ({ key: field.key, label: field.label }));
}

export function requiredFieldsMessage(blank: readonly { label: string }[]): string {
  const names = blank.map((field) => `"${field.label}"`).join(" and ");
  return `${names} ${blank.length === 1 ? "is" : "are"} required. Fill ${blank.length === 1 ? "it" : "them"} in before finalizing this form.`;
}

/**
 * ============================================================================
 * EVERY FIELD BEFORE APPROVAL (Pau, 25 Nov 2026; ALL_FIELDS_REQUIRED_ENABLED)
 * ============================================================================
 *
 * "Can you please update all forms so that they cannot submit for approval if
 * all field are not filled out? … signature is not required for approval, we
 * do it by hand in person." With the flag on, Finalize and "Finalize and send
 * for approval" refuse a form while anything the form's creator fills is
 * blank: every line, at least one tick in every tick list, every line of a
 * numbered list, a mark on every expectation row and a plan on every objective
 * row. Like `required`, it is checked on the stored values, so neither the
 * model nor a stale screen can skip it, and a draft may stay blank while it is
 * worked on. Unlike `required`, it is the CODE's rule rather than a mark on a
 * version, so it reaches every published version and every form already open.
 *
 * WHAT IS NOT ASKED FOR, from the audit of every form (`docs/all-fields-required-audit.md`):
 *
 *   signatures, and lines FILLED BY HAND or written by the EMPLOYEE — they are
 *   done on paper, in person (the app refuses to save a hand-filled line);
 *   the Re-Evaluation section, which is filled at the re-evaluation, not when
 *   the plan is issued (it is asked for on a re-evaluation);
 *   a line that only applies after another answer (`REQUIRED_WHEN`);
 *   a line the form itself calls optional, or a tick list where no tick is
 *   itself the answer (`NOT_REQUIRED`).
 *
 * A field a version marks `required` is always asked for. The Corrective
 * Action's history box never blocks: it is written "N/A" when nothing is listed
 * (`NO_PRIOR_ACTIONS_FOUND`, `instances.ts` fillNoPriorActionsFound).
 */
export interface BlankPart {
  readonly key: string;
  readonly label: string;
}

export interface SubmissionRow extends RequiredFieldRow {
  readonly checked?: readonly string[];
}

/** Who fills a line the form's creator is not asked for: the employee or a pen, in person. */
const FILLED_IN_PERSON: ReadonlySet<FieldResponsibility> = new Set(["manual", "employee", "signature"]);

/**
 * A line asked for only once another answer makes it apply: `anyOf` — one of
 * these options is ticked in `group`; `noneOf` — none of them is.
 */
export const REQUIRED_WHEN: Readonly<
  Record<string, { readonly group: string; readonly anyOf?: readonly string[]; readonly noneOf?: readonly string[] }>
> = {
  // Coaching Form: the Other line, when Other is a topic.
  other_topic: { group: "coaching_topics", anyOf: ["other"] },
  // Corrective Action: the amount, when payroll deduct is Yes.
  payroll_deduct_amount: { group: "payroll_deduct", anyOf: ["yes"] },
  // Exit form: the two notice dates, when notice was submitted and fulfilled …
  notice_given_date: { group: "resignation_notice", anyOf: ["submitted_fulfilled_notice"] },
  notice_fulfilled_date: { group: "resignation_notice", anyOf: ["submitted_fulfilled_notice"] },
  // … and otherwise one of the immediate / not-fulfilled / no call no show boxes.
  resignation_type: { group: "resignation_notice", noneOf: ["submitted_fulfilled_notice"] },
};

/**
 * Never asked for, and why. Keyed by field or group key, which both apps' forms
 * share.
 */
export const NOT_REQUIRED: Readonly<Record<string, string>> = {
  new_location: 'the form says "if applicable"',
  // Exit form: ticked only when notice was submitted and fulfilled; otherwise resignation_type answers.
  resignation_notice: "no tick is an answer: resignation_type is asked for instead",
  // Interview forms: tick what was seen; a candidate may show none of them.
  qualities_observed: "no tick is an answer: none of these qualities were seen",
  walkthrough_qualities_observed: "no tick is an answer: none of these qualities were seen",
  walkthrough_observed: "the column is ✔ / X: an unticked line is the X",
  // Exit form (Pau, 25 Nov 2026: "Exit form 'Additional Details' is required. Should it be optional? - yes").
  details: 'optional on the exit form (Pau, 25 Nov 2026): "Additional Details"',
  // EPPs: the draft-details appendix, "not part of the official form pages"; blank when no manual section applies.
  policy_references: "the appendix's policy line is left blank when no section of the manual applies",
};

/**
 * "<metric> figures, as provided": the figures as the manager pasted them, beside
 * the form's own figure lines. Asked for only on a form with no figure lines.
 */
const AS_PROVIDED_BESIDE: Readonly<Record<string, readonly string[]>> = {
  salon_productivity: ["salon_ppta"],
  employee_productivity: ["employee_ppta", "manager_ppta"],
};

function isReEvaluationSection(label: string): boolean {
  return /re-?\s*evaluation/i.test(label);
}

/**
 * Everything the form's creator must still fill before the form is finalized
 * or sent for approval, in the order the form prints it.
 */
export function blankBeforeSubmission(
  document: FormDocument,
  variantKey: string | null,
  values: readonly SubmissionRow[],
  options: { readonly reEvaluation?: boolean; readonly variant?: FormVariant | null } = {},
): BlankPart[] {
  const text = new Map(values.map((row) => [row.fieldKey, (row.value ?? "").trim()]));
  const ticks = new Map(values.map((row) => [row.fieldKey, row.checked ?? []]));
  const filled = (key: string) => (text.get(key) ?? "") !== "";
  const ticked = (key: string) => (ticks.get(key) ?? []).length > 0;
  const keysOnForm = new Set<string>();
  for (const block of blocksForVariant(document, variantKey)) {
    if (block.kind === "field") keysOnForm.add(block.field.key);
    else if (block.kind === "field_row") for (const field of block.fields) keysOnForm.add(field.key);
    else if (block.kind === "checkbox_group") keysOnForm.add(block.key);
  }
  const applies = (key: string): boolean => {
    if (NOT_REQUIRED[key] !== undefined) return false;
    const beside = AS_PROVIDED_BESIDE[key];
    if (beside && beside.some((other) => keysOnForm.has(other))) return false;
    const when = REQUIRED_WHEN[key];
    if (!when || !keysOnForm.has(when.group)) return true;
    const chosen = ticks.get(when.group) ?? [];
    if (when.anyOf && !when.anyOf.some((option) => chosen.includes(option))) return false;
    if (when.noneOf && when.noneOf.some((option) => chosen.includes(option))) return false;
    return true;
  };
  const label = (raw: string | undefined, fallback: string) =>
    interpolate((raw ?? "").trim() || fallback, options.variant ?? null);

  const blank: (BlankPart & { section: string })[] = [];
  let section = "";
  let reEvaluation = false;
  // The interview forms call every answer "Notes", under the question the form prints above it.
  let question = "";
  const fieldLabel = (raw: string) => {
    if (raw.trim().toLowerCase() !== "notes" || question === "") return label(raw, section);
    const asked = interpolate(question, options.variant ?? null).replace(/\s+/g, " ").trim();
    return `Notes — ${asked.length > 60 ? `${asked.slice(0, 57).trimEnd()}…` : asked}`;
  };
  const asked = (responsibility: FieldResponsibility, key: string, required?: true) =>
    required === true ||
    (!FILLED_IN_PERSON.has(responsibility) && (!reEvaluation || options.reEvaluation === true) && applies(key));

  for (const block of blocksForVariant(document, variantKey)) {
    if (block.kind === "section") {
      section = block.label;
      reEvaluation = isReEvaluationSection(block.label);
      question = "";
      continue;
    }
    if (block.kind === "paragraph") {
      question = block.text;
      continue;
    }
    if (block.kind === "field" || block.kind === "field_row") {
      for (const field of block.kind === "field" ? [block.field] : block.fields) {
        if (asked(field.responsibility, field.key, field.required) && !filled(field.key)) {
          blank.push({ key: field.key, label: fieldLabel(field.label), section });
        }
      }
    } else if (block.kind === "checkbox_group") {
      if (asked(block.responsibility, block.key) && !ticked(block.key)) {
        blank.push({ key: block.key, label: label(block.label, section), section });
      }
    } else if (block.kind === "numbered_list") {
      if (!asked(block.responsibility, block.key)) continue;
      const lines = numberedListLines(text.get(block.key), block.count);
      if (lines.some((line) => line.trim() === "")) blank.push({ key: block.key, label: label(block.label, section), section });
    } else if (block.kind === "expectation_checklist") {
      if (!asked(block.responsibility, block.successKey)) continue;
      const marked = new Set([...(ticks.get(block.successKey) ?? []), ...(ticks.get(block.improvementKey) ?? [])]);
      if (block.options.some((option) => !marked.has(option.key))) {
        blank.push({ key: block.successKey, label: label(block.label, section), section });
      }
    } else if (block.kind === "objective_rows") {
      for (const row of block.rows) {
        if (asked(block.responsibility, row.key) && !filled(row.key)) {
          blank.push({ key: row.key, label: label(`${block.planLabel} — ${row.category}`, section), section });
        }
      }
    }
  }
  // A label the form prints twice ("PPTA" for the salon and for the person) is named with its section.
  const seen = new Map<string, number>();
  for (const part of blank) seen.set(part.label, (seen.get(part.label) ?? 0) + 1);
  return blank.map((part) => ({
    key: part.key,
    label: (seen.get(part.label) ?? 0) > 1 && part.section ? `${interpolate(part.section, options.variant ?? null)} — ${part.label}` : part.label,
  }));
}

/**
 * THE HISTORY BOX'S HELP, AS IT NOW WORKS (Pau, 25 Nov 2026, on the form: "add N/A AI filled out none, since it auto
 * adds it there pls change verbage here"). Published Corrective Action versions tell the manager to write "None — first
 * occurrence"; the app now writes "N/A" itself when nothing is listed (`fillNoPriorActionsFound`). Shown in place of
 * that published help only, so a help line an administrator wrote is kept. Pure and browser-safe.
 */
export const PRIOR_ACTIONS_HELP =
  'One per line: each coaching or corrective action on file, with the date the employee signed it, including any waiting for HR approval or sent back. If none is found, "N/A" is filled in automatically when the form is finalized or sent for approval.';

export function shownHelp(field: { key: string; help?: string }): string | undefined {
  if (field.key === "prior_actions" && field.help?.includes('Write "None — first occurrence" when there has been none')) {
    return PRIOR_ACTIONS_HELP;
  }
  return field.help;
}

/** The refusal for `blankBeforeSubmission`: names what is blank, at most eight, then how many more. */
export function blankBeforeSubmissionMessage(blank: readonly { label: string }[]): string {
  const shown = blank.slice(0, 8).map((part) => `"${part.label}"`);
  const more = blank.length - shown.length;
  return `Fill in every field before finalizing or sending this form for approval (signatures are signed in person). Still blank: ${shown.join(", ")}${more > 0 ? `, and ${more} more` : ""}.`;
}
