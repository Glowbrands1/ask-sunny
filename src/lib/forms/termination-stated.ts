import { terminationStatedTicksEnabled } from "@/lib/config/chat-quality-flags";

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
 * termination", "could lead to termination", "next time it's termination"), a question, or a past one ("she was
 * terminated last year and rehired"). Suspension and demotion are not read here. Pure.
 */

const STATED = new RegExp(
  [
    String.raw`\bterm\s+(?:ca|c\/a|corrective(?:\s+action)?|write[- ]?up|form)\b`,
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

/** A termination already in the past: "she was terminated last year", "previously terminated". */
const PAST = /\b(?:was|were|had\s+been|previously|before|last\s+(?:year|month|time))\b[^.!?]*\bterminat|\bterminat\w*\b[^.!?]*\b(?:last\s+(?:year|month|time)|before|previously|rehired)\b/i;

/** Whether this text states a termination for the form being written. Off: false. */
export function statesTermination(text: string): boolean {
  if (!terminationStatedTicksEnabled()) return false;
  for (const sentence of (text ?? "").split(/(?<=[.!?;])\s+|\n+/)) {
    const said = sentence.trim();
    if (said === "" || said.endsWith("?")) continue;
    if (!STATED.test(said)) continue;
    if (NOT_DECIDED.test(said) || PAST.test(said)) continue;
    return true;
  }
  return false;
}

/** The option key a stated termination ticks on the Type of Warning group. */
export const TERMINATION_OPTION = "termination";

/** The one line the card adds (Pau's ruling, verbatim). */
export const TERMINATION_APPROVAL_LINE = "Termination needs your DM/HR approval before you finalize.";

/** The Action Plan's closing on a termination (Pau's ruling, verbatim). */
export const TERMINATION_PLAN_SENTENCE = "Effective immediately, employment is terminated following the progressive corrective action plan.";

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
