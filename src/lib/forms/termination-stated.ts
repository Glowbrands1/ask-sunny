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
 * that tells the incident ("…, she never showed", "…, didn't show for her shift", "… because she didn't call in",
 * "She didn't show up, so …") is skipped for negations — those clauses are still read for hedges, and never skipped when
 * they mention a termination. Gate-Sunny's hedge probe (12 Nov 2026) adds: probably, likely, perhaps, possibly, I
 * think / guess / suppose / believe / feel, seems, sounds like, pending, once, whether, ask, check with, about; and
 * (Gate-Bubbles) waiting, before, until, approves / approval, signs off. A question never ticks. Suspension and demotion
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
    // Gate-Sunny's hedge probe of af924094 (QA, 12 Nov 2026).
    String.raw`\b(?:probably|(?:un)?likely|perhaps|possibl[ey]|seems?|pending|once|whether|ask(?:ed|ing)?|about)\b`,
    String.raw`\bI\s+(?:think|guess|suppose|believe|feel)\b`,
    String.raw`\bsounds?\s+like\b`,
    String.raw`\bcheck(?:ing)?\s+with\b`,
    // Gate-Bubbles (QA, 12 Nov 2026): "once the DM approves", "waiting on HR before we terminate her".
    String.raw`\b(?:wait(?:s|ed|ing)?|before|until|till|approv(?:e|es|ed|al|ing)|sign(?:s|ed)?[\s-]+off|sign-?off)\b`,
  ].join("|"),
  "i",
);
/** (1) The negations: read everywhere but an incident clause after the statement. */
const NEGATION = /\b(?:not|no|never|nor|cannot|without)\b|n['’]t\b/i;

/** The absence, not a negation: "no call no show", "no-call/no-show", "NCNS". */
const NO_CALL_NO_SHOW = /\bno[\s-]?call\s*[,/&-]?\s*(?:and\s+)?no[\s-]?show\b|\bncns\b/gi;

/** A clause whose subject is the employee ("she never showed", "because she didn't call in"). */
const INCIDENT_CLAUSE = /^\s*(?:(?:and|because|since|as)\s+)?(?:she|he|they|the\s+employee)\b/i;
/** A subject-less attendance clause ("…, didn't show for her shift"). */
const ATTENDANCE_CLAUSE =
  /^\s*(?:(?:and|because|since|as)\s+)?(?:did(?:n['’]?t)?|never|was(?:n['’]?t)?|had(?:n['’]?t)?)\b.*\b(?:show(?:ed)?|call(?:ed)?|came|come|clock(?:ed)?)\b/i;

function stated(clause: string): boolean {
  return STATED.test(clause) || TERMINATE_NAME.test(clause);
}

/**
 * The clauses that tell the incident, skipped for negations only (never for hedges, never when they mention a
 * termination): after the statement (or opened by "because" / "since"), one about the employee or a subject-less
 * attendance clause; before a "so …" statement, the reason ("She didn't show up, so I need a term CA").
 */
function incidentClause(clauses: string[], i: number, last: number): boolean {
  const clause = clauses[i];
  if (/\bterm/i.test(clause) || stated(clause)) return false;
  const told = INCIDENT_CLAUSE.test(clause) || ATTENDANCE_CLAUSE.test(clause);
  if (i > last || /^\s*(?:because|since)\b/i.test(clause)) return told;
  const next = clauses[i + 1] ?? "";
  return told && /^\s*so\b/i.test(next) && stated(next);
}

/** Whether one sentence states a termination for this form. */
function sentenceStatesTermination(sentence: string): boolean {
  const said = sentence.trim();
  if (said === "" || said.endsWith("?")) return false;
  const words = said.replace(NO_CALL_NO_SHOW, " ");
  if (!stated(words) || HEDGE.test(words)) return false;
  const clauses = words.split(/[,;:–—]|\s-\s|\s+(?=(?:because|since|so)\b)/i).filter((clause) => clause.trim() !== "");
  const last = clauses.reduce((at, clause, i) => (stated(clause) ? i : at), -1);
  return !clauses.some((clause, i) => !incidentClause(clauses, i, last) && NEGATION.test(clause));
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
