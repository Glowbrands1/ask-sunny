import { extractFormDate, listFormDates } from "./form-date-answer";
import { JOB_TITLES, extractJobTitle } from "./proposal";
import { SALON_PHRASE, resolveSalonText, tidyWords } from "./salon-text";
import type { FormDocument } from "./document";
import { enforcePersonEdit } from "./responsibility";
import {
  DEMOTION_TEMPLATE_KEY,
  STATED_FACT_KEYS,
  POSITION_TRANSFER_TEMPLATE_KEY,
} from "./employment-change-library";

/**
 * ============================================================================
 * WHAT THE MANAGER SAID ABOUT A DEMOTION OR A TRANSFER
 * ============================================================================
 *
 * A deterministic reading of the manager's OWN words — never an assistant
 * turn, and never a model's interpretation. It returns only what was stated:
 * a fact nobody gave is absent, and the chat asks for it or the manager ticks
 * it on the form. Nothing here has a default.
 *
 * FORGIVING ABOUT HOW, STRICT ABOUT WHETHER. Case, spacing, punctuation and
 * the usual abbreviations do not matter — "FT", "full time" and "Full-Time"
 * are one status; "SD" and "salon director" one title; "10/5/26", "oct 5" and
 * "October 5, 2026" one date (through the same `extractFormDate` the form date
 * uses). What DOES matter is direction and statement: "$15/hr" on its own is
 * not a current or a new rate, "FT" on its own is not a status, and a question
 * is not a statement. So the reader takes a value only where the sentence says
 * which side it belongs to:
 *
 *   "from X to Y" / "X → Y"                 X is current, Y is new
 *   "demote / transfer / move ... to Y"     Y is new
 *   "current title is X", "new pay: $12"    labelled
 *   "<Name> is an SD", "currently FT"       current
 *   "effective 10/5"                        the effective date
 *
 * Each of the manager's turns is read in order and a later statement replaces
 * an earlier one, which is what lets "actually make the new location salon
 * 24" correct a proposal before it is created.
 *
 * VOLUNTARY / INVOLUNTARY IS READ ONLY FROM EXPLICIT
 * WORDS. "She asked to step down" is voluntary because that is what the form's
 * own example calls it; nothing is ever inferred from tone, and conflicting
 * statements cancel rather than pick one.
 */

export type EmploymentChangeKind = "demotion" | "transfer";

const KIND_BY_TEMPLATE: Record<string, EmploymentChangeKind> = {
  [DEMOTION_TEMPLATE_KEY]: "demotion",
  [POSITION_TRANSFER_TEMPLATE_KEY]: "transfer",
};

export function employmentChangeKind(templateKey: string | null | undefined): EmploymentChangeKind | null {
  return templateKey ? (KIND_BY_TEMPLATE[templateKey] ?? null) : null;
}

export type EmploymentStatus = "part_time" | "full_time";

export interface ChangeSide {
  title?: string;
  status?: EmploymentStatus;
  rate?: string;
  location?: string;
}

export interface EmploymentChangeFacts {
  current: ChangeSide;
  next: ChangeSide;
  changeType?: "voluntary" | "involuntary";
  effectiveDate?: string;
  /** "Same title", "keeps her pay": the manager said this part does not change. */
  unchanged?: { title?: boolean; status?: boolean; rate?: boolean };
}

/* --------------------------------------------------------------- pieces --- */

const STATUS = /\b(full[\s-]?time|ft|part[\s-]?time|pt)\b/i;

function readStatus(token: string): EmploymentStatus {
  return /^(?:full|ft)/i.test(token) ? "full_time" : "part_time";
}

/**
 * A pay rate. A figure counts only with a dollar sign or an hourly/yearly
 * unit, so "salon 12" and "10 years" are never read as pay.
 */
const RATE =
  /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s*(k\b)?\s*(?:(?:\/|per|an|a)\s*(hr|hour|yr|year)\b|(hourly|salary|salaried|annually|a year)\b)?|\b(\d{1,3}(?:\.\d{1,2})?)\s*(?:\/\s*(?:hr|hour)|an hour|per hour|hourly)\b/i;

function formatRate(match: RegExpExecArray): string {
  const [, dollars, thousands, unit, word, bare] = match;
  if (bare !== undefined) return `$${Number(bare).toFixed(2)}/hr`;
  const amount = Number((dollars ?? "0").replace(/,/g, "")) * (thousands ? 1000 : 1);
  const yearly = /^(?:yr|year)$/i.test(unit ?? "") || /^(?:salary|salaried|annually|a year)$/i.test(word ?? "");
  const hourly = /^(?:hr|hour)$/i.test(unit ?? "") || /^hourly$/i.test(word ?? "");
  if (yearly) return `$${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}/yr`;
  return `$${amount.toFixed(2)}${hourly ? "/hr" : ""}`;
}

function readRate(text: string): string | undefined {
  const match = RATE.exec(text);
  return match ? formatRate(match) : undefined;
}

/** Words that make a phrase a job title when the vocabulary does not know it. */
const TITLE_WORDS =
  /\b(?:manager|director|consultant|assistant|lead|supervisor|trainer|associate|specialist|key\s?holder|stylist|coordinator|representative|rep|cashier|attendant|technician|esthetician|receptionist|advisor|agent|sdit|tsd|asd|fttc|dmit|sd|dm|tc)\b/i;

/** A title in the business's own spelling where it has one; otherwise tidied. */
export function canonicalTitle(raw: string): string | null {
  const text = raw
    .replace(/[“”"]/g, "")
    .replace(/^(?:to\s+)?(?:be\s+|become\s+)?(?:an?|the|our)\s+/i, "")
    .replace(/[\s,.;:!?]+$/g, "")
    .trim();
  if (!text) return null;
  /*
   * AN ABBREVIATION IS EXPANDED THE WAY THE BUSINESS PRINTS IT ("sd" →
   * "Salon Director", "tc" → "Tanning Consultant"); A TITLE THE MANAGER
   * SPELLED OUT IS KEPT AS THEY SPELLED IT. "Assistant Salon Director" used to
   * come back as "ASD", which is shorter than what the manager typed and not
   * how they wrote it on the form.
   */
  const abbreviation = /^[a-z]{2,5}$/i.test(text);
  for (const entry of JOB_TITLES) {
    if (entry.pattern.test(text) && text.replace(entry.pattern, "").trim() === "") {
      return abbreviation ? entry.title : tidyWords(text);
    }
  }
  return tidyWords(text);
}

function titleLike(text: string): boolean {
  return extractJobTitle(text) !== null || TITLE_WORDS.test(text);
}

/** Words that mean a leftover is a sentence, not a job title. */
const NOT_A_TITLE =
  /\b(?:she|he|they|her|his|their|i|we|is|was|will|would|going|wants?|asked|requested|because|and|but|from|to|for|need|needs|form|paperwork|demot\w*|transfer\w*|mov\w*|step\w*|great|good|bad|really|very)\b/i;

/** The words a title may be built from, for the strict reading. */
const TITLE_VOCABULARY =
  /^(?:salon|tanning|district|training|store|general|senior|assistant|front|desk|shift|sales|spa|in)$/i;

/**
 * Whether a leftover phrase is a job title. STRICT is used where nothing but
 * the position says a title is being given ("<Name> is a ..."), and requires
 * every word to belong to a title.
 */
function acceptsTitle(leftover: string, strict: boolean): boolean {
  if (!leftover || leftover.split(" ").length > 5 || NOT_A_TITLE.test(leftover)) return false;
  if (!titleLike(leftover)) return false;
  if (!strict) return true;
  if (JOB_TITLES.some((entry) => entry.pattern.test(leftover) && leftover.replace(entry.pattern, "").trim() === "")) {
    return true;
  }
  return leftover
    .split(" ")
    .every((word) => TITLE_WORDS.test(word) || TITLE_VOCABULARY.test(word));
}

const SALON_AT = new RegExp(`\\b(?:at|in)\\s+(?:the\\s+)?(${SALON_PHRASE})(?:\\s+(?:salon|store|location))?\\b`, "i");
const SALON_ALONE = new RegExp(`^(?:the\\s+)?(${SALON_PHRASE})(?:\\s+(?:salon|store|location))?\\b`, "i");

/**
 * One side of a change — "FT SD at $18/hr at salon 12" — read into its parts.
 * A leftover that does not look like a job title is dropped rather than kept
 * as one: "from Monday to Friday" names no title.
 */
export function parseSide(segment: string, strict = false): ChangeSide {
  let rest = ` ${segment.replace(/\s+/g, " ").trim()} `;
  const side: ChangeSide = {};

  const rate = RATE.exec(rest);
  if (rate) {
    side.rate = formatRate(rate);
    rest = rest.replace(rate[0], " ");
  }

  const status = STATUS.exec(rest);
  if (status) {
    side.status = readStatus(status[1]!);
    rest = rest.replace(status[0], " ");
  }

  const at = SALON_AT.exec(rest) ?? SALON_ALONE.exec(rest.trim());
  if (at) {
    side.location = resolveSalonText(at[1]!) ?? undefined;
    rest = rest.replace(at[0], " ");
  }

  const leftover = rest
    .replace(/\b(?:at|in|a|an|the|as|our|be|become|position|role|job|making|earning|with|pay|rate|of)\b/gi, " ")
    .replace(/[()\/,$]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (acceptsTitle(leftover, strict)) {
    side.title = canonicalTitle(leftover) ?? undefined;
  }

  return side;
}

/** Where a phrase stops: a clause break, a date or reason phrase, or the next statement. */
const END =
  String.raw`(?=\s*(?:[;!?\n]|\.(?!\d)|,\s*(?!\d{4})|\s(?:effective|starting|as of|because|since|due to|so|who|but|when|voluntar\w*|involuntar\w*|and (?:she|he|they|is|was|will|it|the)|and (?:her|his|their) (?:new|current))\b|$))`;

function merge(into: ChangeSide, from: ChangeSide): void {
  for (const key of ["title", "status", "rate", "location"] as const) {
    if (from[key] !== undefined) (into as Record<string, string>)[key] = from[key]!;
  }
}

/** A date after the phrase `at` ends, within a short window. */
function dateAfter(text: string, index: number, today: string): string | undefined {
  return extractFormDate(text.slice(index, index + 45), today) ?? undefined;
}

const QUESTION_OPENER =
  /^\s*(?:what|how|when|where|why|who|which|does|do|did|is|are|can|could|should|would|will|may|has|have)\b/i;

/** True when a sentence asks rather than states. Questions are never read as facts. */
export function isQuestion(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.endsWith("?") || QUESTION_OPENER.test(trimmed);
}

/* -------------------------------------------------------------- reading --- */

function readOne(text: string, today: string): EmploymentChangeFacts {
  const facts: EmploymentChangeFacts = { current: {}, next: {} };
  // Arrows are "to": "SD → TC" is "SD to TC", "from" implied at the clause start.
  const source = text.replace(/\s*(?:→|->|=>)\s*/g, " to ");

  const sentences = source
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !isQuestion(sentence));

  for (const sentence of sentences) {
    readSentence(sentence, facts, today);
  }

  /* VOLUNTARY / INVOLUNTARY, from explicit words only; both cancel. */
  const statements = sentences.join(" ");
  const involuntary = /\binvoluntar(?:y|ily)\b|\bnot\s+voluntar|\bnon-?voluntar/i.test(statements);
  const voluntary =
    /(?<!in)\bvoluntar(?:y|ily)\b/i.test(statements.replace(/\bnot\s+voluntar\w*/gi, "")) ||
    /\b(?:requested|asked for|asking for|asked to|asks to|wants to|wanted to|would like to|chose to|decided to|requesting)\s+(?:a\s+|an\s+|be\s+|to\s+)?(?:voluntary\s+)?(?:demotion|demoted|step(?:ping)?\s+down|transfer\w*|be transferred|move|go part[\s-]?time)\b/i.test(
      statements,
    ) ||
    /\b(?:at|by|per)\s+(?:her|his|their|the employee'?s)\s+(?:own\s+)?request\b/i.test(statements);
  if (involuntary !== voluntary) facts.changeType = involuntary ? "involuntary" : "voluntary";

  return facts;
}

function readSentence(sentence: string, facts: EmploymentChangeFacts, today: string): void {
  /* "from X to Y". Every pair in the sentence; a later pair adds to an earlier. */
  const fromTo = new RegExp(String.raw`\bfrom\s+(.+?)\s+(?:to|into)\s+(.+?)${END}`, "gi");
  for (const match of sentence.matchAll(fromTo)) {
    merge(facts.current, parseSide(match[1]!));
    merge(facts.next, parseSide(match[2]!));
  }

  /*
   * "Salon Director FT at $18/hr to TC PT at $12/hr" — the arrow in the
   * intake's own example, with no "from". Read only where the left side is
   * nothing but a title and its details, so "demote paulyne to TC" is left to
   * the reading below rather than making "Demote Paulyne" a job title.
   */
  if (!/\bfrom\b/i.test(sentence)) {
    for (const clause of sentence.split(/,\s*(?!\d{4})/)) {
      const pair = /^(.+?)\s+to\s+(.+)$/i.exec(clause.trim());
      if (!pair) continue;
      const left = parseSide(pair[1]!, true);
      if (!left.title) continue;
      merge(facts.current, left);
      merge(facts.next, parseSide(pair[2]!.replace(new RegExp(`${END}.*$`, "i"), "")));
    }
  }

  /*
   * "salon 12, manager, $18/hr, going to TC at $14/hr" — the answer to "what
   * are the current and new details?" given as a list. The items BEFORE the
   * change ("going to", "moving to", "demote ... to") describe where the
   * employee is now. Each item is read on its own and strictly, so the
   * employee's name or a request ("create a demotion form for jane") in the
   * list is never taken for a title.
   */
  if (!/\bfrom\b/i.test(sentence)) {
    // The change verb right before its destination — not "demotion form", a noun.
    const change = /\b(?:going|moving|moves?|demoted|demoting|transferring|transfering|transferred|step(?:s|ping)?\s+down|switching|dropping|becoming|changing)\s+(?:\w+\s+)?to\b/i.exec(sentence);
    const before = change ? sentence.slice(0, change.index) : "";
    if (before.includes(",")) {
      for (const item of before.split(/,\s*(?!\d{4})/)) {
        const side = parseSide(item, true);
        for (const key of ["title", "status", "rate", "location"] as const) {
          if (side[key] !== undefined && facts.current[key] === undefined) {
            (facts.current as Record<string, string>)[key] = side[key]!;
          }
        }
      }
    }
  }

  /* "demote / transfer / move / step down ... to Y", with or without a "from". */
  const toward = new RegExp(
    String.raw`\b(?:demot\w*|transfer\w*|transfering|mov(?:e|es|ing)|step(?:s|ping)?\s+down|go(?:es|ing)?|switch\w*|chang\w*|drop\w*|becom\w*)\b[^.;\n]*?\bto\s+(.+?)${END}`,
    "gi",
  );
  for (const match of sentence.matchAll(toward)) {
    // "change her current title to SD" is a LABELLED value, read below — the
    // "to" there does not mean the new side.
    const between = match[0].slice(0, match[0].length - match[1]!.length);
    if (/\b(?:current|old|previous|present|original|new)\s+\w+|\b(?:name|date)\b/i.test(between)) continue;
    merge(facts.next, parseSide(match[1]!));
  }

  /* LABELLED VALUES. "current title is SD", "new pay: $12/hr", "new location salon 24". */
  const LINK = String.raw`\s*(?:is|was|will be|should be|to|:|=|-|of)?\s*`;
  const CURRENT = String.raw`\b(?:current|old|previous|present|original)`;
  const labels: { side: "current" | "next"; pattern: RegExp; apply: (side: ChangeSide, value: string) => void }[] = [];
  for (const [side, lead] of [["current", CURRENT], ["next", String.raw`\bnew`]] as const) {
    labels.push(
      {
        side,
        pattern: new RegExp(String.raw`${lead}\s+(?:job\s+)?(?:title|position|role)${LINK}(.+?)${END}`, "gi"),
        apply: (target, value) => {
          const title = canonicalTitle(value);
          if (title && value.split(/\s+/).length <= 6) target.title = title;
        },
      },
      {
        side,
        pattern: new RegExp(String.raw`${lead}\s+(?:employment\s+)?status${LINK}(.+?)${END}`, "gi"),
        apply: (target, value) => {
          const status = STATUS.exec(value);
          if (status) target.status = readStatus(status[1]!);
          // "new status PT at $12/hr" gives the pay in the same breath.
          const rate = readRate(value);
          if (rate) target.rate = rate;
        },
      },
      {
        side,
        pattern: new RegExp(String.raw`${lead}\s+(?:rate of pay|pay rate|hourly rate|rate|pay|wage|salary)${LINK}(.+?)${END}`, "gi"),
        apply: (target, value) => {
          const rate = readRate(value) ?? readRate(`$${value.trim()}`);
          if (rate && /\d/.test(value)) target.rate = rate;
        },
      },
      {
        side,
        pattern: new RegExp(String.raw`${lead}\s+(?:location|salon|store)${LINK}(.+?)${END}`, "gi"),
        apply: (target, value) => {
          const location = resolveSalonText(value.replace(/^(?:at|in)\s+/i, ""));
          if (location && value.split(/\s+/).length <= 6) target.location = location;
        },
      },
    );
  }
  for (const label of labels) {
    for (const match of sentence.matchAll(label.pattern)) {
      label.apply(label.side === "current" ? facts.current : facts.next, match[1]!);
    }
  }

  /* "<Name> is an SD at Lawrence", "currently a full-time TC", "she is FT". */
  const role = new RegExp(
    String.raw`(?:\bis|\bwas|['’]s)\s+(?:currently\s+)?(?:an?|our|the)\s+(?!new\b)(.+?)(?=\s+(?:transferring|transfering|moving|who|that|going|stepping|wants|and|but|is|will|being)\b|${END.slice(3, -1)})`,
    "i",
  ).exec(sentence);
  if (role && !/\bfrom\b/i.test(sentence.slice(0, role.index))) {
    const side = parseSide(role[1]!, true);
    if (side.title) merge(facts.current, side);
  }
  const currently = new RegExp(String.raw`\bcurrently\s+(?:an?\s+|the\s+)?(.+?)${END}`, "i").exec(sentence);
  if (currently) merge(facts.current, parseSide(currently[1]!.replace(/\b(?:transferring|moving|going)\b.*$/i, "")));
  /*
   * "she was FT at $18/hr", "is currently part time making $15": the status
   * and pay they have NOW, stated with a copula. Not read when the sentence
   * says this is the new status.
   */
  const now = new RegExp(
    String.raw`(?:\bis|\bwas|['’]s|\bcurrently)\s+(?:currently\s+)?((?:full[\s-]?time|part[\s-]?time|ft|pt|making|earning|paid|at\s+\$)[^,;\n]*?)${END}`,
    "i",
  ).exec(sentence);
  if (now && !/\bnew\s+(?:employment\s+)?status\b/i.test(sentence.slice(0, now.index))) {
    const side = parseSide(now[1]!.replace(/^(?:making|earning|paid)\s+/i, ""), true);
    if (side.status) facts.current.status ??= side.status;
    if (side.rate) facts.current.rate ??= side.rate;
  }

  /* "Same title and pay", "keeps her status", "no change in pay". */
  const same = /\b(?:same|keep(?:s|ing)?\s+(?:her|his|their|the\s+same)|no\s+change\s+(?:in|to))\s+((?:(?:title|position|role|status|pay|rate|pay rate|wage)(?:,?\s*(?:and\s+)?)?)+)/gi;
  for (const match of sentence.matchAll(same)) {
    facts.unchanged ??= {};
    if (/title|position|role/i.test(match[1]!)) facts.unchanged.title = true;
    if (/status/i.test(match[1]!)) facts.unchanged.status = true;
    if (/pay|rate|wage/i.test(match[1]!)) facts.unchanged.rate = true;
  }

  /* THE EFFECTIVE DATE — only where a phrase says the date is when it takes effect. */
  const effective = /\b(?:effective(?:\s+date)?|starting|starts|start date|as of|beginning)\s*(?:is|of|on|:|=|-|to|should be|will be)?\s*/gi;
  for (const match of sentence.matchAll(effective)) {
    const date = dateAfter(sentence, match.index + match[0].length, today);
    if (date) facts.effectiveDate = date;
  }
}

/**
 * Everything the manager has said across their turns, a later statement
 * replacing an earlier one.
 */
export function readEmploymentChange(
  messages: readonly string[],
  today: string,
): EmploymentChangeFacts {
  const facts: EmploymentChangeFacts = { current: {}, next: {} };
  for (const message of messages) {
    const one = readOne(message ?? "", today);
    merge(facts.current, one.current);
    merge(facts.next, one.next);
    if (one.changeType !== undefined) facts.changeType = one.changeType;
    if (one.effectiveDate !== undefined) facts.effectiveDate = one.effectiveDate;
    if (one.unchanged) facts.unchanged = { ...facts.unchanged, ...one.unchanged };
  }
  return facts;
}

/** True when the reading found anything at all. */
export function hasStatedFacts(facts: EmploymentChangeFacts): boolean {
  return (
    Object.keys(facts.current).length > 0 ||
    Object.keys(facts.next).length > 0 ||
    facts.changeType !== undefined ||
    facts.effectiveDate !== undefined ||
    facts.unchanged !== undefined
  );
}

/* ------------------------------------------------------------ the form --- */

/**
 * The facts as form values, by field key. Keys a version does not have are
 * simply never written — see `STATED_FACT_KEYS` and `applyStatedFacts`.
 */
export function statedFactValues(facts: EmploymentChangeFacts): {
  values: Record<string, string>;
  checked: Record<string, string[]>;
} {
  const values: Record<string, string> = {};
  const checked: Record<string, string[]> = {};
  const put = (key: string, value: string | undefined) => {
    if (value) values[key] = value;
  };

  // "Same title and pay" copies the CURRENT value the manager gave — never a guess.
  const next: ChangeSide = {
    ...facts.next,
    ...(facts.unchanged?.title && !facts.next.title ? { title: facts.current.title } : {}),
    ...(facts.unchanged?.status && !facts.next.status ? { status: facts.current.status } : {}),
    ...(facts.unchanged?.rate && !facts.next.rate ? { rate: facts.current.rate } : {}),
  };
  put("job_title", facts.current.title);
  put("location", facts.current.location);
  put("current_pay_rate", facts.current.rate);
  put("new_job_title", next.title);
  put("new_location", next.location);
  put("new_pay_rate", next.rate);
  if (facts.current.status) checked.current_status = [facts.current.status];
  if (next.status) checked.new_status = [next.status];
  if (facts.changeType) {
    checked.demotion_type = [facts.changeType];
    checked.transfer_type = [facts.changeType];
  }

  return { values, checked };
}

/**
 * The form's own date, leaving out every date a phrase gave another job —
 * "effective oct 5", "last day was 9/25", "gave notice 9/11". Without this the
 * effective date of a demotion became the date printed at the top of the form.
 */
export function formDateFor(text: string, today: string): string | null {
  const OTHER_JOB =
    /\b(?:effective|starting|starts|start date|as of|beginning|last\s+(?:day|worked|shift)|notice|gave|given|submitted|fulfilled|worked|through|until|quit|resigned|left|terminated|fired|let\s+go|separated)\b[^.;\n]*$/i;
  for (const date of listFormDates(text, today)) {
    const before = text.slice(Math.max(0, date.index - 45), date.index);
    if (!OTHER_JOB.test(before)) return date.iso;
  }
  return null;
}

/* ------------------------------------------------------ what is missing --- */

export interface MissingDetail {
  key: string;
  phrase: string;
}

function sidePhrase(prefix: string, side: ChangeSide, subjectPay = "pay rate"): MissingDetail[] {
  const status = side.status === undefined;
  const rate = side.rate === undefined;
  if (status && rate) return [{ key: `${prefix}_status_pay`, phrase: `the ${prefix} status (FT/PT) and ${subjectPay}` }];
  if (status) return [{ key: `${prefix}_status`, phrase: `the ${prefix} status (FT/PT)` }];
  if (rate) return [{ key: `${prefix}_pay`, phrase: `the ${prefix} ${subjectPay}` }];
  return [];
}

/**
 * The details still worth asking for, in the order the form asks them, each
 * group phrased so several can be asked in one sentence.
 *
 * `currentTitleKnown` covers a title the proposal already carries.
 */
export function missingDetails(
  kind: EmploymentChangeKind,
  facts: EmploymentChangeFacts,
  options: { currentTitleKnown?: boolean } = {},
): MissingDetail[] {
  const missing: MissingDetail[] = [];
  if (!facts.current.title && !options.currentTitleKnown) {
    missing.push({ key: "current_title", phrase: "the current title" });
  }
  missing.push(...sidePhrase("current", facts.current));
  if (kind === "transfer" && !facts.next.location) {
    missing.push({ key: "new_location", phrase: "the new location" });
  }
  if (!facts.next.title && !facts.unchanged?.title) {
    missing.push({
      key: "new_title",
      phrase: kind === "transfer" ? "the new title (or that it stays the same)" : "the new title",
    });
  }
  missing.push(
    ...sidePhrase("new", {
      ...facts.next,
      ...(facts.unchanged?.status ? { status: "full_time" as const } : {}),
      ...(facts.unchanged?.rate ? { rate: "unchanged" } : {}),
    }),
  );
  if (kind === "demotion" && !facts.effectiveDate) {
    missing.push({ key: "effective_date", phrase: "the effective date" });
  }
  if (!facts.changeType) {
    missing.push({ key: "change_type", phrase: "whether it's voluntary or involuntary" });
  }
  return missing;
}

/** "a", "a and b", "a, b, and c". */
export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function dateInWords(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

const STATUS_WORDS: Record<EmploymentStatus, string> = { full_time: "FT", part_time: "PT" };

function describeSide(side: ChangeSide): string {
  const lead = side.status !== undefined || side.title !== undefined;
  return [
    side.status ? STATUS_WORDS[side.status] : null,
    side.title ?? null,
    side.rate ? `${lead ? "at " : ""}${side.rate}` : null,
    side.location ? `${lead || side.rate ? "at " : ""}${side.location}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * What Ask Sunny already has, in one line, so the manager can see it read the
 * sentence correctly: "FT Salon Director → PT Tanning Consultant, effective
 * October 5, 2026, voluntary".
 */
export function describeKnownFacts(facts: EmploymentChangeFacts): string | null {
  const parts: string[] = [];
  const from = describeSide(facts.current);
  const to = describeSide(facts.next);
  if (from && to) parts.push(`${from} → ${to}`);
  else if (to) parts.push(`to ${to}`);
  else if (from) parts.push(`currently ${from}`);
  if (facts.effectiveDate) parts.push(`effective ${dateInWords(facts.effectiveDate)}`);
  if (facts.changeType) parts.push(facts.changeType);
  return parts.length > 0 ? parts.join(", ") : null;
}

/* ------------------------------------------------------- onto the form --- */

/**
 * ============================================================================
 * WHICH STATED FACTS MAY LAND ON THIS FORM, AND WHERE
 * ============================================================================
 *
 * Three filters, all of them structural:
 *
 *   1. THE KEY IS ON THE LIST (`STATED_FACT_KEYS`) — an explicit set, never an
 *      inference from a label.
 *   2. A PERSON COULD HAVE WRITTEN IT — `enforcePersonEdit`, the same check a
 *      manager's own save goes through, so no signature, hand-filled line or
 *      option the pinned version lacks can be reached.
 *   3. THE FIELD IS EMPTY. A stated fact fills a blank and never replaces
 *      anything — not the salon the record was filed against, and not a value
 *      the manager typed. Correcting a value is a separate, explicit act; see
 *      `correctionValues`.
 */
export function selectStatedFacts(input: {
  document: FormDocument;
  variantKey: string | null;
  stated: { values: Record<string, string>; checked: Record<string, string[]> };
  existing: readonly { fieldKey: string; value: string | null; checked: string[] }[];
  /** The keys a statement may fill. Defaults to this module's stated facts. */
  keys?: ReadonlySet<string>;
}): { values: Record<string, string>; checked: Record<string, string[]> } {
  const allowedKeys = input.keys ?? STATED_FACT_KEYS;
  const filled = new Set(
    input.existing
      .filter((row) => (row.value ?? "").trim() !== "" || row.checked.length > 0)
      .map((row) => row.fieldKey),
  );
  const onList = <T,>(entries: Record<string, T>) =>
    Object.fromEntries(
      Object.entries(entries).filter(([key]) => allowedKeys.has(key) && !filled.has(key)),
    );
  const allowed = enforcePersonEdit(input.document, input.variantKey, {
    values: onList(input.stated.values),
    checked: onList(input.stated.checked),
  });
  return {
    values: Object.fromEntries(Object.entries(allowed.values).filter(([, value]) => value.trim() !== "")),
    checked: Object.fromEntries(Object.entries(allowed.checked).filter(([, options]) => options.length > 0)),
  };
}

/**
 * ============================================================================
 * "CHANGE HER NEW LOCATION TO SALON 24" — A CORRECTION TO THE OPEN FORM
 * ============================================================================
 *
 * After a form exists, a manager correcting one detail in chat should not have
 * to start again. This reads the correction with the same reader, plus the
 * two header lines a correction can name — the employee's name and the form
 * date — and returns the values to save as the MANAGER'S OWN EDIT (it
 * replaces, because replacing is what they asked for).
 *
 * Only a statement counts: a question is never a correction, and a turn the
 * reader finds nothing in is left to the ordinary conversation.
 */
export function correctionValues(
  text: string,
  today: string,
): { values: Record<string, string>; checked: Record<string, string[]> } | null {
  if (isQuestion(text)) return null;
  const { values, checked } = statedFactValues(readEmploymentChange([text], today));

  const name = /\b(?:change|update|correct|fix|set|make)\s+(?:the\s+|her\s+|his\s+|their\s+)?(?:employee(?:'s)?\s+)?name\s+(?:to|is|should be)\s+(.+?)\s*[.!]?$/i.exec(text.trim());
  if (name) values.employee_name = name[1]!.replace(/^["'“‘(]+|["'”’)]+$/g, "").replace(/\s+/g, " ").trim();

  const date = /\b(?:change|update|correct|fix|set|make)\s+(?:the\s+)?(?:form\s+)?date\s+(?:to|is|should be|as)\s+/i.exec(text);
  if (date) {
    const iso = extractFormDate(text.slice(date.index + date[0].length), today);
    if (iso) values.form_date = iso;
  }

  return Object.keys(values).length + Object.keys(checked).length > 0 ? { values, checked } : null;
}

/** Field keys a chat correction may reach: the stated facts and two header lines. */
export const CORRECTABLE_KEYS: ReadonlySet<string> = new Set([
  ...STATED_FACT_KEYS,
  "employee_name",
  "form_date",
]);
