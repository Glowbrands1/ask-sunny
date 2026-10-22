import { normalizePayrollWording as normalize, readPayrollDeduct, statedPayrollDeduct as statedAnswer } from "./payroll-deduct-answer";
import { detectTemplateIntent } from "./template-intent";

/**
 * ============================================================================
 * "IS PAYROLL DEDUCT APPLICABLE?" — THE CORRECTIVE ACTION FORM'S YES / NO
 * ============================================================================
 *
 * Requested by Operations (Gwen Harlan, 29 September 2026): the
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

import type { PayrollDeductAnswer } from "./payroll-deduct-answer";
export type { PayrollDeductAnswer } from "./payroll-deduct-answer";

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

/*
 * One message's own answer lives in `payroll-deduct-answer.ts`, which imports
 * nothing: the warning-level reader needs it, and reaching it through this
 * module (which reads form requests) closed an import cycle.
 */
export { payrollDeductUnclear } from "./payroll-deduct-answer";

/**
 * The answer a message STATES about payroll deduction, or null — the import-free
 * reader in `payroll-deduct-answer.ts`, plus one rule that needs this module's
 * amount reader: a deduction of nothing is no deduction (review, 22 Oct 2026:
 * "$0" read as Yes).
 */
export function statedPayrollDeduct(text: string): PayrollDeductAnswer | null {
  const reading = statedAnswer(text);
  return reading === "yes" && deductsNothing(text) ? "no" : reading;
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
 * same conversation is not carried onto this one. A caller that has already
 * cut the conversation to this form's turns says so (`fromThisForm`), and the
 * look-back is not cut again: there, a second request is a repeat of this one
 * ("create ca form for <employee>"), and the answer given with the first still
 * stands (District Manager feedback, 21 Oct 2026).
 *
 * ASSISTANT TURNS NEVER ANSWER. They are read only to know which question a
 * bare reply was replying to.
 */
export function payrollDeductFromConversation(
  turns: readonly ConversationTurn[],
  options: { readonly fromThisForm?: boolean } = {},
): PayrollDeductAnswer | null {
  const usable = turns.filter(
    (turn) => !turn.error && typeof turn.content === "string" && turn.content.trim() !== "",
  );

  const requests = usable
    .map((turn, index) => ({ turn, index }))
    .filter(({ turn }) => turn.role === "user" && detectTemplateIntent(turn.content).kind !== "none")
    .map(({ index }) => index);
  const start = !options.fromThisForm && requests.length >= 2 ? requests[requests.length - 2]! + 1 : 0;

  let lastAssistant = "";
  let answer: PayrollDeductAnswer | null = null;

  for (const turn of usable.slice(start)) {
    if (turn.role === "assistant") {
      lastAssistant = turn.content;
      continue;
    }
    if (turn.role !== "user") continue;

    const stated = readPayrollDeduct(turn.content);
    if (stated === "unclear") {
      /*
       * A later turn about the deduction that cannot be read safely ("we're
       * not doing the $25 payroll deduction") clears an earlier Yes, so the
       * card asks again instead of keeping a Yes the manager may have
       * withdrawn (QA, 22 Oct 2026).
       */
      answer = null;
      continue;
    }
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
 * A reply to Ask Sunny's own payroll question, when that question was the last
 * thing it asked — "no", "Yes.", or "7. no" to a numbered intake. Read the
 * same way the proposal reads it, so the answer the manager gives after the
 * form is created lands on the form instead of being asked for again.
 */
export function payrollDeductReply(text: string, lastAssistant: string): PayrollDeductAnswer | null {
  const asked = payrollQuestionIn(lastAssistant);
  if (!asked) return null;
  return (asked.number !== null ? numberedAnswer(text, asked.number) : null) ?? (asked.alone ? bareAnswer(text) : null);
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
  /*
   * A point inside an amount ("the $5.00 payroll deduction") does not end the
   * sentence — QA audit, 22 Oct 2026: "change the $5.00 payroll deduction to
   * no" read as nothing, and the form kept its Yes.
   */
  const change =
    /\b(?:change|update|set|switch|correct|fix|make|mark|tick|check)\b(?:[^.\n]|\.(?=\d)){0,40}\b(?:payroll|deduct)/i.exec(text);
  if (change) {
    const after = normalize(text.slice(change.index));
    const to = /\b(?:to|as|=|:)\s*(yes|no)\b/.exec(after);
    if (to) return to[1] as PayrollDeductAnswer;
    /* "change the payroll deduction to $5.00": a new amount to take is a Yes, said in so many words. */
    if (new RegExp(String.raw`\bto\s+${ANY_MONEY}`).test(after) && !NOT_TAKEN.test(after)) {
      return deductsNothing(text) ? "no" : "yes";
    }
  }
  return statedPayrollDeduct(text);
}

/*
 * ============================================================================
 * THE AMOUNT, AND THE ACTION PLAN THAT SAYS IT
 * ============================================================================
 *
 * District Manager feedback, 21 Oct 2026: "payroll deduct of $3.25 is
 * applicable" — the Action Plan did not say that $3.25 would be deducted. The
 * amount is the manager's, read here exactly as they wrote it, and only from
 * words about the deduction: "deduct(ion) of $3.25", "$3.25 will be deducted",
 * "$25 will be payroll deducted", "a $25 payroll deduction", "deduct $3.25".
 * A register short $3.25 is not, on its own, an amount to deduct. Never an
 * amount the manager did not write.
 */
/*
 * "$1,250" — a comma only BETWEEN digit groups. "payroll deduct $25, she was
 * late" would put "$25," on the Action Plan: the comma ending the clause was
 * read as part of the amount (QA, 22 Oct 2026; fixed in Ask Bubbles 711f893).
 */
const MONEY = String.raw`\$\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?(?![\d,]\d)`;
/*
 * "25 DOLLARS", "DEDUCTED 3.25" — QA audit, 22 Oct 2026: an amount the manager
 * wrote without the sign was not read, and the plan said only "A payroll
 * deduction applies." Money by its word ("dollars", "bucks") or by its cents.
 * A bare whole number ("deduct 25") is not money — it could be minutes or a
 * store — and is never read as one.
 */
const UNSIGNED_MONEY = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?\s*(?:dollars?|bucks)\b|\d+\.\d{2}\b(?![\d,]\d)`;
const ANY_MONEY = String.raw`(?:${MONEY}|${UNSIGNED_MONEY})`;
/** A deduction denied, waived or cancelled in the words after a change verb. */
const NOT_TAKEN = /\b(?:no|not|never|none|don't|dont|won't|wont|waived?|cancell?ed|cancel|skip)\b/;
/** "$ 25" → "$25"; "25 dollars" → "$25"; "3.25" → "$3.25". */
function asDollars(written: string): string {
  const compact = written.replace(/\s+/g, "");
  if (compact.startsWith("$")) return compact;
  return `$${/^[\d,]+(?:\.\d{2})?/.exec(compact)![0]}`;
}
const AMOUNT_PATTERNS: readonly RegExp[] = [
  new RegExp(String.raw`\b(?:payroll\s+)?deduct(?:ion|ions|ed|ing)?\s+(?:of\s+|for\s+|is\s+|to\s+|will\s+be\s+|amount\s+(?:of\s+|is\s+|to\s+)?)?(${ANY_MONEY})`, "gi"),
  /*
   * "$25 will be payroll deducted", "$25 payroll-deducted", "a $25 payroll
   * deduction" (District Manager feedback, 21 Oct 2026: "state $25 will be
   * payroll deducted" went unread, and the plan said only that a deduction
   * applies).
   */
  new RegExp(
    String.raw`(${ANY_MONEY})\s+(?:will\s+be\s+|is\s+(?:being\s+)?|to\s+be\s+|should\s+be\s+|gets?\s+|being\s+)?(?:payroll[- ]?\s*)?(?:deducted\b|deductions?\b)`,
    "gi",
  ),
];

/** The amount the manager said would be deducted — "$3.25" — or null. The latest one stated wins. */
export function payrollDeductAmount(text: string): string | null {
  const amount = latestAmount(text);
  return amount === null || isZero(amount) ? null : amount;
}

/** The latest amount stated for the deduction, zero included. */
function latestAmount(text: string): string | null {
  let found: { at: number; amount: string } | null = null;
  for (const pattern of AMOUNT_PATTERNS) {
    for (const match of (text ?? "").matchAll(pattern)) {
      const amount = asDollars(match[1]!);
      if (!found || match.index >= found.at) found = { at: match.index, amount };
    }
  }
  return found?.amount ?? null;
}

const isZero = (amount: string) => Number(amount.replace(/[$,]/g, "")) === 0;

/** Whether the latest amount stated for the deduction is zero — "$0", "0 dollars". */
function deductsNothing(text: string): boolean {
  const amount = latestAmount(text);
  return amount !== null && isZero(amount);
}

/**
 * ============================================================================
 * THE AMOUNT THE CITED SECTION ITSELF STATES
 * ============================================================================
 *
 * The manual's Late Opening section states what a late opener reimburses —
 * "$25.00 via payroll deduction". Where the manager answered Yes and gave no
 * amount, and the section Direct policy QUOTES on this form states one, the
 * plan may state it, in the manual's own figure (District Manager feedback,
 * 21 Oct 2026). Read only from that quoted wording (never a section that was
 * not quoted, never the Source line, never the manager's words), only from a
 * sentence about a payroll deduction, and only where exactly one amount is
 * stated: two different amounts, or none, and the plan says "A payroll
 * deduction applies." as before.
 */
export function quotedDeductionAmount(policyText: string | null | undefined): string | null {
  const text = (policyText ?? "")
    .split("\n")
    .filter((line) => !/^\s*Source:/i.test(line))
    .join(" ")
    .replace(/\s+/g, " ");
  const amounts = new Map<number, string>();
  for (const sentence of text.split(/(?<=[.!?])\s+(?=[A-Z])/)) {
    if (
      !/\bpayroll\s+deduct|\bdeduct\w*\s+from\s+(?:the\s+|their\s+|his\s+|her\s+)?(?:employee'?s?\s+)?(?:pay|paycheck|check|wages)\b/i.test(
        sentence,
      )
    ) {
      continue;
    }
    for (const match of sentence.matchAll(new RegExp(MONEY, "g"))) {
      const written = match[0].replace(/\s+/g, "");
      const value = Number(written.replace(/[$,]/g, ""));
      if (Number.isFinite(value) && !amounts.has(value)) amounts.set(value, written);
    }
  }
  return amounts.size === 1 ? [...amounts.values()][0]! : null;
}

/**
 * The Action Plan's payroll sentence, when the manager answered Yes: "$3.25
 * will be deducted from Tess's pay.", or, with no amount stated, "A payroll
 * deduction applies." Null on No or no answer — the plan then says nothing
 * about pay. Placed by `ca-action-plan.ts` between the review sentence and the
 * form's required closing (District Manager feedback, 21 Oct 2026: the plan is
 * built by code, so the deduction is one of its sentences rather than text
 * added after a drafted paragraph).
 */
export function payrollDeductSentence(input: {
  answer: PayrollDeductAnswer | null;
  amount: string | null;
  firstName: string | null;
}): string | null {
  if (input.answer !== "yes") return null;
  if (!input.amount) return "A payroll deduction applies.";
  const whose = input.firstName ? `${input.firstName}'s` : "the employee's";
  return `${input.amount} will be deducted from ${whose} pay.`;
}
