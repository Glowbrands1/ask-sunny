/*
 * ============================================================================
 * A FIELD THE MANAGER DICTATES IS SAVED WORD FOR WORD (batch J2; batch G's G8 generalized)
 * ============================================================================
 *
 * QA's live re-run, L4 t3: "change observation of offense to: <the manager's text>" was saved in the passive voice and
 * lost the employee as its subject. Batch G locked a dictated Action Plan (G8); this is the same lock for any field,
 * the field named by its label(s). Pure.
 *
 * A message DICTATES a field when it carries a marker for it:
 *   (A) the label, then a ":" within 80 characters with no comma, period or semicolon between ("Observation of
 *       Offense:", "the action plan section of the form needs to reflect the following verbage:");
 *   (B) "change / make / set / update / replace [the] <label> [section] to".
 * The model's text must appear after the marker word for word (case and spacing aside); what is saved is that stretch
 * of the message, in the manager's own capitals. Anything else is a reword, not dictation.
 */

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function labelPattern(labels: readonly string[]): string {
  return labels
    .map((label) => label.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((label) => escaped(label).replace(/\s+/g, "\\s+"))
    .join("|");
}

/*
 * (B) is the manager's words only when the text follows "to" itself: "change the observation to say it was a jacket" is
 * an instruction about what to write, not the words to write (the replay pack's nov14-agent-loop-edit-form-drafts-only).
 */
const NOT_THE_WORDS = String.raw`(?!\s+(?:say|read|mention|include|reflect|show|state|note|add|cover|explain|describe|be\s+about)\b)`;

/** Where the dictation marker for one of these labels ends in the message, or null when the message has none. */
export function dictationMarkerEnd(message: string, labels: readonly string[]): number | null {
  const names = labelPattern(labels);
  if (!names) return null;
  const marker =
    new RegExp(String.raw`\b(?:${names})\b[^\n,.;]{0,80}:`, "i").exec(message) ??
    new RegExp(String.raw`\b(?:change|make|set|update|replace)\s+(?:the\s+)?(?:${names})(?:\s+section)?\s+to\b${NOT_THE_WORDS}`, "i").exec(message);
  return marker ? marker.index + marker[0].length : null;
}

/** A form's headings, as a pasted form carries them ("Observation of Offense:", "Action Plan:"). */
const HEADINGS = /\b(?:observation\s+of\s+offense|observation|action\s+plan|prior\s+actions?|policy\s+violated|type\s+of\s+warning|coaching\s+details|details)\s*:/gi;

/**
 * A pasted form (two or more of a form's headings, or a format, outline or template named): an outline to follow, not one field's
 * words (H11; the replay pack's nov14-agent-loop-msb-family, "in the format of <C>'s ca"). J2's lock leaves it alone.
 */
export function pastedOutline(message: string): boolean {
  // "in the format of <C>'s ca", "it needs to look like this format but for <B>", "the same outline", "use this template".
  return (message.match(HEADINGS) ?? []).length >= 2 || /\b(?:format|out\s?line|template)\b/i.test(message);
}

/*
 * QA's review (NO-GO 5): the dictation ends before the first sentence that is an instruction to the app ("Also make it
 * a verbal", "change the date to …", any level or payroll words): an account never holds instructions or level words.
 */
const INSTRUCTION = /^(?:also|and\s+(?:also\s+)?(?:make|change|set|put|add|mark)|please|make\s+it|change|set|update|add|remove|tick|mark|put|yes|no)\b|\b(?:verbal|written|termination|warning\s+level|type\s+of\s+warning|payroll)\b/i;

/** What follows the marker, up to the first instruction sentence. */
function dictatedRegion(message: string, end: number): string {
  const after = message.slice(end);
  let kept = 0;
  for (const sentence of after.match(/[^.!?\n]+(?:[.!?]+|\n|$)/g) ?? []) {
    if (kept > 0 && INSTRUCTION.test(sentence.trim())) break;
    if (kept === 0 && sentence.trim() !== "" && INSTRUCTION.test(sentence.trim())) break;
    kept += sentence.length;
  }
  return after.slice(0, kept);
}

/** The manager's dictated text for the field: the model's text as it stands in the message after the marker, or null. */
export function dictatedField(message: string, labels: readonly string[], modelText: string, options: { stopAtInstructions?: boolean } = {}): string | null {
  const end = dictationMarkerEnd(message, labels);
  const words = (modelText ?? "").trim().split(/\s+/).filter(Boolean);
  if (end === null || words.join(" ").length <= 10) return null;
  const pattern = new RegExp(words.map(escaped).join("\\s+"), "i");
  // The Action Plan (G8) keeps its own reading: a plan may say "termination of employment".
  const found = pattern.exec(options.stopAtInstructions === false ? message.slice(end) : dictatedRegion(message, end));
  return found ? found[0] : null;
}

/** What the message dictates after the marker, up to the first instruction sentence, for a refusal to hand back. */
export function dictatedText(message: string, labels: readonly string[], options: { stopAtInstructions?: boolean } = {}): string | null {
  const end = dictationMarkerEnd(message, labels);
  if (end === null) return null;
  const text = (options.stopAtInstructions === false ? message.slice(end) : dictatedRegion(message, end)).trim();
  return text.length > 10 ? text : null;
}

/** Batch G (G8): the Action Plan, as before. */
export const ACTION_PLAN_LABELS: readonly string[] = ["action plan"];

/** The account on a card (propose_form's what_happened): the labels managers use for it. */
export const ACCOUNT_LABELS: readonly string[] = ["observation of offense", "observation", "what happened", "coaching details"];
