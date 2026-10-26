import { incidentClauseSplitEnabled } from "@/lib/config/chat-quality-flags";

/**
 * INCIDENT_CLAUSE_SPLIT_ENABLED: What happened is the incident, never a
 * fragment of the turn around it (QA, 26 Oct 2026; both apps, names invented
 * in the tests).
 *
 *   "…for devon harlan, she works at our kearney, ne salon as a tan
 *   consultant and was late today."
 *                         cut at the comma of "kearney, ne": What happened was
 *                         "ne salon as a tan consultant and was late today".
 *   "employee for 7 months", "and cite the standards of conduct as the policy
 *   violated", "the policy violated is late opening, not attendance"
 *                         the last sentence overwrote the incident.
 *   "Issue: The employee who failed to open will then be required to
 *   reimburse The Company $25"
 *                         a pasted policy paragraph replaced it.
 *
 * The readers keep their own rules. This only hands them the turn without the
 * sentences and clauses that are not the incident:
 *
 *   one clause   "kearney, ne", "lawrence, ks" (a state after a
 *                place), "$3.25", "9/25/26", "st. joe", "a.m." stay inside
 *                the clause they are in;
 *   not the      a clause that only states an employee fact (title, salon,
 *   incident     tenure: "she is the salon director at our kearney, ne",
 *                "primary salon is lawrence", "employee for 7 months"), a
 *                policy instruction ("cite … as the policy violated", "the
 *                policy violated is …") or pasted policy text ("The employee
 *                who … will then be required to …");
 *   "and"        "works at our kearney, ne salon as a tan consultant and was late
 *                today": the fact half goes, the act half stays;
 *   the app's    the intent read's own sentences in front of the turn ("The
 *   sentences    employee is …", "Policy reference: …") are never the
 *                incident;
 *   commands     "no deduct", "date 10/14", "change it to written",
 *                "verbal", "salon is …" fill their own field, never What
 *                happened.
 *
 * A clause that says what was done or not done stays whole, whoever it names,
 * so a story about two people keeps both. Off, the readers see the turn as
 * typed. The same file in both apps.
 */

const STATE_CODES =
  /^(?:A[LKZR]|C[AOT]|DE|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])$/i;

/** State codes that are also English words: only a state before a place noun or at the end. */
const WORD_CODES = /^(?:in|or|me|oh|ok|hi|de|la|pa|ma|co|al|id|ms|mt|wa|va|ar|ga)$/i;

const PLACE_NOUN = /^(?:store|salon|location|shop|area|market)\b/i;

/** "st. joe", "a.m.", "no. 5": a point that ends no sentence. Kept as "․" until the split is done. */
const ABBREVIATIONS = /\b(?:st|dr|mr|mrs|ms|jr|sr|rd|ave|blvd|hwy|pkwy|mt|ft|vs|approx|a\.m|p\.m|e\.g|i\.e)\.(?=\s|$|,)|\bno\.(?=\s*\d)|\b[ap]\.m\.?(?=\s|$|,)/gi;

const LEADER = "․";

/** "kearney, ne" → "kearney ne": the comma after a place before its state is no clause break. */
export function joinPlaceState(text: string): string {
  return text.replace(/([A-Za-z][\w'.-]*),\s*([A-Za-z]{2})(?=\s|$|[.,;!?])(?=(\s+\S+)?)/g, (whole, place: string, code: string, after?: string) => {
    if (!STATE_CODES.test(code)) return whole;
    const next = (after ?? "").trim();
    // "late, ok": a word code counts only before a place noun or where the clause ends.
    if (WORD_CODES.test(code) && next && !PLACE_NOUN.test(next) && !/^[.,;!?]/.test(next)) return whole;
    return `${place} ${code}`;
  });
}

/** The turn's sentences, a point inside an abbreviation, an amount or a date kept in its sentence. */
export function incidentSentences(text: string): string[] {
  const kept = text.replace(ABBREVIATIONS, (match) => match.replace(/\./g, LEADER));
  return kept
    .split(/[.!?;]+(?=\s|$)/)
    .map((sentence) => sentence.replace(new RegExp(LEADER, "g"), ".").trim())
    .filter(Boolean);
}

/** The clauses of a sentence: commas, except the one between a place and its state. */
export function incidentClauses(sentence: string): string[] {
  return joinPlaceState(sentence)
    // "1,000": a comma inside a number is no clause break.
    .split(/,(?!\d{3}\b)/)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

/** A date the manager typed, or a day word. */
const DATE_WORD =
  /(?<![\d/-])\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?(?![\d/-])|\b(?:today|tonight|yesterday|this\s+(?:morning|afternoon|evening)|last\s+(?:night|week|shift)|(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b/i;

/** A verb of an act or an omission: what was done, or not done. */
const ACT =
  /\b(?:late|tardy|no[\s-]?call|no[\s-]?show|ncns|absent|did\s*n[o']?t|didnt|does\s*n[o']?t|doesnt|was\s*n[o']?t|wasnt|is\s*n[o']?t|were\s*n[o']?t|has\s*n[o']?t|had\s*n[o']?t|wo\s*n'?t|never|not\s+\w+ing|failed|fails|failure\s+to|forgot|forgets|missed|misses|skipped|skips|left|leaves|walked|refused|refuses|yelled|argued|cursed|swore|stole|took|used|using|clocked|opened|closed|called\s+(?:off|in)|broke|damaged|violated|wore|wearing|slept|sleeping|smok\w*|vap\w*|shortage|overage|rude|disrespect\w*|ignored|neglected|gave|sold|charged|allowed|let|came\s+in|showed\s+up|arrived|spent|was\s+on|on\s+(?:her|his|their)\s+(?:cell\s+)?phone)\b/i;

/** The clause says what happened: an act or an omission, or a date. */
export function statesAnAct(clause: string): boolean {
  return ACT.test(clause) || DATE_WORD.test(clause);
}

const SUBJECT = String.raw`(?:(?:she|he|they|[a-z'’-]+(?:\s+[a-z'’-]+)?)\s+)?`;
const TITLE_HEAD = String.raw`(?:director|manager|consultant|member|lead|supervisor|associate|trainer|employee|hire|keyholder|tm|sd|gm|asm|dm)s?`;

/** Who the employee is, where they work, how long they have worked: never what happened. */
const EMPLOYEE_FACT: readonly RegExp[] = [
  new RegExp(String.raw`^${SUBJECT}(?:works|worked|is\s+working|is\s+based|is\s+assigned)\s+(?:at|in|out\s+of|from|for)\b`, "i"),
  new RegExp(String.raw`^${SUBJECT}(?:is|was|'s)\s+(?:a|an|the|our|my)\s+(?:[\w'’-]+\s+){0,3}${TITLE_HEAD}\b`, "i"),
  /^(?:(?:her|his|their|the|employee'?s?)\s+)?(?:primary|home|main|assigned|usual)\s+(?:store|salon|location|shop)\s+(?:is|=|:)/i,
  /^(?:(?:she|he|they)\s+(?:is|was|has\s+been)\s+)?(?:an?\s+)?(?:employee|team\s+member|tm|employed|here|with\s+(?:us|the\s+company))\s+(?:for|since)\s+/i,
  /^(?:(?:she|he|they)\s+)?(?:has|have)\s+been\s+(?:an?\s+\w+\s+|here\s+|with\s+us\s+|employed\s+|working\s+(?:here\s+)?)?(?:for|since)\s+/i,
  new RegExp(String.raw`^(?:as\s+)?(?:a|an|the|our)\s+(?:[\w'’-]+\s+){0,2}${TITLE_HEAD}$`, "i"),
];

/** "cite the standards of conduct as the policy violated", "the policy violated is late opening, not attendance". */
const POLICY_INSTRUCTION: readonly RegExp[] = [
  /^(?:and\s+|also\s+|please\s+)*(?:cite|citing|quote|use|list|put)\b.*\bpolic(?:y|ies)\b/i,
  /^(?:and\s+|also\s+)*(?:the\s+)?(?:policy|policies)(?:\s+(?:violated|broken|to\s+cite|is|was|should\s+be))?\s*(?:is|was|=|:|should\s+be)\s/i,
  /^(?:and\s+|also\s+)*(?:the\s+)?(?:violated|broken)\s+policy\s+(?:is|was|=|:)/i,
  /\bas\s+the\s+(?:policy|violation)(?:\s+violated)?\s*$/i,
];

/** A paragraph pasted from a policy: it speaks of "the employee who …" and what they "will be required" to do. */
const POLICY_TEXT: readonly RegExp[] = [
  /\b(?:will|shall|must)\s+(?:then\s+)?be\s+required\s+to\b/i,
  /\bemployees\s+(?:must|shall|are\s+(?:required|expected|responsible))\b/i,
  // "the employee who was scheduled did not show" is an account; with "will" or "must" it is a rule.
  /\b(?:the|an|any)\s+employees?\s+who\b.*\b(?:will|shall|must|may)\b/i,
];

/**
 * The sentences the intent read writes in front of the manager's turn ("The
 * employee is Kira Dunmore.", "It happened at NE Kearney.", "Policy
 * reference: …"). They are the app's, never the incident: a bare salon reply
 * left them as What happened (QA, 26 Oct 2026).
 */
const STATE_SENTENCE =
  /^(?:The form is the |The employee is |Job title:|Warning level:|Payroll deduct applies|No payroll deduction|Policy reference:|Incident:|Payroll amount:|The account continues)|^It happened (?:at|on) [^,]{1,40}$/;

export function isStateSentence(text: string): boolean {
  return STATE_SENTENCE.test(text.trim());
}

/** "skipped a tour today It happened at KS Lawrence.": the intent read's sentence glued on without a stop. */
const GLUED_STATE = /\s+It happened (?:at|on) [^.,;]{1,40}\.?$/;

/**
 * A command to the app fills a field; it is never what happened (QA, 26 Oct
 * 2026, flags on and off): "no deduct", "yes payroll deduct", "date 10/14",
 * "date is", "change it to written", "verbal", "salon is …".
 */
const SLOT_COMMAND: readonly RegExp[] = [
  /^(?:(?:yes|no)\s+)?(?:payroll\s+)?(?:deduct(?:ion|ed)?|no\s+payroll)(?:\s+(?:applies|n\/?a|not\s+applicable|\$?\d+(?:\.\d{2})?))?$/i,
  /^(?:the\s+)?date(?:\s+(?:is|=|:|should\s+be))?(?:\s+(?:\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|today|yesterday))?$/i,
  /^(?:please\s+)?(?:change|make|switch|set)\s+(?:it|this|that|the\s+(?:level|warning|form))\s+to\b/i,
  /^(?:(?:a|it'?s|its|make\s+it)\s+)?(?:verbal|written|final)(?:\s+(?:warning|ca|c\/a))?$/i,
  /^(?:the\s+)?(?:salon|store|location)\s+(?:is|=|:)\s+/i,
];

export function isSlotCommand(text: string): boolean {
  const said = text.trim().replace(/[.!]+$/, "");
  return said !== "" && SLOT_COMMAND.some((pattern) => pattern.test(said));
}

export function isPolicyInstruction(text: string): boolean {
  return POLICY_INSTRUCTION.some((pattern) => pattern.test(text.trim()));
}

export function isPolicyText(text: string): boolean {
  return POLICY_TEXT.some((pattern) => pattern.test(text));
}

/** The clause only says who they are, where they work or how long: no act in it. */
export function isEmployeeFact(clause: string, employeeName: string | null): boolean {
  let text = clause.trim().replace(/[.!?]+$/, "");
  if (employeeName) text = text.replace(new RegExp(escape(employeeName), "ig"), "she").replace(/\bshe\s+she\b/gi, "she");
  if (!text || statesAnAct(text)) return false;
  return EMPLOYEE_FACT.some((pattern) => pattern.test(text));
}

/** "works at our kearney ne salon as a tan consultant and was late today": the act half. */
function actHalves(clause: string, employeeName: string | null): string {
  const halves = clause.split(/\s+and\s+/i);
  if (halves.length < 2) return clause;
  const facts = halves.filter((half) => isEmployeeFact(half, employeeName));
  const acts = halves.filter((half) => !isEmployeeFact(half, employeeName) && statesAnAct(half));
  if (facts.length === 0 || acts.length === 0 || facts.length + acts.length !== halves.length) return clause;
  return acts.join(" and ");
}

/** "she did not do …": the pronoun before the act goes, for a reader that reads the act alone. */
function withoutSubject(clause: string): string {
  return clause.replace(/^(?:she|he|they)\s+(?=\S)/i, "");
}

/**
 * The turn as the incident readers should see it: the same words, without the
 * sentences and clauses that are not the incident. A line at a time, so a
 * reader that splits on lines still sees the same turns.
 */
export function incidentOnlyText(
  turn: string,
  employeeName: string | null,
  options: { readonly subjectless?: boolean } = {},
): string {
  return turn
    .split("\n")
    .map((line) => incidentOnlyLine(line, employeeName, options.subjectless ?? false))
    .join("\n");
}

function incidentOnlyLine(line: string, employeeName: string | null, subjectless: boolean): string {
  if (!line.trim()) return line;
  const sentences: string[] = [];
  // "st. joe": the readers split at a point too, so the abbreviation's own point goes.
  const unpointed = line.replace(ABBREVIATIONS, (match) => match.replace(/\.$/, ""));
  for (const sentence of incidentSentences(unpointed)) {
    // "Issue: The employee who failed to open will then be required …": the policy's words.
    const unlabelled = sentence.replace(/^\s*(?:issue|policy|note)\s*:\s*/i, "");
    if (isStateSentence(sentence) || isSlotCommand(sentence) || isPolicyInstruction(unlabelled) || isPolicyText(unlabelled)) continue;
    const clauses = incidentClauses(sentence.replace(GLUED_STATE, ""))
      .filter((clause) => !isPolicyInstruction(clause) && !isPolicyText(clause) && !isSlotCommand(clause))
      .map((clause) => actHalves(clause, employeeName))
      .filter((clause) => !isEmployeeFact(clause, employeeName))
      .map((clause) => (subjectless && statesAnAct(clause) ? withoutSubject(clause) : clause));
    if (clauses.length > 0) sentences.push(clauses.join(", "));
  }
  return sentences.join(". ");
}

/** The readers' input with INCIDENT_CLAUSE_SPLIT_ENABLED on; the turn as typed with it off. */
export function incidentTurn(
  turn: string,
  employeeName: string | null,
  options: { readonly subjectless?: boolean } = {},
): string {
  return incidentClauseSplitEnabled() ? incidentOnlyText(turn, employeeName, options) : turn;
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
