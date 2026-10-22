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

/*
 * "PAYROLL DEDUCT OF $3.25 IS APPLICABLE" — the subject, what it is of or for,
 * then the answer. District Manager feedback, 21 Oct 2026: the amount between
 * them hid the answer and the manager was asked "Yes or No?". At most a few
 * words between, within the clause; the negative is read first.
 */
const OF_WHAT = String.raw`\s+(?:of|for|on)\s+(?:[^.!?;\n]|\.(?=\d)){1,30}?\s+`;
const NEGATIVE: readonly RegExp[] = [
  // "payroll deduct of $3.25 is not applicable"
  new RegExp(
    String.raw`\b${SUBJECT}${OF_WHAT}(?:is\s+|does\s+|would\s+|will\s+)?(?:not|n't|isn't|doesn't|won't|wont|isnt|doesnt)\s+(?:be\s+)?(?:applicable|apply|applies|needed|required|necessary)\b`,
  ),
  // "no payroll deduct", "no deduction", "no to payroll deduction", "no, payroll"
  new RegExp(String.raw`\bno\b[\s,:-]*(?:to\s+)?(?:the\s+|a\s+)?${SUBJECT}\b`),
  // "payroll deduct is not applicable", "payroll deduction doesn't apply"
  new RegExp(
    String.raw`\b${SUBJECT}\s+(?:is\s+|does\s+|would\s+|will\s+)?(?:not|n't|isn't|doesn't|won't|wont|isnt|doesnt)\s+(?:be\s+)?(?:applicable|apply|applies|needed|required|necessary)\b`,
  ),
  // "payroll deduct: no", "payroll deduct applicable - no", "payroll deduct = n/a"
  new RegExp(String.raw`\b${SUBJECT}(?:\s+applicable)?\s*[:=-]\s*(?:no|n|none|n/a|not applicable)(?:$|[\s.,!;])`),
  // "payroll deduct no", "payroll deduction applicable no" — the answer last in its clause, not "no longer"
  new RegExp(String.raw`\b${SUBJECT}(?:\s+applicable)?\s+(?:no|n|nope)\s*(?:$|[.,!;])`),
  // "payroll deduct n/a", "payroll deduction not applicable", "payroll deduct none"
  new RegExp(String.raw`\b${SUBJECT}(?:\s+applicable)?\s+(?:is\s+)?(?:n/a|not applicable|none)(?:$|[\s.,!;])`),
  // "we won't deduct", "don't deduct it from her pay", "not deducting"
  /\b(?:don't|dont|do not|won't|wont|will not|not|no need to|shouldn't|should not)\s+(?:be\s+)?deduct(?:ing|ed)?\b/,
  /\bwithout\s+(?:a\s+|any\s+)?(?:payroll\s+)?deduction\b/,
  /*
   * "WE WILL NOT PAYROLL DEDUCT $25" — QA, 22 Oct 2026 (F-01). The negation
   * above only allowed "be" before "deduct", so "will not payroll deduct $25"
   * and "don't payroll deduct $25" fell through to the amount reading below
   * and came back Yes. Any negation of the deduction, "payroll" or not.
   */
  /\b(?:don't|dont|do not|won't|wont|will not|would not|wouldn't|not going to|(?:is|are|am)n't going to|(?:is|are|am) not going to|no longer|never|not|no need to|shouldn't|should not|can't|cannot|can not|(?:decided|chose|choose) not to)\s+(?:be\s+)?(?:payroll[\s-]+)?deduct(?:ing|ed|ion|ions)?\b/,
  /*
   * "$25 PAYROLL DEDUCTION WAS WAIVED" (F-01): a waived deduction is not one.
   * The waiver may come after the subject or before it ("we waived the
   * payroll deduction"), within the clause.
   */
  new RegExp(String.raw`\b${SUBJECT}\b[^.!?;\n]{0,40}\b(?:waived?|waiving|forgiven)\b`),
  new RegExp(String.raw`\b(?:waive|waived|waiving|waiver\s+of|forgive|forgave|forgiven)\b[^.!?;\n]{0,30}\b${SUBJECT}\b`),
  // "payroll deduct $25 does not apply", "$25 payroll deduction is not needed" (QA, 22 Oct 2026)
  new RegExp(
    String.raw`\b${SUBJECT}\s+\$\s?\d[\d,]*(?:\.\d{1,2})?\s+(?:is\s+|does\s+|would\s+|will\s+)?(?:not|n't|isn't|doesn't|won't|wont|isnt|doesnt)\s+(?:be\s+)?(?:applicable|apply|applies|needed|required|necessary)\b`,
  ),
];

/*
 * NOT DECIDED IS NOT AN ANSWER (F-01). "maybe deduct $25", "not sure about
 * payroll deduct", "thinking about a $25 deduction": a clause about the
 * deduction that says the manager has not decided states nothing, so Ask
 * Sunny asks instead of reading the amount as a Yes.
 */
const UNDECIDED =
  /\b(?:maybe|perhaps|possibly|might|not sure|unsure|undecided|tbd|to be determined|thinking (?:about|of)|considering|depending|whether|if needed|may (?:need|have|be))\b/;
const ABOUT_DEDUCTION = new RegExp(String.raw`\b${SUBJECT}\b|\bdeduct\w*`);

/*
 * A YES THE MANAGER SAID IN SO MANY WORDS: "yes", "applies", "is applicable".
 */
const POSITIVE_STATED: readonly RegExp[] = [
  // "payroll deduct of $3.25 is applicable", "payroll deduction for the shortage applies"
  new RegExp(
    String.raw`\b${SUBJECT}${OF_WHAT}(?:is\s+|does\s+|will\s+|would\s+)?(?:be\s+)?(?:applicable|applies|apply|needed|required|necessary)\b`,
  ),
  // "yes payroll deduct applies", "yes to payroll deduction", "yes, deduction"
  new RegExp(String.raw`\byes\b[\s,:-]*(?:to\s+)?(?:the\s+|a\s+)?${SUBJECT}\b`),
  // "payroll deduct applies", "payroll deduction is applicable", "payroll deduct needed"
  new RegExp(
    String.raw`\b${SUBJECT}\s+(?:is\s+|does\s+|will\s+|would\s+)?(?:be\s+)?(?:applicable|applies|apply|needed|required|necessary)\b`,
  ),
  // "payroll deduct: yes", "payroll deduct applicable - yes"
  new RegExp(String.raw`\b${SUBJECT}(?:\s+applicable)?\s*[:=-]\s*(?:yes|y)(?:$|[\s.,!;])`),
  // "payroll deduct yes", "payroll deduction applicable yes"
  new RegExp(String.raw`\b${SUBJECT}(?:\s+applicable)?\s+(?:yes|y)\s*(?:$|[.,!;])`),
];

/*
 * ============================================================================
 * A YES READ FROM AN AMOUNT OR A VERB IS ONLY A YES WHEN NOTHING DENIES IT
 * ============================================================================
 *
 * QA, 22 Oct 2026 (F-01, follow-up). "payroll deduct $25" and "$25 payroll
 * deduction" are a Yes because they name a deduction to take — but so do
 * "we're not doing the $25 payroll deduction", "skip the $25 payroll
 * deduction", "no need for the $25 payroll deduction" and "payroll deduct $25
 * does not apply", and a list of negative phrasings can never name every way
 * a manager says no. So these readings are a Yes only when no word next to
 * them — in the same stretch of the clause, up to a comma — denies, waives,
 * cancels or replaces the deduction. Where one does, the clause is UNCLEAR:
 * nothing is read, and the manager is asked. Never Yes, and never a No the
 * manager did not say.
 */
const POSITIVE_IMPLIED: readonly RegExp[] = [
  // "deduct it from her paycheck", "deducting the shortage from payroll"
  /\bdeduct(?:ing|ed)?\b[^.\n]{0,40}\bfrom\s+(?:her|his|their|the|its)?\s*(?:pay|paycheck|payroll|check|wages)\b/,
  // "it will be deducted", "we'll deduct", "needs to be deducted", "$25 will be payroll deducted"
  /\b(?:will|we'll|we will|going to|should|needs? to|has to|have to)\s+(?:be\s+)?(?:payroll\s+)?deduct(?:ed)?\b/,
  // "payroll deduct $25", "deduct $3.25", "deduction of $25" — an amount to take is a yes
  /\b(?:payroll\s+)?deduct(?:ion|ed|ing)?\s+(?:of\s+|for\s+)?\$\s?\d/,
  // "$25 payroll deduction", "$25 payroll deduct"
  /\$\s?\d[\d,]*(?:\.\d{1,2})?\s+payroll\s+deduct/,
];

const POSITIVE: readonly RegExp[] = [...POSITIVE_STATED, ...POSITIVE_IMPLIED];

/** A word that denies, waives, cancels or replaces what it stands next to. */
const DENIAL =
  /(?:^|[^a-z'])(?:not|no|never|none|nor|without|skip|skips|skipped|skipping|waive|waived|waives|waiving|waiver|forgive|forgiven|forgave|cancel|cancels|cancelled|canceled|cancelling|canceling|instead|except|unless|dont|wont|didnt|doesnt|isnt|arent|wasnt|werent|cant|shouldnt|wouldnt|hold off|holding off)(?=$|[^a-z'])|n't(?=$|[^a-z])/;

/*
 * "WE DID NOT WAIVE THE PAYROLL DEDUCTION" (F-01, follow-up): a waiver that is
 * itself denied is not a No — and reading it as a Yes would be a guess. The
 * manager is asked.
 */
const DENIED_WAIVER = /(?:\b(?:not|never|no)\b|n't)\s+(?:[a-z']+\s+){0,2}waiv/;

/** Whether the words beside an implied Yes, up to a comma either side, deny it. */
function deniedNearby(clause: string, at: number, end: number): boolean {
  const before = clause.slice(0, at).split(",").pop()!.trim().split(/\s+/).slice(-6).join(" ");
  const after = clause.slice(end).split(",")[0]!.trim().split(/\s+/).slice(0, 4).join(" ");
  return DENIAL.test(before) || DENIAL.test(after);
}

/** Yes, No, nothing about the deduction (null), or something about it that cannot safely be read. */
type ClauseReading = PayrollDeductAnswer | "unclear" | null;

function readClause(clause: string): ClauseReading {
  if (UNDECIDED.test(clause) && ABOUT_DEDUCTION.test(clause)) return "unclear";
  if (DENIED_WAIVER.test(clause) && ABOUT_DEDUCTION.test(clause)) return "unclear";
  const negative = NEGATIVE.find((pattern) => pattern.test(clause));
  if (negative) {
    /*
     * BOTH IN ONE CLAUSE IS NO ANSWER (F-01). With the negative's own words
     * taken out, a Yes still standing ("payroll deduct yes, don't deduct")
     * means the clause contradicts itself: nothing is read, and the manager
     * is asked. Never Yes.
     */
    const rest = clause.replace(negative, " ");
    return POSITIVE.some((pattern) => pattern.test(rest)) ? "unclear" : "no";
  }
  if (POSITIVE_STATED.some((pattern) => pattern.test(clause))) return "yes";
  let implied = false;
  for (const pattern of POSITIVE_IMPLIED) {
    const match = new RegExp(pattern.source, "g");
    for (const hit of clause.matchAll(match)) {
      if (deniedNearby(clause, hit.index, hit.index + hit[0].length)) return "unclear";
      implied = true;
    }
  }
  return implied ? "yes" : null;
}

/**
 * Every clause read in order, the latest one that says anything about the
 * deduction winning — including "unclear", which overrides an earlier Yes.
 */
function readPayrollDeduct(text: string): ClauseReading {
  // An answered question is a statement: "…applicable? no" -> "…applicable: no".
  const source = normalize(text).replace(/\?\s*(yes|no|y|n)\b/g, ": $1");
  let answer: ClauseReading = null;

  // A point inside an amount ("$3.25") does not end a clause.
  for (const clause of source.split(/(?<=[!?;\n]|\.(?!\d))/)) {
    const trimmed = clause.trim();
    if (trimmed === "" || trimmed.endsWith("?")) continue;
    const reading = readClause(trimmed);
    if (reading !== null) answer = reading;
  }

  return answer;
}

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
/**
 * Whether a turn says something about the deduction that cannot safely be read
 * as Yes or No ("actually we're not doing the $25 payroll deduction"). Such a
 * turn still belongs to the open Corrective Action Form: it withdraws an
 * earlier answer, and the card asks again (QA, 22 Oct 2026).
 */
export function payrollDeductUnclear(text: string): boolean {
  return readPayrollDeduct(text) === "unclear";
}

export function statedPayrollDeduct(text: string): PayrollDeductAnswer | null {
  const reading = readPayrollDeduct(text);
  return reading === "unclear" ? null : reading;
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
  const change =
    /\b(?:change|update|set|switch|correct|fix|make|mark|tick|check)\b[^.\n]{0,40}\b(?:payroll|deduct)/i.exec(text);
  if (change) {
    const after = normalize(text.slice(change.index));
    const to = /\b(?:to|as|=|:)\s*(yes|no)\b/.exec(after);
    if (to) return to[1] as PayrollDeductAnswer;
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
 * late" put "$25," on the Action Plan ("$25, will be deducted from …'s pay"):
 * the comma ending the clause was read as part of the amount (QA, 22 Oct 2026).
 */
const MONEY = String.raw`\$\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?(?![\d,]\d)`;
const AMOUNT_PATTERNS: readonly RegExp[] = [
  new RegExp(String.raw`\b(?:payroll\s+)?deduct(?:ion|ions|ed|ing)?\s+(?:of\s+|for\s+|is\s+|will\s+be\s+|amount\s+(?:of\s+|is\s+)?)?(${MONEY})`, "gi"),
  /*
   * "$25 will be payroll deducted", "$25 payroll-deducted", "a $25 payroll
   * deduction" (District Manager feedback, 21 Oct 2026: "state $25 will be
   * payroll deducted" went unread, and the plan said only that a deduction
   * applies).
   */
  new RegExp(
    String.raw`(${MONEY})\s+(?:will\s+be\s+|is\s+(?:being\s+)?|to\s+be\s+|should\s+be\s+|gets?\s+|being\s+)?(?:payroll[- ]?\s*)?(?:deducted\b|deductions?\b)`,
    "gi",
  ),
];

/** The amount the manager said would be deducted — "$3.25" — or null. The latest one stated wins. */
export function payrollDeductAmount(text: string): string | null {
  let found: { at: number; amount: string } | null = null;
  for (const pattern of AMOUNT_PATTERNS) {
    for (const match of (text ?? "").matchAll(pattern)) {
      const amount = match[1]!.replace(/\s+/g, "");
      if (!found || match.index >= found.at) found = { at: match.index, amount };
    }
  }
  return found?.amount ?? null;
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
