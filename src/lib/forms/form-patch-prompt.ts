import type { FieldValue, Owner } from "./form-reducer";

/**
 * The form-patch model's prompt (FORM_PATCH_REDUCER_ENABLED, Step B). The
 * system text is the approved one, word for word, and is the same text in
 * the sibling app; `form-patch-prompt.test.ts` pins it.
 */
export const FORM_PATCH_SYSTEM_PROMPT = `You update one open HR form from the manager's latest message. Return the patch only; do not answer the manager.
turn: "this_form" when the latest message gives content for this form, asks to change it, or accepts text the assistant offered for it ("make that update", "yes, do that"); "question" when it asks something and gives nothing for the form; "other" when it is about another person, another form, or copying another form.
set: one entry per field the latest message changes. value is the text for a text field; options are option keys for a checkbox field. how "add" keeps what the field says and adds to it; "replace" only when the manager asked for that field's text to be replaced. evidence: the words the value came from, copied exactly — from the manager's messages, or from the assistant's last reply only when the latest message accepts it.
Write dates, payroll deductions and amounts exactly as the manager gave them. A date field takes YYYY-MM-DD and only a date the manager stated. Never invent a date, amount, name, policy or detail; leave out a field the manager gave nothing for.
clear: only fields the manager asked to have removed, with their words as evidence. Never change a field marked "manager" unless the latest message asks to change that field.`;

/**
 * FORM_PATCH_READER_FIXES_ENABLED (coding 5, 7 Nov 2026): lines ADDED after the approved system text (which is
 * not edited). Pau's "yes rewrite" (7 Nov 2026): a wording change may be written in new words, facts only the
 * manager's or the form's. Sent only with the flag on.
 */
export const FORM_PATCH_READER_LINES = `how "reword": only when the latest message asks to change how a field is worded or laid out (more professional, clearer, the same outline as an example) and gives no new content for it. value is the field's whole text in new words; keep every name, date, number, amount and fact it holds, and take any other fact only from the manager's messages or the form. Never reword a field the latest message is not about.
The employee's position is the field job_title when it is listed: set it only to the words the latest message gives for it, how "replace".
A correction of a word ("fix her last name, it is …") changes every field whose text holds the old word: set each one, how "replace", with its whole text and only that word corrected.
When the latest message says what the form is about or for ("make it about …", "make it for …"), that is new content, never a reword: how "replace" on the field that gives the account, written in the manager's own words for it, with those words as evidence. Never describe the form itself in a field.`;

export interface FormPatchField {
  readonly key: string;
  readonly label: string;
  /** "text", "long text", "date", "checkbox", … as the template names the input. */
  readonly kind: string;
  readonly filledBy: Owner;
  readonly value: FieldValue;
  /** A checkbox field's option keys. */
  readonly options?: readonly string[];
  /** A checkbox field that takes exactly one option. */
  readonly single?: boolean;
}

export interface FormPatchReadOnly {
  readonly label: string;
  readonly value: FieldValue;
}

export interface FormPatchTurn {
  readonly role: "manager" | "assistant";
  readonly content: string;
}

export interface FormPatchInput {
  /** YYYY-MM-DD. */
  readonly today: string;
  readonly templateName: string;
  /** Null for a whole-team form. */
  readonly employeeName: string | null;
  readonly fields: readonly FormPatchField[];
  readonly readOnly: readonly FormPatchReadOnly[];
  /** The conversation before the latest message, oldest first. */
  readonly turns: readonly FormPatchTurn[];
  readonly latest: string;
}

/** How many earlier turns the model sees. */
export const FORM_PATCH_TURNS = 12;

function shown(value: FieldValue): string {
  const text = typeof value === "string" ? value : value.join(", ");
  const flat = text.split("\n").map((line) => line.trim()).filter((line) => line !== "").join(" / ");
  return flat === "" ? "(empty)" : flat;
}

function kindOf(field: FormPatchField): string {
  if (!field.options || field.options.length === 0) return field.kind;
  return `${field.kind} (${field.single ? "one of" : "any of"}: ${field.options.join(", ")})`;
}

/** The user message: today, the form, the fields it may set, the read-only ones, the last turns and the latest message. */
export function buildFormPatchUserMessage(input: FormPatchInput): string {
  const fields = input.fields.map((field) => `${field.key} | ${field.label} | ${kindOf(field)} | ${field.filledBy} | ${shown(field.value)}`);
  const readOnly = input.readOnly.map((field) => `${field.label}: ${shown(field.value)}`);
  const turns = input.turns
    .slice(-FORM_PATCH_TURNS)
    .map((turn) => `${turn.role === "manager" ? "MANAGER" : "ASSISTANT"}: ${turn.content.trim()}`);
  return [
    `Today is ${input.today}.`,
    `FORM: ${input.templateName}`,
    `EMPLOYEE: ${input.employeeName ?? "the whole team"}`,
    "FIELDS YOU MAY SET (key | label | kind | filled by | current value):",
    ...(fields.length > 0 ? fields : ["(none)"]),
    "READ-ONLY (shown for context):",
    ...(readOnly.length > 0 ? readOnly : ["(none)"]),
    `CONVERSATION (oldest first, last ${FORM_PATCH_TURNS} turns):`,
    ...(turns.length > 0 ? turns : ["(none)"]),
    `LATEST MESSAGE FROM THE MANAGER: ${input.latest.trim()}`,
  ].join("\n");
}
