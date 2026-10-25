import { PRODUCTION_SALONS } from "@/data/salons";
import { notANameGuardEnabled } from "@/lib/config/chat-quality-flags";
import { editDistance } from "@/lib/forms/employee-match";
import { BED_LEVELS } from "@/lib/reporting/bed-usage/metric-map";
import { COMP_SALES_METRICS } from "@/lib/reporting/comp-sales/metric-catalogue";
import { SPA_ENGAGEMENT_MEASURES } from "@/lib/reporting/spa-engagement/metric-map";
import { storeNameKey } from "@/lib/reporting/store-identity";

/**
 * ============================================================================
 * WORDS THAT ARE NOT A PERSON (NOT_A_NAME_GUARD_ENABLED)
 * ============================================================================
 *
 * QA round 4, 24 Oct 2026: "1. employee name is blank" put "Blank" on the
 * card; a pasted promo list was offered back as "Which of them … Red Light
 * Visits … BOT Restored Prep Spray?"; "coaching form for lawrence location
 * tanning consultant, test testy" asked "test testy or lawrence?"; "coaching
 * form for EFT's and spa" asked "EFT or spa?"; and the assistant's own
 * "require practice" became the employee.
 *
 * Two checks, both off unless the flag is on:
 *
 *   isNotAName(candidate)    a placeholder ("blank", "n/a", "unknown"); a
 *                            phrase led by a verb ("require practice"); a
 *                            product or service this business reports on
 *                            (read from its own report catalogues, never a
 *                            list of promo items); or exactly a place on the
 *                            salon roster.
 *   maskNotANameText(text)   the text the name readers see, without the
 *                            app's own stored lines ("Policy reference: …",
 *                            "It happened at …"), without a bulleted list,
 *                            with a run priced in dollars, a document's name
 *                            and a service's name lowered, a placeholder or
 *                            service word read as "nobody", and "for <x>
 *                            location/salon/store" read as a place.
 *
 * "The employee is …" is not masked: it is how the stored employee reaches
 * the proposal, and the readers already treat it as the label it is.
 */

/** Words that mean "nobody yet" when they are given as the name. */
const PLACEHOLDER = new Set([
  "blank", "blanks", "n/a", "tbd", "tba", "unknown", "unnamed", "anonymous", "none", "nobody", "null", "nil",
  "empty", "placeholder",
]);

/**
 * Words no name contains: "all of it if possible" read "If Possible" as the
 * employee once "test employe" was given in the same turn.
 */
const NEVER_IN_A_NAME = new Set(["if", "possible", "possibly", "maybe", "perhaps", "whatever", "unless", "whether"]);

/** Given alone, these are the whole team or nobody in particular. */
const NOBODY_IN_PARTICULAR = new Set([
  "team", "everyone", "everybody", "all", "staff", "multiple", "various", "generic", "any", "anyone",
]);

/**
 * Verbs that lead an instruction ("require practice", "set a follow-up",
 * "listen in"). None of them is a first name; Will, Mark, Grant, Chase and
 * the like are deliberately absent.
 */
const LEADING_VERB = new Set([
  "require", "requires", "set", "state", "explain", "demonstrate", "capture", "hold", "keep", "start",
  "observe", "document", "use", "make", "create", "tell", "ask", "give", "take", "get", "follow",
  "review", "train", "coach", "listen", "watch", "mention", "tie", "check", "verify", "sign",
  "practice", "practise", "solve", "escalate", "show", "let", "need", "needs", "want", "see", "go", "do",
  "help", "put", "write", "send", "add", "remove", "update", "change", "fix", "clean", "greet", "offer",
  "sell", "upsell", "push", "describe", "discuss", "talk", "call", "text", "leave", "keeping", "carry",
]);

/**
 * A run that ends in what a document is called is that document: "Fitzpatrick
 * Skin Type Chart", "EFT Agreements", "the NCR form".
 */
const DOCUMENT_TAIL = new Set([
  "chart", "charts", "agreement", "agreements", "waiver", "waivers", "form", "forms", "sheet", "sheets",
  "handbook", "manual", "checklist", "checklists", "document", "documents", "paperwork", "contract",
  "contracts", "report", "reports", "policy", "policies", "script", "scripts", "flyer", "flyers", "pdf",
]);

/** Report-catalogue words that measure something rather than name a service. */
const MEASURE_WORDS = new Set([
  "total", "grand", "revenue", "change", "unique", "per", "new", "customers", "customer", "previous", "day",
  "month", "date", "active", "types", "type", "usage", "client", "units", "unit", "chain", "vs", "peer",
  "average", "rank", "overall", "incl", "employee", "bed", "of", "salon", "store", "the", "and",
  // The customers counted, not a service — and Tanner is a first name.
  "tanner", "tanners",
]);

/**
 * The products and services this business reports on, read from its own
 * report catalogues: Comp Sales, Spa Engagement and the bed levels. A new
 * catalogue measure is a new word here, with no list to keep.
 */
const SERVICE_WORDS: ReadonlySet<string> = (() => {
  const labels = [
    ...COMP_SALES_METRICS.map((metric) => metric.label),
    ...SPA_ENGAGEMENT_MEASURES.map((measure) => measure.label),
    ...BED_LEVELS,
  ];
  const words = new Set<string>();
  for (const label of labels) {
    for (const word of label.toLowerCase().split(/[^a-z]+/)) {
      if (word.length >= 2 && !MEASURE_WORDS.has(word)) words.add(word);
    }
  }
  return words;
})();

/**
 * Every roster salon by its full name, by its name without the state, the
 * city several salons share, and what tells those apart when it is one word
 * — the same reading the proposal uses for a reply that is only a place.
 */
const PLACE_KEYS: ReadonlySet<string> = (() => {
  const shorts = PRODUCTION_SALONS.map((salon) => storeNameKey(salon.name).replace(/^[a-z]{2} /, ""));
  const keys = new Set<string>([...PRODUCTION_SALONS.map((salon) => storeNameKey(salon.name)), ...shorts]);
  for (const short of shorts) {
    const words = short.split(" ");
    for (let length = 1; length < words.length; length += 1) {
      const city = words.slice(0, length).join(" ");
      if (shorts.filter((other) => other === city || other.startsWith(`${city} `)).length < 2) continue;
      keys.add(city);
      const rest = words.slice(length).join(" ");
      if (!rest.includes(" ")) keys.add(rest);
    }
  }
  return keys;
})();

function wordsOf(candidate: string): string[] {
  return candidate
    .trim()
    .toLowerCase()
    .replace(/[’]/g, "'")
    .split(/\s+/)
    .map((word) => word.replace(/^[^a-z0-9/]+|[^a-z0-9/]+$/g, "").replace(/'s$/, ""))
    .filter(Boolean);
}

function isServiceWord(word: string): boolean {
  return SERVICE_WORDS.has(word) || (word.endsWith("s") && SERVICE_WORDS.has(word.slice(0, -1)));
}

/**
 * The steps of a training ("Video, activity/roleplay, assessment"), offered
 * back as people in conv_mvnt8lbq2rlbp0m (QA G5, 25 Oct 2026): "Which of them
 * is this Coaching Form for — <name>, Video or assessment?".
 */
const TRAINING_STEP = new Set([
  "video", "videos", "activity", "activities", "roleplay", "roleplays", "role-play", "role-plays", "roleplaying",
  "assessment", "assessments", "quiz", "quizzes", "module", "modules", "worksheet", "worksheets", "curriculum",
]);

/** A word that stands for nobody wherever it is typed: a placeholder, a service or a training step. */
function isStandInWord(word: string): boolean {
  return PLACEHOLDER.has(word) || isServiceWord(word) || TRAINING_STEP.has(word);
}

/** A capitalised run that is a document, or names a placeholder or a service. */
function isThingRun(words: readonly string[]): boolean {
  if (words.some(isStandInWord)) return true;
  return words.length >= 2 && DOCUMENT_TAIL.has(words[words.length - 1]!);
}

/** True when the guard is on and the candidate is not somebody's name. */
export function isNotAName(candidate: string | null | undefined): boolean {
  if (!notANameGuardEnabled() || !candidate?.trim()) return false;
  const words = wordsOf(candidate);
  if (words.length === 0) return false;
  if (isThingRun(words)) return true;
  if (words.some((word) => NEVER_IN_A_NAME.has(word))) return true;
  if (words.every((word) => NOBODY_IN_PARTICULAR.has(word))) return true;
  if (words.length >= 2 && LEADING_VERB.has(words[0]!)) return true;
  return PLACE_KEYS.has(storeNameKey(candidate));
}

/**
 * The lines the app writes ahead of a turn (`stateSentences`,
 * `augmentIntakeQuestion`). Each names a slot the readers already took; read
 * again for a person, "Policy reference: Care and Cleaning of Equipment and
 * Facilities" offered "Facilities" as the employee.
 */
const APP_LINES: readonly RegExp[] = [
  /\bThe form is the [^.\n]*\./g,
  /\bJob title: [^.\n]*\./g,
  /\bIt happened (?:at|on) [^.\n]*\./g,
  /\bWarning level: [^.\n]*\./g,
  /\bPolicy reference: [^\n]*?JBA Policy Manual(?: p\.\s?\d+)?\./g,
  /\bIncident: [^.\n]*\./g,
  /\bPayroll (?:deduct applies|deduction amount: [^\n]*?|amount: [^\n]*?|deduction of [^\n]*?)\.(?=\s|$)/g,
  /\bNo payroll deduction\./g,
];

const BULLET = /^\s*(?:[•●◦▪▫■□➢➤►▶→⁃‣∙·*]|-(?=\s))/;

/** Words that make "<x> salon …" a job title, not a place. */
const TITLE_AFTER = "director|manager|lead|leader|coordinator|associate|supervisor|trainer|owner|consultant|member";

/** "for lawrence location" — but "for Jane Doe store 373" names Jane Doe and a store number. */
const PLACE_AFTER_FOR = new RegExp(
  `\\bfor\\s+(?!the\\b)([A-Za-z][\\w'’-]*(?:\\s+[A-Za-z][\\w'’-]*)?)\\s+(location|salon|store)\\b(?!\\s+(?:${TITLE_AFTER})\\b)(?!\\s*#?\\d)`,
  "gi",
);

const RUN = "(?:[A-Z][\\w'’-]*[ \\t]+)*[A-Z][\\w'’-]*";
const CAPITAL_RUN = new RegExp(`\\b${RUN}`, "g");
const WORD = /[A-Za-z][A-Za-z'’/-]*/g;
const PRICE = "\\$\\s?\\d[\\d,]*(?:\\.\\d{1,2})?";
const AFTER_PRICE = new RegExp(`(${PRICE}\\s+)(${RUN})`, "g");
const BEFORE_PRICE = new RegExp(`(${RUN})(\\s+(?:for|at|@)\\s+${PRICE})`, "g");

/*
 * ============================================================================
 * A ROLE IN FRONT OF THE NAME IS NOT PART OF IT (QA, 25 OCT 2026)
 * ============================================================================
 *
 * conv_mvb75wuo2nnsluv: "corrective action form for empolyee <name> for
 * opening store late" asked "<name> or empolyee <name>?", and "…for Tanning
 * Consulatant <name> who opened the store late today" put the job title on
 * the card as part of the name. "employee <name>" was already read as the
 * label it is; a misspelt "employee", and a job title (spelt right or not),
 * were not.
 *
 * So, only where a capitalised name follows on the same line: a misspelling
 * of "employee" ("empolyee", "emplyee", "employe") and a spelled-out job title
 * of this business read as "employee" — the label every reader already takes
 * off. "for test employe." (a name, at the end of its phrase) is unchanged.
 */

/** The spelled-out titles `JOB_TITLES` (proposal.ts) reads; `not-a-name.test.ts` keeps the two in step. */
export const SPELLED_JOB_TITLES: readonly string[] = [
  "salon director in training",
  "training salon director",
  "district manager in training",
  "full time tanning consultant",
  "assistant salon director",
  "tanning consultant",
  "salon director",
  "district manager",
];

const TITLE_VOCABULARY: readonly string[] = [...new Set(SPELLED_JOB_TITLES.flatMap((title) => title.split(" ")))];

/** Forms of "employ" that are words in their own right, never a misspelt "employee". */
const EMPLOY_WORDS = new Set(["employ", "employs", "employed", "employer", "employers", "employing", "employees"]);

function isMisspeltEmployee(word: string): boolean {
  const key = word.toLowerCase();
  if (key === "employee" || EMPLOY_WORDS.has(key) || key.length < 6 || !key.startsWith("em")) return false;
  return editDistance(key, "employee") <= 2;
}

/** The title vocabulary word this typed word is, allowing a slip of the keys in a longer word. */
function titleWord(word: string): string | null {
  const key = word.toLowerCase();
  if (TITLE_VOCABULARY.includes(key)) return key;
  if (key.length < 6) return null;
  // The closest word: "tanning" is one letter from "training" as well as being itself.
  let best: { known: string; distance: number } | null = null;
  for (const known of TITLE_VOCABULARY) {
    if (known.length < 6) continue;
    const distance = editDistance(key, known);
    if (distance <= 2 && (!best || distance < best.distance)) best = { known, distance };
  }
  return best?.known ?? null;
}

/** Whether `words` (lower-cased, plural allowed on the last) is one of this business's spelled-out titles. */
function isSpelledTitle(words: readonly string[]): boolean {
  const corrected = words.map((word, index) => {
    const exact = titleWord(word);
    if (exact) return exact;
    return index === words.length - 1 && /s$/i.test(word) ? titleWord(word.slice(0, -1)) : null;
  });
  if (corrected.some((word) => word === null)) return false;
  return SPELLED_JOB_TITLES.includes(corrected.join(" "));
}

/** How many leading words of `words` are a role — a misspelt "employee" or a job title — or 0. */
function roleLeadLength(words: readonly string[]): number {
  if (words.length > 0 && isMisspeltEmployee(words[0]!)) return 1;
  for (let length = Math.min(4, words.length); length >= 1; length -= 1) {
    if (isSpelledTitle(words.slice(0, length))) return length;
  }
  return 0;
}

const NAME_WORD_AFTER = /^[ \t]+[A-Z][a-z'’-]+/;

/** "empolyee Blair", "Tanning Consulatant Blair" → "employee Blair": the role reads as the label. */
function roleLeadsAsLabel(text: string): string {
  const words = [...text.matchAll(/[A-Za-z][A-Za-z'’-]*/g)];
  let out = "";
  let at = 0;
  for (let index = 0; index < words.length; index += 1) {
    const start = words[index]!.index!;
    if (start < at) continue;
    // A role is only words joined by spaces on one line.
    const run: string[] = [];
    for (let next = index; next < Math.min(words.length, index + 4); next += 1) {
      if (next > index) {
        const gap = text.slice(words[next - 1]!.index! + words[next - 1]![0].length, words[next]!.index!);
        if (!/^[ \t]+$/.test(gap)) break;
      }
      run.push(words[next]![0]);
    }
    const length = roleLeadLength(run);
    if (length === 0) continue;
    const last = words[index + length - 1]!;
    const end = last.index! + last[0].length;
    if (!NAME_WORD_AFTER.test(text.slice(end))) continue;
    // A role that is itself followed by more of the role ("Salon Director Training") is left alone.
    const follower = /^[ \t]+([A-Za-z]+)/.exec(text.slice(end))?.[1] ?? "";
    if (titleWord(follower) || isMisspeltEmployee(follower)) continue;
    out += `${text.slice(at, start)}employee`;
    at = end;
    index += length - 1;
  }
  return out + text.slice(at);
}

/**
 * A candidate name without a role in front of it: "empolyee Blair Sutton" and
 * "Tanning Consulatant Blair Sutton" are Blair Sutton. Off, unchanged; a
 * candidate that is only a role is returned as it is.
 */
export function withoutRoleLead(candidate: string): string {
  if (!notANameGuardEnabled() || !candidate.trim()) return candidate;
  const words = candidate.trim().split(/\s+/);
  const length = roleLeadLength(words.map((word) => word.replace(/[^A-Za-z'’-]/g, "")));
  return length > 0 && length < words.length ? words.slice(length).join(" ") : candidate;
}

/** The text the employee readers see, with the guard on. Off, unchanged. */
export function maskNotANameText(text: string): string {
  if (!notANameGuardEnabled() || !text) return text;
  let masked = text;
  for (const line of APP_LINES) masked = masked.replace(line, " ");
  masked = roleLeadsAsLabel(masked);
  const lines = masked.split("\n");
  if (lines.filter((line) => BULLET.test(line)).length >= 2) {
    masked = lines.map((line) => (BULLET.test(line) ? "" : line)).join("\n");
  }
  masked = masked
    .replace(AFTER_PRICE, (_match, price: string, run: string) => `${price}${run.toLowerCase()}`)
    .replace(BEFORE_PRICE, (_match, run: string, rest: string) => `${run.toLowerCase()}${rest}`)
    .replace(PLACE_AFTER_FOR, (_match, _place: string, noun: string) => `for the ${noun}`)
    // "Fitzpatrick Skin Type Chart", "Spa Sessions": lowered, so no capital reading takes them.
    .replace(CAPITAL_RUN, (run) => (isThingRun(wordsOf(run)) ? run.toLowerCase() : run))
    // "employee name is blank", "for EFT's and spa": a word that stands for nobody reads as "nobody".
    .replace(WORD, (word) => (isStandInWord(wordsOf(word)[0] ?? "") ? "nobody" : word));
  return masked;
}

/**
 * Whether an assistant reply says the name other than as the form's subject.
 * A card names its employee in bold ("for **Test Employee**", "**Name:** …",
 * "**Employee:** …") because it was saved; that echo is not where the name
 * came from. A policy answer citing "One Tanner per Room" is.
 */
export function saidInReply(replies: readonly string[], name: string): boolean {
  const needle = name.trim().replace(/\s+/g, " ");
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  const echo = new RegExp(`\\*\\*(?:(?:employee\\s+)?name|employee):\\*\\*\\s*${escaped}|\\*\\*${escaped}\\*\\*`, "gi");
  const lower = needle.toLowerCase();
  return replies.some((reply) => reply.replace(echo, " ").replace(/\s+/g, " ").toLowerCase().includes(lower));
}
