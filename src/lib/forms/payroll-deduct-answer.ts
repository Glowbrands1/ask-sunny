/**
 * The payroll-deduct answer ONE message states — "no payroll deduct", "payroll
 * deduct of $3.25 is applicable", "we aren't docking her pay" — read with the
 * production safety rules (QA F-01: a cancelled, waived, undecided or
 * contradicted deduction is never read as Yes). See `payroll-deduct.ts` for the
 * question, the form's options and reading a whole conversation.
 *
 * Pure, browser-safe, and IMPORTS NOTHING: the warning-level reader uses it,
 * and `payroll-deduct.ts` imports the form-request reader, which imports the
 * warning-level reader — so living there made an import cycle (QA, 22 Oct 2026).
 */

export type PayrollDeductAnswer = "yes" | "no";

/** "payroll deduct", "payroll deduction(s)", "payroll", "deduction". */
// "payroll ded", "payroll ded." — the abbreviation, after "payroll" only (QA, 22 Oct 2026, round 3).
const SUBJECT = String.raw`(?:payroll\s+deduct(?:ion|ions|ed)?|payroll\s+ded\.?(?=\s|:|=|-|$)|payroll|deduct(?:ion|ions)?)`;

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
  new RegExp(String.raw`\b${SUBJECT}(?:\s+applicable)?\s+(?:no|n|nope)\s*(?:$|[.,!;|/]|-\s)`),
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
  /*
   * Said OF the deduction — "the deduction was/is waived", "cancel the $25
   * deduction" — never a cancelled thing nearby: "payroll deduction of $25 for
   * the cancelled order is applicable" is a Yes (review, 22 Oct 2026, from Ask
   * Sunny's audit).
   */
  new RegExp(String.raw`\b${SUBJECT}\b[^.!?;,\n]{0,25}?\b(?:is|was|has\s+been|have\s+been|been|be|got|are|were)\s+(?:waived|forgiven|cancell?ed|called\s+off)\b`),
  // "we cancelled the $25 payroll deduction" (QA, 22 Oct 2026): cancelled is waived.
  new RegExp(String.raw`\b(?:waive|waived|waiving|waiver\s+of|forgive|forgave|forgiven|cancel|cancell?ed|cancell?ing|call\s+off|called\s+off)\s+(?:the\s+|a\s+|her\s+|his\s+|their\s+|this\s+|that\s+)?(?:\$\s?\d[\d,]*(?:\.\d{1,2})?\s+|\d[\d,]*(?:\.\d{2})?\s+)?${SUBJECT}\b`),
  // "payroll deduct $25 does not apply", "$25 payroll deduction is not needed" (QA, 22 Oct 2026)
  new RegExp(
    String.raw`\b${SUBJECT}\s+\$\s?\d[\d,]*(?:\.\d{1,2})?\s+(?:is\s+|does\s+|would\s+|will\s+)?(?:not|n't|isn't|doesn't|won't|wont|isnt|doesnt)\s+(?:be\s+)?(?:applicable|apply|applies|needed|required|necessary)\b`,
  ),
  /*
   * "We aren't docking her pay", "not taking it out of her check", "no pay
   * deduction" — the same answer without the form's words (QA, 22 Oct 2026,
   * round 3). Each can only read No.
   */
  /\b(?:don't|dont|do not|won't|wont|will not|not|aren't|arent|are not|isn't|is not|no need to|shouldn't|should not)\s+(?:be\s+)?(?:going\s+to\s+)?dock(?:ing|ed)?\b/,
  /\bno\s+(?:pay\s+)?docking\b|\bno\s+pay\s+deduction\b/,
  /\b(?:don't|dont|do not|won't|wont|will not|not|aren't|are not|no need to)\s+(?:be\s+)?(?:going\s+to\s+)?(?:tak(?:e|ing)|com(?:e|ing))\s+(?:it\s+|anything\s+|that\s+|this\s+)?out\s+of\s+(?:her|his|their)\s+(?:pay|paycheck|check|wages)\b/,
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
  new RegExp(String.raw`\b${SUBJECT}(?:\s+applicable)?\s+(?:yes|y)\s*(?:$|[.,!;|/]|-\s)`),
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
  // "payroll deduct $25", "deduct $3.25", "deduction of $25", "deduct 25 dollars" — an amount to take is a yes
  /\b(?:payroll\s+)?deduct(?:ion|ed|ing)?\s+(?:of\s+|for\s+)?(?:\$\s?\d|\d[\d,]*(?:\.\d{2})?\s*(?:dollars?|bucks)\b|\d+\.\d{2}\b)/,
  // "$25 payroll deduction", "$25 payroll deduct", "25 dollar payroll deduction"
  /(?:\$\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{2})?\s*(?:dollars?|bucks))\s+payroll\s+deduct/,
  // "dock her pay", "take it out of her check" (QA, 22 Oct 2026, round 3) — a Yes only when nothing beside it denies it
  /\bdock(?:ing|ed)?\s+(?:her|his|their)\s+(?:pay|paycheck|check|wages)\b/,
  /\b(?:take|taking|comes?|coming)\s+(?:it\s+|that\s+|this\s+|the\s+\w+\s+)?out\s+of\s+(?:her|his|their)\s+(?:pay|paycheck|check|wages)\b/,
];

const POSITIVE: readonly RegExp[] = [...POSITIVE_STATED, ...POSITIVE_IMPLIED];

/** A word that denies, waives, cancels or replaces what it stands next to. */
export const DENIAL =
  /(?:^|[^a-z'])(?:not|no|never|none|nor|without|skip|skips|skipped|skipping|waive|waived|waives|waiving|waiver|forgive|forgiven|forgave|cancel|cancels|cancelled|canceled|cancelling|canceling|instead|except|unless|dont|wont|didnt|doesnt|isnt|arent|wasnt|werent|cant|shouldnt|wouldnt|hold off|holding off)(?=$|[^a-z'])|n't(?=$|[^a-z])/;

/*
 * "WE DID NOT WAIVE THE PAYROLL DEDUCTION" (F-01, follow-up): a waiver that is
 * itself denied is not a No — and reading it as a Yes would be a guess. The
 * manager is asked.
 */
const DENIED_WAIVER = /(?:\b(?:not|never|no)\b|n't)\s+(?:[a-z']+\s+){0,2}(?:waiv|cancel|call(?:ed)?\s+off)/;

/** Whether the words beside an implied Yes, up to a comma either side, deny it. */
function deniedNearby(clause: string, at: number, end: number): boolean {
  const before = clause.slice(0, at).split(",").pop()!.trim().split(/\s+/).slice(-6).join(" ");
  const after = clause.slice(end).split(",")[0]!.trim().split(/\s+/).slice(0, 4).join(" ");
  return DENIAL.test(before) || DENIAL.test(after);
}

/** Yes, No, nothing about the deduction (null), or something about it that cannot safely be read. */
export type ClauseReading = PayrollDeductAnswer | "unclear" | null;

/*
 * NOT_DEDUCTIBLE_READ_ENABLED (manager, 26 Oct 2026: "… verbal warning received
 * … not payroll deductible Tanning Consultant"): "not payroll deductible",
 * "non-deductible" said No, but no pattern read it, and the payroll question
 * was asked on every turn. With the flag on it is a No. Read from the
 * environment here because this module imports nothing (see the top).
 */
const NOT_DEDUCTIBLE = /\b(?:not|isn't|isnt|is not|non)[\s-]+(?:payroll\s+)?deductible\b/;
function notDeductibleRead(): boolean {
  const raw = typeof process === "undefined" ? undefined : process.env.NOT_DEDUCTIBLE_READ_ENABLED;
  return typeof raw === "string" && ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function readClause(clause: string): ClauseReading {
  if (UNDECIDED.test(clause) && ABOUT_DEDUCTION.test(clause)) return "unclear";
  if (DENIED_WAIVER.test(clause) && ABOUT_DEDUCTION.test(clause)) return "unclear";
  const negative = NEGATIVE.find((pattern) => pattern.test(clause)) ?? (notDeductibleRead() && NOT_DEDUCTIBLE.test(clause) ? NOT_DEDUCTIBLE : undefined);
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
export function readPayrollDeduct(text: string): ClauseReading {
  // An answered question is a statement: "…applicable? no" -> "…applicable: no".
  const source = normalizePayrollWording(text).replace(/\?\s*(yes|no|y|n)\b/g, ": $1");
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

/**
 * CA_SHORTCUT_WORDS_ENABLED (Pau, 29 Oct 2026: "recognize all form wording …
 * so when manager type shortcuts, it can understand it"). Read here, not
 * through `chat-quality-flags`, because this module imports nothing.
 */
function caShortcutWordsOn(): boolean {
  const raw = typeof process === "undefined" ? undefined : process.env.CA_SHORTCUT_WORDS_ENABLED;
  return typeof raw === "string" && ["1", "true", "on", "yes"].includes(raw.trim().toLowerCase());
}

/** Lower case, curly quotes straightened, "payroll-deduct" spaced — the text the patterns read. */
export function normalizePayrollWording(text: string): string {
  const read = (text ?? "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    // "payroll-deduct", "payroll‑deduction"
    .replace(/[‐‑–—]/g, "-")
    .replace(/\bpayroll-deduct/g, "payroll deduct")
    .replace(/[^\S\n]+/g, " ");
  if (!caShortcutWordsOn()) return read;
  return (
    read
      // CA_SHORTCUT_WORDS_ENABLED: "no PD", "PD applies", "pd yes", "PD $25" — the form's own abbreviation.
      .replace(/\bp\.?\s?d\.?(?=\s|:|=|-|,|;|\.|!|$)/g, "payroll deduct")
      // "deduct 25", "payroll deduct 25" — an amount with no dollar sign, not a time or a count.
      .replace(
        /\b(payroll deduct(?:ion)?|deduct(?:ion)?)\s+(\d{1,4}(?:\.\d{2})?)\b(?!\s*(?:%|min|mins|minutes|hrs?|hours?|days?|weeks?|times|x\b|am\b|pm\b))/g,
        "$1 $$$2",
      )
  );
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
/**
 * The text the deducted amount is read from. With CA_SHORTCUT_WORDS_ENABLED,
 * the shortcuts' wording ("deduct 25", "PD 25" → "$25"); off, the text as
 * typed. Read by `payrollDeductAmount` (Pau, 30 Oct 2026: "Ok amount line").
 */
export function payrollAmountWording(text: string): string {
  return caShortcutWordsOn() ? normalizePayrollWording(text) : text;
}

export function payrollDeductUnclear(text: string): boolean {
  return readPayrollDeduct(text) === "unclear";
}

export function statedPayrollDeduct(text: string): PayrollDeductAnswer | null {
  const reading = readPayrollDeduct(text);
  return reading === "unclear" ? null : reading;
}
