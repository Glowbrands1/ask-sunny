import type { RevisableField } from "./revision";

/*
 * ============================================================================
 * "THE SAME OUTLINE" WRITES THE TEMPLATE'S FIELDS (TEMPLATE_OUTLINE_FIELDS_ENABLED)
 * ============================================================================
 *
 * Pau's sf-s21 (Sunny production, 4 Nov 2026): with <A>'s Corrective Action created, the manager pasted <B>'s CA as a
 * template — "Observation of Offense:  During the month of September 2026, <B> completed 237 tanning transactions. …
 * Action Plan:  The Leadership Team will coach <B> on Must See Behaviors …" — then asked "No this should be the same
 * out line but with wynnes info i told you in the first chat". The revision was scoped to the Observation, so the
 * template's Action Plan never reached the form.
 *
 * With the flag on, a request for a pasted template's outline may write every field whose label the template uses as
 * a heading ("<label>:" at the start of a line or paragraph), read from the latest manager turn that has two or more.
 * Pure.
 */

const ASKS_FOR_OUTLINE =
  /\b(?:same\s+(?:out\s?line|format|layout|template|structure)|in\s+the\s+(?:format|out\s?line|layout|style|structure)\s+(?:of|that|i|you|we)\b|look(?:s)?\s+(?:exact(?:ly|ally|aly)?\s+)?(?:the\s+same|like)\s+as\b|exact(?:ly|ally|aly)?\s+the\s+same\s+as\b)/i;

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The fields whose label this text uses as a heading ("Observation of Offense:", "Action Plan:"). */
export function headedFields(text: string, fields: readonly RevisableField[]): string[] {
  return fields
    .filter((field) => field.label.trim().length >= 4)
    .filter((field) => new RegExp(`(?:^|\\n)[ \\t]*${escaped(field.label.trim()).replace(/\s+/g, "\\s+")}[ \\t]*:`, "i").test(text))
    .map((field) => field.key);
}

/** Whether the request asks for a template's outline ("the same out line", "in the format that I explained"). */
export function asksForOutline(question: string): boolean {
  return ASKS_FOR_OUTLINE.test(question);
}

/**
 * The request as the revision reads it: it names the template's fields, so the revision's own scope
 * (`revision.ts` scopeRevision) lets it write every one — the Corrective Action's Action Plan included, which is
 * changed only when a request names it. The request as it is when it asks for no template's outline.
 */
export function withTemplateFieldsNamed(input: {
  question: string;
  history: readonly { role: string; content: unknown }[];
  fields: readonly RevisableField[];
}): string {
  const keys = templateOutlineKeys(input);
  if (keys.size === 0) return input.question;
  // Each field with its own verb: the revision's reader instructs a field only with a verb just before it.
  const asks = input.fields.filter((field) => keys.has(field.key)).map((field) => `rewrite the ${field.label}`);
  return `Please ${asks.join(" and ")} in the outline of the template I pasted above, with this form's own facts: ${input.question}`;
}

/**
 * The fields a request for a pasted template's outline may write: the headings of the latest manager turn (this one
 * included) that has two or more of the form's field labels. None when the request asks for no outline.
 */
export function templateOutlineKeys(input: {
  question: string;
  history: readonly { role: string; content: unknown }[];
  fields: readonly RevisableField[];
}): Set<string> {
  if (!asksForOutline(input.question)) return new Set();
  const turns = [input.question, ...[...input.history].reverse().filter((turn) => turn.role === "user").map((turn) => String(turn.content ?? ""))];
  for (const turn of turns) {
    const keys = headedFields(turn, input.fields);
    if (keys.length >= 2) return new Set(keys);
  }
  return new Set();
}

/*
 * sf-s21's last ask (QA's ruling, 10 Nov 2026): "I need the CA for the Must see behaviors and not the standard of
 * conduct." The JBA Policy Manual has no Must See Behaviors section (MSB corrective actions cite Standards of Conduct,
 * `ca-sales-policy.ts`), so the form keeps Standards of Conduct — and the reply says so plainly, never "I haven't
 * changed the form".
 */
const ASKS_MSB = /\b(?:must\s+see\s+behaviou?rs?|msb)\b/i;
const NOT_CONDUCT = /\b(?:not|instead\s+of)\s+(?:the\s+)?standards?\s+of\s+conduct\b/i;
// The "nothing changed" reply, with its "Tell me which part to change …" paragraph.
const NOTHING_CHANGED_LINE =
  /^\s*(?:I didn't change anything on the form\.|I haven'?t changed the \*\*[^*]+\*\*[^.\n]*?—\s*everything on it is as it was\.)[^\n]*(?:\n\s*\n\s*Tell me which part to change[^\n]*)?/;

/** Why the form still cites Standards of Conduct, when the manager asked for Must See Behaviors instead; else null. */
export function policyKeptNote(input: { question: string; policyViolated: string; policyLanguage: string }): string | null {
  if (!ASKS_MSB.test(input.question) || !NOT_CONDUCT.test(input.question)) return null;
  if (input.policyViolated.trim().toLowerCase() !== "standards of conduct") return null;
  const page = /\bp\.\s*(\d+)/i.exec(input.policyLanguage)?.[1];
  return `Must See Behaviors is part of the Standards of Conduct policy${page ? ` (JBA Policy Manual p.${page})` : ""}, so I kept that policy on the form.`;
}

/** The reply with the note: in place of a "nothing changed" line, else after the reply. */
export function withPolicyKeptNote(content: string, note: string): string {
  if (NOTHING_CHANGED_LINE.test(content)) return content.replace(NOTHING_CHANGED_LINE, `${note} Nothing else on the form changed.`);
  return `${content.trimEnd()}\n\n${note}`;
}
