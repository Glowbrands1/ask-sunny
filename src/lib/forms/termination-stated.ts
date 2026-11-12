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
 * Safe by design (QA, 12 Nov 2026, after Gate-Sunny's probe of c10df533): a sentence ticks Termination ONLY when
 * (1) it says none of the negations or hedges below — not, n't, no, never, without, rather, instead, against, hold off,
 * avoid, unless, if, maybe, might, may, should, would, could, consider, thinking about, want to, next, later, future,
 * "long term" — and (2) it makes one of the positive statements: "term CA", "termination CA / form / warning",
 * "terminate her / him / them / <Name>", "<she> is being terminated", "we are terminating". Everything else leaves the
 * level unticked, and the manager picks it on the form. Two readings keep the manager's own incident words from
 * blocking a stated termination: "no call no show" is the absence, not a negation, and a clause after the statement
 * whose subject is the employee ("…, she never showed", "…, she did not show up") is the incident — those clauses are
 * still read for hedges, and never when they mention a termination. A question never ticks. Suspension and demotion
 * are not read here. Pure.
 */

/** (2) The positive statements. Only these tick. */
const STATED = new RegExp(
  [
    String.raw`\bterm\s+(?:ca|c\/a)\b`,
    String.raw`\btermination\s+(?:ca|c\/a|form|warning)\b`,
    String.raw`\bterminate\s+(?:her|him|them)\b`,
    String.raw`\b(?:is|are)\s+being\s+terminated\b`,
    String.raw`\b(?:we\s+are|we['’]re)\s+terminating\b`,
  ].join("|"),
  "i",
);
/** "terminate <Name>": a capitalised name, read case-sensitively. */
const TERMINATE_NAME = /\b[Tt]erminate\s+[A-Z][a-z'’-]+\b/;

/** (1) The hedges: read in the whole sentence, incident clauses included. */
const HEDGE = new RegExp(
  [
    String.raw`\b(?:rather|instead|against|avoid(?:ing)?|unless|if|maybe|might|may|should|would|could|consider(?:ing)?|later|future|next)\b`,
    String.raw`\bhold(?:ing)?\s+off\b`,
    String.raw`\bthinking\s+(?:about|of)\b`,
    String.raw`\bwant(?:s|ed)?\s+to\b`,
    String.raw`\blong[\s-]term\b`,
  ].join("|"),
  "i",
);
/** (1) The negations: read everywhere but an incident clause after the statement. */
const NEGATION = /\b(?:not|no|never|nor|cannot|without)\b|n['’]t\b/i;

/** The absence, not a negation: "no call no show", "no-call/no-show", "NCNS". */
const NO_CALL_NO_SHOW = /\bno[\s-]?call\s*[,/&-]?\s*(?:and\s+)?no[\s-]?show\b|\bncns\b/gi;

/** A clause after the statement that tells the incident: its subject is the employee ("she never showed"). */
const INCIDENT_CLAUSE = /^\s*(?:and\s+|because\s+|as\s+|since\s+)?(?:she|he|they|the\s+employee)\b/i;

function stated(clause: string): boolean {
  return STATED.test(clause) || TERMINATE_NAME.test(clause);
}

/** Whether one sentence states a termination for this form. */
function sentenceStatesTermination(sentence: string): boolean {
  const said = sentence.trim();
  if (said === "" || said.endsWith("?")) return false;
  const words = said.replace(NO_CALL_NO_SHOW, " ");
  if (!stated(words) || HEDGE.test(words)) return false;
  const clauses = words.split(/[,;:–—]|\s-\s/);
  const last = clauses.reduce((at, clause, i) => (stated(clause) ? i : at), -1);
  const incident = (clause: string, i: number) => i > last && INCIDENT_CLAUSE.test(clause) && !/\bterm/i.test(clause);
  return !clauses.some((clause, i) => !incident(clause, i) && NEGATION.test(clause));
}

/** Whether this text states a termination for the form being written. Off: false. */
export function statesTermination(text: string): boolean {
  if (!terminationStatedTicksEnabled()) return false;
  return (text ?? "").split(/(?<=[.!?;])\s+|\n+/).some(sentenceStatesTermination);
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
