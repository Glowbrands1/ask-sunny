import { terminationStatedTicksEnabled } from "@/lib/config/chat-quality-flags";

import { TERMINATION_PLAN_CLOSING } from "./required-closing";

/**
 * ============================================================================
 * A TERMINATION THE MANAGER STATES FOR THIS FORM (TERMINATION_STATED_TICKS_ENABLED)
 * ============================================================================
 *
 * Pau's P15 (Sunny production, 9 Nov 2026): "I need a term CA for <name>. Didn't show up for her opening shift.
 * Payroll deduction." The card said "You'll set the verbal/written warning level …" and the form's Type of Warning
 * came back blank: the escalation guard never lets chat choose a termination (`escalation-guard.ts`). Pau's ruling
 * (10 Nov 2026, "A"): when the manager STATES the termination, tick it as their statement — the way a stated verbal or
 * written is — and say that it needs DM/HR approval before it is finalized.
 *
 * STATED, read a sentence at a time: "term CA", "termination CA / form / write-up", "CA for termination", "terminate
 * her", "she is being terminated", "warning level: termination", or a sentence that is only "termination" / "term".
 * NOT STATED: a hedge or a consequence ("she might be terminated if this continues", "up to and including
 * termination", "could lead to termination", "next time it's termination"), a question, a past one ("she was
 * terminated last year and rehired"), a negated one ("do not terminate her", "this is not a term CA"), one about a
 * later form ("next one is a term CA"), or "long term". Suspension and demotion are not read here. Pure.
 */

const STATED = new RegExp(
  [
    // "long term CA plan", "short-term" are no termination (Gate-Bubbles, R798).
    String.raw`(?<!\b(?:long|short)[\s-])\bterm\s+(?:ca|c\/a|corrective(?:\s+action)?|write[- ]?up|form)\b`,
    String.raw`\btermination\s+(?:ca|c\/a|corrective(?:\s+action)?|write[- ]?up|form|warning)\b`,
    String.raw`\b(?:ca|c\/a|corrective\s+action(?:\s+form)?|write[- ]?up)\s+(?:for\s+|of\s+)?termination\b`,
    String.raw`\bterminat(?:e|ing)\s+(?:her|him|them|this\s+employee|the\s+employee)\b`,
    String.raw`\b(?:she|he|they|employee)\s+(?:is|are|will\s+be|has\s+been|have\s+been)\s+(?:being\s+)?terminated\b`,
    String.raw`\b(?:warning\s+(?:level|type)|type\s+of\s+warning|level)\s*(?:is\s*|[:=-]\s*)termination\b`,
    String.raw`^\s*(?:it'?s\s+(?:a\s+)?)?(?:term|termination)\s*[.!]?\s*$`,
  ].join("|"),
  "i",
);

/** A hedge, a consequence or a condition: the sentence does not decide this form's level. */
const NOT_DECIDED =
  /\b(?:might|may|could|would|should\s+(?:she|he|they)|if|unless|until|possible|possibly|potential(?:ly)?|consider(?:ing)?|thinking|maybe|next\s+time|again|lead\s+to|result\s+in|up\s+to\s+and\s+including|warn(?:ed|ing)?\s+(?:her|him|them)|threat(?:en(?:ed)?)?|eventual(?:ly)?|risk)\b/i;

/*
 * Gate-Bubbles' NO-GO (R798, 12 Nov 2026): a negated sentence decides no termination — "do not terminate her", "this is
 * not a term CA", "we are not terminating him", "not a termination warning", "no termination form needed", "never a
 * term", "isn't a termination", "a written instead of a termination" — and neither does one about another form later:
 * "next one is a term CA", "after this", "if it happens again".
 */
// The negation must govern the termination ("no call no show" next to "termination CA" is the absence, not a denial).
const NEGATED = new RegExp(
  [
    String.raw`\b(?:not|no|never|nor|without|instead\s+of|(?:do|does|did|is|are|was|were|wo|ca)n['’]?t)\b(?:\W+\w+){0,3}?\W+(?:term\b|terminat)`,
    String.raw`\bterm(?:ination)?\b(?:\s+(?:ca|form|write[- ]?up|warning))?\s+(?:is\s+|was\s+)?(?:not|isn['’]?t|no\s+longer)\b`,
  ].join("|"),
  "i",
);
const ANOTHER_FORM = /\b(?:next\s+(?:one|form|ca|write[- ]?up|time)|after\s+this|if\s+it\s+happens\s+again|following\s+one|future)\b/i;

/** A termination already in the past: "she was terminated last year", "previously terminated". */
const PAST = /\b(?:was|were|had\s+been|previously|before|last\s+(?:year|month|time))\b[^.!?]*\bterminat|\bterminat\w*\b[^.!?]*\b(?:last\s+(?:year|month|time)|before|previously|rehired)\b/i;

/** Whether this text states a termination for the form being written. Off: false. */
export function statesTermination(text: string): boolean {
  if (!terminationStatedTicksEnabled()) return false;
  for (const sentence of (text ?? "").split(/(?<=[.!?;])\s+|\n+/)) {
    const said = sentence.trim();
    if (said === "" || said.endsWith("?")) continue;
    if (!STATED.test(said)) continue;
    if (NOT_DECIDED.test(said) || PAST.test(said) || NEGATED.test(said) || ANOTHER_FORM.test(said)) continue;
    return true;
  }
  return false;
}

/** The option key a stated termination ticks on the Type of Warning group. */
export const TERMINATION_OPTION = "termination";

/** The one line the card adds (Pau's ruling, verbatim). */
export const TERMINATION_APPROVAL_LINE = "Termination needs your DM/HR approval before you finalize.";

/** The Action Plan's closing on a termination (Pau's ruling, verbatim). */
// One constant (Gate-Bubbles, R798): the plan builders' TERMINATION_PLAN_CLOSING (`required-closing.ts`, Pau's approval).
export const TERMINATION_PLAN_SENTENCE = TERMINATION_PLAN_CLOSING;

/** The closing for a future violation, as the Corrective Action plan builders end with it. */
const FUTURE_VIOLATIONS = /\s*Future policy violations may (?:result in|be subject to) additional corrective action up to and including termination of employment\.?\s*$/i;

/**
 * TERMINATION_STATED_TICKS_ENABLED: a plan built for a form whose Type of Warning is Termination ends with the
 * termination sentence instead of the closing for a future violation (Pau's ruling, 10 Nov 2026). Whichever builder
 * wrote the plan; the write path keeps it closed (`required-closing.ts`, Pau's approval). Off, the plan as built.
 */
export function withTerminationPlan(plan: string, termination: boolean): string {
  if (!termination || !terminationStatedTicksEnabled() || plan.trim() === "") return plan;
  if (plan.trim().endsWith(TERMINATION_PLAN_SENTENCE)) return plan;
  const body = plan.replace(FUTURE_VIOLATIONS, "").trim();
  return body === "" ? TERMINATION_PLAN_SENTENCE : `${/[.!?]$/.test(body) ? body : `${body}.`} ${TERMINATION_PLAN_SENTENCE}`;
}
