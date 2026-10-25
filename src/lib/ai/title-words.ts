import { isAppLine } from "./app-sentences";

/**
 * The manager's words the job title is read from.
 *
 * "ass't salon director" is an assistant salon director. The title list
 * spells out "assistant", so the short forms are spelled out first; without
 * that, the shorter "salon director" inside it is what matched.
 *
 * A pasted policy is the manual's words, not the manager's. "Managers or
 * District Managers will be responsible for …" names a role, not this
 * employee's title.
 */

export function spelledAssistant(text: string): string {
  return text.replace(/\bass['’]t\b\.?|\basst\b\.?/gi, "assistant");
}

const POLICY_SUBJECT = /\b(?:the employee|employees|the company|managers?|district managers?)\b/i;
const POLICY_MODAL = /\b(?:will be required|is required|are required|must|shall|(?:will|is|are) be responsible|(?:is|are) responsible)\b/i;
const PERSONAL = /\b(?:i|i'm|me|my|we|our|us|you|your|she|her|he|him|his)\b/i;

/** Long text in the manual's voice: a subject, a rule, and nobody in particular. */
export function readsAsPolicyPaste(turn: string): boolean {
  const text = turn.trim();
  if (text.length < 200) return false;
  return POLICY_SUBJECT.test(text) && POLICY_MODAL.test(text) && !PERSONAL.test(text);
}

/** Manager turns for the title reader: no policy paste, assistant spelled out. */
export function titleTextFromTurns(turns: readonly string[]): string {
  return turns
    .filter((turn) => turn.trim() !== "" && !readsAsPolicyPaste(turn))
    .map(spelledAssistant)
    .join("\n");
}

/**
 * One question that may carry the app's own lines: those lines stay (the
 * saved title is one of them), and the manager's part is dropped when it is
 * a policy paste.
 */
export function titleTextFromQuestion(text: string): string {
  const lines = text.split("\n");
  const app = lines.filter((line) => isAppLine(line));
  const rest = lines.filter((line) => !isAppLine(line)).join("\n");
  return spelledAssistant([...app, readsAsPolicyPaste(rest) ? "" : rest].join("\n"));
}

/**
 * Words the model has read as the job title that are not one: the form
 * ("CA for Test Employee …"), the employee's own name ("test"), and a clause
 * ("test was late opening salon").
 */
const FORM_WORDS = /^(?:ca|cas|corrective action|corrective action form|coaching|coaching form|form|write[- ]?up|dpoa|epp)$/i;
const CLAUSE_WORDS = new Set(
  (
    "am is are was were be been being do does did done has have had not no never " +
    "didn't doesn't don't isn't wasn't weren't won't can't will would can could should " +
    "came went left called opened closed said told"
  ).split(" "),
);

export function readsAsStatedTitle(input: {
  readonly probe: string;
  readonly text: string;
  readonly employeeName: string | null;
  readonly knownTitle: (text: string) => string | null;
}): boolean {
  const probe = input.probe.trim();
  const words = probe.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0 || FORM_WORDS.test(probe)) return false;
  const nameWords = new Set((input.employeeName ?? "").toLowerCase().split(/\s+/).filter(Boolean));
  if (words.every((word) => nameWords.has(word))) return false;
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  if (!new RegExp(`(?:^|[^a-z0-9'’])${escaped}(?![a-z0-9'’])`, "i").test(input.text)) return false;
  if (input.knownTitle(probe)) return true;
  return words.length <= 4 && !words.some((word) => CLAUSE_WORDS.has(word.replace(/[.,;:!?]+$/, "")));
}
