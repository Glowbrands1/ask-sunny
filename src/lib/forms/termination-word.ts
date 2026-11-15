/**
 * ============================================================================
 * THE LOCK ON A TERMINATION THE AGENT LOOP'S MODEL DECIDED (QA's design, 15 Nov 2026; Pau's standing approval)
 * ============================================================================
 *
 * In the agent loop the MODEL reads whether this form is a termination (the rules book teaches it with examples); code
 * never reads intent. Code only LOCKS it: a termination level is refused unless the manager's own words for this
 * request carry a termination word — "terminat…", "term CA" / "term C/A", "fire", "fired", "fires", "firing". The same
 * lock runs on the loop's card (propose_form), its draft edits (edit_form: the current message, never a question) and
 * at Create (`api/forms/instances`, server-side, from the conversation's user turns). Pure.
 */
export const TERMINATION_WORD = /\bterminat\w*|\bterm\s+(?:ca|c\/a)\b|\bfir(?:e|ed|es|ing)\b/i;

/** Whether the manager's words carry a termination word (the lock; never a reading of intent). */
export function saysTerminationWord(text: string): boolean {
  return TERMINATION_WORD.test(text ?? "");
}

/** Whether one message carries a termination word and is not a question (edit_form's lock on the current message). */
export function statesTerminationWordNow(message: string): boolean {
  const text = (message ?? "").trim();
  return text !== "" && !text.endsWith("?") && saysTerminationWord(text);
}
