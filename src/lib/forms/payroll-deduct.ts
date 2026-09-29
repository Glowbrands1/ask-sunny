import { detectTemplateIntent } from "./template-intent";

/**
 * ============================================================================
 * "IS PAYROLL DEDUCT APPLICABLE?" — THE CORRECTIVE ACTION FORM'S YES / NO
 * ============================================================================
 *
 * Requested by Operations (Madeline Patterson, 29 September 2026): the
 * Corrective Action Form gains one question, worded exactly as she wrote it,
 * answered Yes or No. The wording is hers and is not corrected to "deduction".
 *
 * THE ANSWER IS THE MANAGER'S, NEVER THE MODEL'S. The group is a `manager`
 * group on the template, so nothing the drafting model returns can tick it —
 * `enforceResponsibilities` drops it. What CAN fill it is what the manager
 * said in the conversation, read here deterministically and written as a
 * manager statement (the same path the employment change forms use for their
 * stated facts), or the manager ticking it on the form.
 *
 * UNANSWERED STAYS UNANSWERED. Nothing here returns a default. A conversation
 * that never answered the question reads as `null`, the form prints two empty
 * boxes, and Ask Sunny asks for it rather than deciding.
 *
 * Pure and browser-safe, like the intake readers it sits beside.
 */

export const PAYROLL_DEDUCT_KEY = "payroll_deduct";

/** Maddie's wording, verbatim. */
export const PAYROLL_DEDUCT_LABEL = "Is payroll deduct applicable?";

export type PayrollDeductAnswer = "yes" | "no";

export const PAYROLL_DEDUCT_OPTIONS: readonly { key: PayrollDeductAnswer; label: string }[] = [
  { key: "yes", label: "Yes" },
  { key: "no", label: "No" },
];

/** The one key a payroll-deduct statement may write — see `applyStatedFacts`. */
export const PAYROLL_DEDUCT_STATED_KEYS: ReadonlySet<string> = new Set([PAYROLL_DEDUCT_KEY]);

export function isPayrollDeductAnswer(value: unknown): value is PayrollDeductAnswer {
  return value === "yes" || value === "no";
}

/* ------------------------------------------------------------- reading --- */

/** "payroll deduct", "payroll deduction(s)", "payroll", "deduction". */
const SUBJECT = String.raw`(?:payroll\s+deduct(?:ion|ions|ed)?|payroll|deduct(?:ion|ions)?)`;

const NEGATIVE: readonly RegExp[] = [
  // "no payroll deduct", "no deduction", "no to payroll deduction", "no, payroll"
  new RegExp(String.raw`\bno\b[\s,:-]*(?:to\s+)?(?:the\s+|a\s+)?${SUBJECT}\b`),
  // "payroll deduct is not applicable", "payroll deduction doesn't apply"
  new RegExp(
    String.raw`\b${SUBJECT}\s+(?:is\s+|does\s+|would\s+|will\s+)?(?:not|n't|isn't|doesn't|won't|wont|isnt|doesnt)\s+(?:be\s+)?(?:applicable|apply|applies|needed|required|necessary)\b`,
  ),
  // "payroll deduct: no", "payroll deduct applicable - no", "payroll deduct = n/a"
  new RegExp(String.raw`\b${SUBJECT}(?:\s+applicable)?\s*[:=-]\s*(?:no|n|none|n/a|not applicable)(?:$|[\s.,!;])`),
  // "payroll deduct n/a", "payroll deduction not applicable", "payroll deduct none"
  new RegExp(String.raw`\b${SUBJECT}(?:\s+applicable)?\s+(?:is\s+)?(?:n/a|not applicable|none)(?:$|[\s.,!;])`),
  // "we won't deduct", "don't deduct it from her pay", "not deducting"
  /\b(?:don't|dont|do not|won't|wont|will not|not|no need to|shouldn't|should not)\s+(?:be\s+)?deduct(?:ing|ed)?\b/,
  /\bwithout\s+(?:a\s+|any\s+)?(?:payroll\s+)?deduction\b/,
];

const POSITIVE: readonly RegExp[] = [
  // "yes payroll deduct applies", "yes to payroll deduction", "yes, deduction"
  new RegExp(String.raw`\byes\b[\s,:-]*(?:to\s+)?(?:the\s+|a\s+)?${SUBJECT}\b`),
  // "payroll deduct applies", "payroll deduction is applicable", "payroll deduct needed"
  new RegExp(
    String.raw`\b${SUBJECT}\s+(?:is\s+|does\s+|will\s+|would\s+)?(?:be\s+)?(?:applicable|applies|apply|needed|required|necessary)\b`,
  ),
  // "payroll deduct: yes", "payroll deduct applicable - yes"
  new RegExp(String.raw`\b${SUBJECT}(?:\s+applicable)?\s*[:=-]\s*(?:yes|y)(?:$|[\s.,!;])`),
  // "deduct it from her paycheck", "deducting the shortage from payroll"
  /\bdeduct(?:ing|ed)?\b[^.\n]{0,40}\bfrom\s+(?:her|his|their|the|its)?\s*(?:pay|paycheck|payroll|check|wages)\b/,
  // "it will be deducted", "we'll deduct", "needs to be deducted"
  /\b(?:will|we'll|we will|going to|should|needs? to|has to|have to)\s+(?:be\s+)?deduct(?:ed)?\b/,
];

function normalize(text: string): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    // "payroll-deduct", "payroll‑deduction"
    .replace(/[‐‑–—]/g, "-")
    .replace(/\bpayroll-deduct/g, "payroll deduct")
    .replace(/[^\S\n]+/g, " ");
}

/**
 * The answer a sentence STATES about payroll deduction, or null.
 *
 * Read clause by clause, latest clause last, so "yes payroll deduct — actually
 * no, no deduction" ends on no. A clause that is itself a question ("is
 * payroll deduct applicable?") states nothing — except where the manager
 * answered it in the same breath ("payroll deduct applicable? no").
 *
 * Within one clause a negative wins: "payroll deduction doesn't apply" contains
 * "payroll deduction ... apply", and reading that as yes would be the worst
 * available mistake on a record about someone's pay.
 */
export function statedPayrollDeduct(text: string): PayrollDeductAnswer | null {
  // An answered question is a statement: "…applicable? no" -> "…applicable: no".
  const source = normalize(text).replace(/\?\s*(yes|no|y|n)\b/g, ": $1");
  let answer: PayrollDeductAnswer | null = null;

  for (const clause of source.split(/(?<=[.!?;\n])/)) {
    const trimmed = clause.trim();
    if (trimmed === "" || trimmed.endsWith("?")) continue;
    if (NEGATIVE.some((pattern) => pattern.test(trimmed))) answer = "no";
    else if (POSITIVE.some((pattern) => pattern.test(trimmed))) answer = "yes";
  }

  return answer;
}

/**
 * A bare reply — "yes", "No.", "nope", "yes it is" — read as yes or no.
 *
 * Only ever used where the question it answers is KNOWN to be the payroll one
 * (see `payrollDeductFromConversation`). On its own a "no" answers nothing.
 */
function bareAnswer(text: string): PayrollDeductAnswer | null {
  const t = normalize(text).trim().replace(/[.!]+$/, "").trim();
  if (t === "" || t.split(/\s+/).length > 6) return null;
  if (/^(?:no|n|nope|nah|not applicable|n\/a|none|it isn't|it's not|it is not|it doesn't|it does not|doesn't|does not)\b/.test(t)) {
    return "no";
  }
  if (/^(?:yes|y|yep|yeah|yup|yes please|correct|it is|it does|applicable)\b/.test(t)) {
    return "yes";
  }
  return null;
}

const PAYROLL_IN_QUESTION = /payroll\s+deduct/i;

/**
 * Which number, if any, the payroll question carries in an assistant turn's
 * numbered list — "7. Is payroll deduct applicable? (Yes or No)" is 7.
 * `unnumbered` is true when the turn asks it on its own, outside any list.
 */
function payrollQuestionIn(assistant: string): { number: number | null; alone: boolean } | null {
  if (!PAYROLL_IN_QUESTION.test(assistant)) return null;
  const numbered = [...assistant.matchAll(/^\s*(\d+)[.)]\s+(.*)$/gm)];
  const hit = numbered.find((match) => PAYROLL_IN_QUESTION.test(match[2] ?? ""));
  if (!hit) return { number: null, alone: true };
  return { number: Number(hit[1]), alone: numbered.length === 1 };
}

/** The answer a manager's numbered line gives to item `number`, if it is there. */
function numberedAnswer(reply: string, number: number): PayrollDeductAnswer | null {
  for (const line of reply.split("\n")) {
    const match = /^\s*(\d+)\s*[.):-]\s*(.+)$/.exec(line);
    if (match && Number(match[1]) === number) {
      return bareAnswer(match[2]!) ?? statedPayrollDeduct(match[2]!);
    }
  }
  return null;
}

export interface ConversationTurn {
  role: string;
  content: string;
  error?: unknown;
}

/**
 * ============================================================================
 * THE ANSWER THE CONVERSATION GAVE, IF IT GAVE ONE
 * ============================================================================
 *
 * Walks the turns in order, and the LAST answer wins, so a manager who said
 * yes and then "actually, no deduction" gets no.
 *
 * TWO WAYS A TURN ANSWERS.
 *
 *   It says so: "no payroll deduction", "yes payroll deduct applies",
 *   "deduct it from her paycheck". Any manager turn, anywhere in the form's
 *   conversation.
 *
 *   It replies to the question: Ask Sunny asked "Is payroll deduct
 *   applicable?" and the manager wrote "no" — or, to a numbered intake, a
 *   line "7. no" where 7 is the payroll item. A bare "no" to a numbered list
 *   with several questions in it is NOT read: it could be answering any of
 *   them, and the prior-corrective-action question is also a yes/no.
 *
 * ONLY THIS FORM'S TURNS. The look-back starts after the last manager turn
 * that asked for a DIFFERENT form request than the one being answered, so a
 * payroll answer given on an earlier Corrective Action for somebody else in the
 * same conversation is not carried onto this one.
 *
 * ASSISTANT TURNS NEVER ANSWER. They are read only to know which question a
 * bare reply was replying to.
 */
export function payrollDeductFromConversation(
  turns: readonly ConversationTurn[],
): PayrollDeductAnswer | null {
  const usable = turns.filter(
    (turn) => !turn.error && typeof turn.content === "string" && turn.content.trim() !== "",
  );

  const requests = usable
    .map((turn, index) => ({ turn, index }))
    .filter(({ turn }) => turn.role === "user" && detectTemplateIntent(turn.content).kind !== "none")
    .map(({ index }) => index);
  const start = requests.length >= 2 ? requests[requests.length - 2]! + 1 : 0;

  let lastAssistant = "";
  let answer: PayrollDeductAnswer | null = null;

  for (const turn of usable.slice(start)) {
    if (turn.role === "assistant") {
      lastAssistant = turn.content;
      continue;
    }
    if (turn.role !== "user") continue;

    const stated = statedPayrollDeduct(turn.content);
    if (stated) {
      answer = stated;
      continue;
    }

    const asked = payrollQuestionIn(lastAssistant);
    if (!asked) continue;
    const replied =
      (asked.number !== null ? numberedAnswer(turn.content, asked.number) : null) ??
      (asked.alone ? bareAnswer(turn.content) : null);
    if (replied) answer = replied;
  }

  return answer;
}

/**
 * The value to store for an answer: one ticked option, or nothing at all.
 * Never both boxes, never a default.
 */
export function payrollDeductChecked(
  answer: PayrollDeductAnswer | null | undefined,
): Record<string, string[]> {
  return isPayrollDeductAnswer(answer) ? { [PAYROLL_DEDUCT_KEY]: [answer] } : {};
}

/**
 * ============================================================================
 * "CHANGE PAYROLL DEDUCT TO YES" — A CORRECTION TO A CREATED FORM
 * ============================================================================
 *
 * Read only as a statement about payroll deduction: the correction flow calls
 * this on every turn once a Corrective Action Form exists, and "no" on its own
 * — or any question — must never reach the form.
 */
export function payrollDeductCorrection(text: string): PayrollDeductAnswer | null {
  if (text.trim().endsWith("?")) return null;
  const change =
    /\b(?:change|update|set|switch|correct|fix|make|mark|tick|check)\b[^.\n]{0,40}\b(?:payroll|deduct)/i.exec(text);
  if (change) {
    const after = normalize(text.slice(change.index));
    const to = /\b(?:to|as|=|:)\s*(yes|no)\b/.exec(after);
    if (to) return to[1] as PayrollDeductAnswer;
  }
  return statedPayrollDeduct(text);
}
