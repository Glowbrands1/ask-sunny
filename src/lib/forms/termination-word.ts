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
/*
 * QA item 12 (20 Nov 2026; live production, a real manager: "create exit for <P>. payroll deduct no apply", then
 * "involuntary immediate term", was refused twice and the manager was asked to rephrase). The HR shorthand managers use
 * for a termination carries one too: "term" / "termed" / "immediate term" (never "long term", "short term", "terms"),
 * "involuntary" (never "voluntary": that is a resignation), "let go" / "let <her> go" (never "let her go home"),
 * "separated" / "separation" (from the job), "job abandonment", and three no call no shows ("no call no show x3",
 * "3 NCNS"). Still only a lock on the manager's words; the model decides what they mean.
 */
const SHORTHAND = [
  String.raw`(?<!long[\s-])(?<!short[\s-])(?<!mid[\s-])\bterm(?:ed|med|ing)?\b(?!\s+(?:of|limit|paper|sheet)\b)`,
  String.raw`\binvoluntar(?:y|ily)\b`,
  String.raw`\blet\s+(?:(?:her|him|them|\w+)\s+)?go\b(?!\s+(?:home|early|on\s+break|to|for|grab|get|eat|out|back|ahead)\b)`,
  String.raw`\bseparat(?:ed|ion)\b(?!\s+(?:the|her|his|their|them|it|towels?|laundry)\b)`,
  String.raw`\bjob\s+abandon\w*`,
  String.raw`\b(?:no[\s-]?call[\s,/&-]*(?:and\s+)?no[\s-]?shows?|ncns)\s*(?:x\s*3|3\s*x|3\s+times|three\s+times)\b`,
  String.raw`\b(?:3|three)\s+(?:no[\s-]?call[\s,/&-]*(?:and\s+)?no[\s-]?shows|ncns)\b`,
].join("|");
export const TERMINATION_WORD = new RegExp(String.raw`\bterminat\w*|\bterm\s+(?:ca|c\/a)\b|\bfir(?:e|ed|es|ing)\b|` + SHORTHAND, "i");

/** Whether the manager's words carry a termination word (the lock; never a reading of intent). */
export function saysTerminationWord(text: string): boolean {
  return TERMINATION_WORD.test(text ?? "");
}

/** Whether one message carries a termination word and is not a question (edit_form's lock on the current message). */
export function statesTerminationWordNow(message: string): boolean {
  const text = (message ?? "").trim();
  return text !== "" && !text.endsWith("?") && saysTerminationWord(text);
}
