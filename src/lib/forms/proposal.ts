import "server-only";

import { businessToday } from "@/lib/business-date";
import { PRODUCTION_SALONS } from "@/data/salons";
import { storeNameKey } from "@/lib/reporting/store-identity";

import { extractFormDate } from "./form-date-answer";
import { FORM_NAME_PATTERN, canonicalShorthand, isFormVocabulary, leadingFormRequest } from "./template-intent";
import { NOT_A_NAME, NOT_A_TYPED_NAME, TYPED_NAME_WORD } from "./name-words";
import { boundManagerTurns, type BoundedContext } from "./bounded-context";
import {
  allowsTeamSubject,
  maskTeamSubjectPhrases,
  readsAsTeamSubject,
  TEAM_SUBJECT_LABEL,
} from "./team-subject";
import { proposeLocation } from "./location-scope";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * FROM A CONVERSATION TO A FORM PROPOSAL — DETERMINISTICALLY
 * ============================================================================
 *
 * WHICH FORM, WHO IT IS ABOUT, AND WHICH SALON ARE CODE DECISIONS. A language
 * model is excellent at drafting the prose inside a coaching form and has no
 * business choosing the frame around it: the template, the employee's identity
 * and the location on a disciplinary record are facts, and a model that is
 * uncertain about a fact produces a plausible one.
 *
 * So this module reads the conversation and returns either a proposal or a
 * question. It never invents a value to fill a gap.
 *
 * ============================================================================
 * WHAT THIS REPLACES, AND WHY IT HAD TO GO
 * ============================================================================
 *
 * The prototype flow it supersedes did all of the following when the manager
 * had not supplied them:
 *
 *   employee            -> "Jane Kowalski"
 *   topic               -> "repeated tardiness"
 *   incident details    -> "Arrived after the start of a scheduled shift on
 *                          three occasions in the past two weeks, between ten
 *                          and twenty minutes late each time."
 *   employee role       -> "Tanning Consultant"
 *   expected action     -> a generated sentence about meeting the standard
 *   follow-up           -> today + 14 days
 *
 * Every one of those is a load-bearing fact on an employment document, and
 * every one was a default. Harmless in a demo; indefensible the moment the
 * record is real. There are no fallbacks in this file. A missing fact is
 * reported as missing.
 */

/*
 * `detectTemplateIntent` used to live here and now lives in `template-intent.ts`
 * — pure, and importable from the browser bundle so the preview provider reads
 * a sentence the same way the server does. This module stays server-only
 * because a proposal depends on the authenticated scope.
 */

/*
 * The bounded window's NUMBERS and its ALGORITHM both live in
 * `bounded-context.ts`, which is pure and importable from the browser bundle.
 * The browser bounds the same conversation again when it assembles drafting
 * notes, and two implementations of one rule is exactly how the two answers
 * drifted apart. Re-exported so this module stays the one thing callers import.
 */
export { MANAGER_CONTEXT_CHARS, MANAGER_CONTEXT_TURNS } from "./bounded-context";

export type ManagerContext = BoundedContext;

/**
 * ============================================================================
 * MANAGER TURNS ONLY
 * ============================================================================
 *
 * The eventual form must be based on what the MANAGER said. An assistant turn
 * is Sunny's interpretation of what the manager said, and promoting an
 * interpretation to a factual HR record is the worst failure available here —
 * it is also the one nobody would notice, because the wording reads fine.
 *
 * So assistant turns are excluded structurally rather than filtered by
 * heuristic: only `role === "user"` is read, and a turn carrying an `error` is
 * skipped because a failed turn is not something anybody said.
 *
 * THE BOUNDING ITSELF IS NOT HERE. This function decides WHO SPOKE; the window
 * decides HOW MUCH FITS. Keeping them apart is what lets the browser apply the
 * identical window to the identical turns — see `bounded-context.ts` for the
 * recency rule and why it exists.
 */
export function managerContext(
  history: Pick<ChatMessage, "id" | "role" | "content" | "error">[],
  current: { id?: string; content: string },
): ManagerContext {
  const prior = history
    .filter((message) => message.role === "user" && !message.error)
    .filter((message) => typeof message.content === "string" && message.content.trim() !== "")
    .map((message) => ({ id: message.id, content: message.content }));

  return boundManagerTurns(prior, current);
}

/* ------------------------------------------------------- employee intent -- */

/*
 * PUNCTUATION AROUND A NAME IS NOT PART OF IT. "(paulyne)", "\"paulyne co\""
 * and "'paulyne'" are the same answer as "paulyne", and a manager should not
 * have to retype it bare. Only the OUTSIDE edges are stripped — opening
 * brackets and quotes before the first word, closing ones and sentence
 * punctuation after the last — so the apostrophe in O'Connor and the hyphen in
 * Anne-Marie, which sit inside a word, are never touched.
 */
const WRAPPER_BEFORE = /^[(\[{"“‘'«]+/;
const WRAPPER_AFTER = /[)\]}"”’'»,.;:!?]+$/;

/**
 * The name at the start of `words`, read without regard to capitalisation, or
 * null.
 *
 * At most TWO words — a first name and a surname or initial. Without capitals
 * nothing marks where a name ends, and a third lower-case word is more often
 * the start of the sentence ("paulyne co wore slippers") than a middle name. A
 * capitalised name of any length is still read by the patterns above.
 *
 * `whole` requires every word to be part of the name: it is the test for a
 * message (or an intake line) that consists of nothing else.
 */
function readTypedName(words: readonly string[], whole: boolean): string | null {
  const parts: string[] = [];
  let endedOnPunctuation = false;
  for (const raw of words) {
    // A third part only where a name position was read — see below.
    if (parts.length === (whole ? 2 : 3)) break;
    // An opening wrapper can only precede the name, so only the first word loses one.
    const opened = parts.length === 0 ? raw.replace(WRAPPER_BEFORE, "") : raw;
    const ends = WRAPPER_AFTER.test(opened);
    const word = opened.replace(WRAPPER_AFTER, "");
    const lower = word.toLowerCase();
    const usable =
      TYPED_NAME_WORD.test(word) &&
      // The first part is a real word; a trailing initial ("C") may follow it.
      (parts.length > 0 || word.length > 1) &&
      !NOT_A_NAME.has(lower) &&
      !NOT_A_TYPED_NAME.has(lower) &&
      !isFormVocabulary(lower);
    if (!usable) {
      if (whole) return null;
      break;
    }
    parts.push(word);
    endedOnPunctuation = ends;
    if (ends) break;
  }
  /*
   * A MIDDLE NAME IS KEPT ONLY WHERE THE NAME VISIBLY ENDS AFTER IT. "for mary
   * anne cruz to salon 24" and "for john michael doe effective october 2" are
   * three-part names, because what follows is plainly not a name; "for paulyne
   * co wore slippers" is a two-part name and the start of a sentence. So a
   * third word stays only when it ends the message, carries the punctuation,
   * or is followed by a word that cannot be part of a name.
   */
  if (parts.length === 3 && !endedOnPunctuation) {
    const next = words[3]?.replace(WRAPPER_AFTER, "").toLowerCase();
    const boundary =
      next === undefined ||
      NOT_A_NAME.has(next) ||
      NOT_A_TYPED_NAME.has(next) ||
      isFormVocabulary(next) ||
      /^\d/.test(next);
    if (!boundary) parts.pop();
  }
  if (parts.length === 0) return null;
  if (whole && parts.length !== words.length) return null;
  return parts.join(" ");
}

/** The first item of a one-line answer with at least three comma-separated items. */
const INTAKE_LIST = /^\s*([^,\n]+),[^,\n]*,/;

/*
 * ============================================================================
 * "KS SHAWNEE" IS A SALON, BECAUSE EVERY SALON'S NAME SAYS SO
 * ============================================================================
 *
 * Every store name in the production roster opens with its state — "KS
 * Shawnee Mission Pkwy", "NE Kearney", "MO St Joseph" — and managers shorten
 * the rest but keep the prefix. A capitalised pair was otherwise a person, so
 * "<name>, NE Kearney, today" made the SALON the employee when the name was in
 * lower case, and made the turn ambiguous when it was not.
 *
 * THE ROSTER IS THE EVIDENCE, not a list of the fifty states: only the prefixes
 * the business's own salons carry, and only written as a prefix is written —
 * in capitals, followed by a word that is not. "Mo Smith" is a person, and so
 * is "MO SMITH" in an all-caps sentence; neither matches.
 */
const ROSTER_STATES = new Set(PRODUCTION_SALONS.map((salon) => salon.state));

/**
 * A NAME THAT IS A SALON ON THE ROSTER IS A PLACE, in any case.
 *
 * `opensWithRosterState` deliberately lets an all-caps "MO SMITH" through as a
 * person, so an all-caps "NE KEARNEY" came through too and made the turn
 * ambiguous between the employee and a salon. This is exact rather than a
 * shape: the candidate, normalised the way reporting normalises store names,
 * IS one of the fifteen salons — with or without its state prefix, when that
 * leaves more than one word. "Lincoln O Street" is a salon; "Kearney" alone is
 * never a candidate unless it is the whole message, and is left alone.
 */
const ROSTER_NAME_KEYS: ReadonlySet<string> = new Set(
  PRODUCTION_SALONS.flatMap((salon) => {
    const full = storeNameKey(salon.name);
    const short = full.replace(/^[a-z]{2} /, "");
    return short.includes(" ") ? [full, short] : [full];
  }),
);

function isRosterSalonName(candidate: string): boolean {
  return ROSTER_NAME_KEYS.has(storeNameKey(candidate));
}

function opensWithRosterState(candidate: string): boolean {
  const [head, next] = candidate.split(/\s+/);
  return (
    head !== undefined &&
    next !== undefined &&
    ROSTER_STATES.has(head) &&
    next !== next.toUpperCase()
  );
}

export type EmployeeResolution =
  | { kind: "resolved"; employeeName: string }
  | { kind: "missing" }
  /** More than one plausible person. The manager says which; Sunny does not. */
  | { kind: "ambiguous"; candidates: string[] };

/**
 * Names the manager mentioned, in their own turns.
 *
 * CONSERVATIVE ON PURPOSE. The prototype accepted a capitalised first word,
 * which turned "Create a coaching form for a performance concern" into an
 * employee called **Create** — invisible while it only appeared in demo prose,
 * and a name on somebody's employment file the moment the record was real.
 *
 * Two shapes are accepted: an explicit `for <Name>` / `about <Name>`, and a
 * capitalised full name anywhere. A lone capitalised word is accepted only when
 * it is the entire message — which is what a manager types when Sunny has just
 * asked who the form is for.
 *
 * CASE IS NOT REQUIRED where the position says a name is being given — the
 * whole message, item 1 of a numbered answer, or directly after "<form> for".
 * There "paulyne", "paulyne co" and "PAULYNE CO" read exactly as "Paulyne Co"
 * does, and a first name alone is a name. See `readTypedName`.
 */
export function extractEmployeeNames(text: string): string[] {
  return readEmployeeMentions(text).names;
}

/**
 * ============================================================================
 * WHO A TURN NAMES — AND HOW SURE IT IS ABOUT IT
 * ============================================================================
 *
 * PRODUCTION QA, 30 September 2026, with a confirmed employee on screen:
 *
 *   "This is a policy review coaching about opening the salon late."
 *        → the employee became "opening"
 *   "No, not Jordan Testperson. Avery Testperson."
 *        → two candidates, so the correction produced no employee at all
 *   "It's Avery Testperson"
 *        → an employee called "It's Avery Testperson"
 *
 * The readers above each answered "is there a name here?", and nothing said
 * WHERE it came from — so a name in the narrative counted exactly as much as a
 * name the manager gave as the answer, and the newest of either replaced a
 * person they had already confirmed.
 *
 * So each reading now carries its provenance:
 *
 *   names      the people this turn names, one spelling each, the manager's
 *              own spelling kept; anybody the turn says it is NOT removed
 *   explicit   whether the turn names the employee ON PURPOSE — a label
 *              ("employee: …", "the employee is …"), the form's subject
 *              ("coaching form for …"), the whole answer ("It's …", "this is
 *              for …"), or a correction ("sorry", "actually", "not Jordan")
 *   negated    who the manager said it is not: "not Jordan Testperson"
 *
 * `resolveEmployee` is what uses the difference: a name mentioned in passing
 * never replaces a confirmed employee, and a name given on purpose always
 * does. There is still ONE reader of a sentence — this one — which every
 * caller goes through.
 */
export interface EmployeeMentions {
  names: string[];
  explicit: boolean;
  negated: string[];
}

export function readEmployeeMentions(typed: string): EmployeeMentions {
  // "pls", "u", "frm" are never names and never end one; read them as words.
  // "general training", "team-wide", "everyone at the salon" describe the team,
  // never a person — they are taken out first. See `maskTeamSubjectPhrases`.
  const text = maskTeamSubjectPhrases(canonicalShorthand(typed));
  /* Names read from a position that says a person is being given on purpose. */
  const strong: string[] = [];
  /* Names read from the narrative: a capitalised pair, "with Jordan". */
  const found: string[] = [];

  /*
   * A WORD THAT NAMES A FORM NEVER NAMES A PERSON.
   *
   * "Coaching Form for Sarah Test, she was late today" used to yield TWO
   * candidates — "Coaching Form" and "Sarah Test" — so the turn was ambiguous
   * and Ask Sunny asked who the form was about, having just been told. Every
   * template with two capitalised words in its name had the same fault, and
   * capitalising the form's name is the most natural way to ask for one.
   */
  const notAName = (word: string) =>
    NOT_A_NAME.has(word.toLowerCase()) || isFormVocabulary(word);

  const NAME = "[A-Z][a-zA-Z'’-]+";

  /*
   * ==========================================================================
   * A SURNAME GIVEN AS AN INITIAL IS STILL A NAME
   * ==========================================================================
   *
   * `NAME` requires two characters, so "Paulyne C" matched nothing at all. A
   * manager answering "who is this form for?" with
   *
   *     "Paulyne C she was wearing slippers today and was already given
   *      verbal warning on aug 21"
   *
   * got the identical question back, having just answered it — and everything
   * else in that sentence, the incident and the prior warning, was read
   * correctly. First name plus last initial is how half the salon refers to
   * people, so this was not an edge case.
   *
   * TRAILING ONLY, AND NEVER ON ITS OWN. The first part must still be a real
   * word: "C Paulyne" is not a name, and a lone capital anywhere would turn
   * every sentence-initial "I" into somebody's employee. `(?![a-zA-Z])` is what
   * keeps the initial distinct from the first letter of a longer surname, so
   * "Paulyne Camacho" still matches `NAME` and not this.
   *
   * The two lone capitals that ARE ordinary English — "I" and "A" — are in
   * NOT_A_NAME, which is checked on every part below.
   */
  const INITIAL = "[A-Z](?![a-zA-Z])\\.?";
  const PART = `(?:${NAME}|${INITIAL})`;
  /*
   * ==========================================================================
   * "AT LINCOLN SOUTH" IS A SALON, AND IT WAS BEING READ AS A SECOND PERSON
   * ==========================================================================
   *
   * "Jessica Vance is an SDIT at Lincoln South" yields TWO capitalised pairs,
   * so the request was ambiguous and Ask Sunny asked which of them the form
   * was for — having just been told, in a sentence where one of the two is
   * plainly a place. Every salon whose name is two words had this: Lincoln
   * South, Kansas City, Union Square.
   *
   * THE PREPOSITION IS THE EVIDENCE, and it is the manager's own. A capitalised
   * pair introduced by "at" or "in" is where something happened; a person is
   * introduced by "for", "about", "with" or "regarding", and those are the
   * prepositions the person pattern below reads. Nothing here guesses from the
   * words themselves — there is no salon roster to check a name against, and
   * inventing one is what this module refuses to do.
   *
   * IT ONLY EVER REMOVES A CANDIDATE THE SENTENCE PATTERN FOUND. A name that
   * ALSO appears in a person position survives: "a coaching form for Sarah
   * Jones, who I met at Sarah Jones" is not a sentence anybody types, and the
   * asymmetry means the fix cannot lose an employee it was not already about
   * to ask a needless question over.
   */
  const AT_A_PLACE = new RegExp(`\\b(?:at|in)\\s+(${NAME}(?:\\s+${PART})+)`, "g");
  const AS_A_PERSON = (candidate: string) =>
    new RegExp(
      `\\b(?:for|about|with|regarding)\\s+${candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
    ).test(text);
  /*
   * ==========================================================================
   * "SARAH JOHNSON, LINCOLN SOUTH, TODAY" IS AN ANSWER TO THE INTAKE
   * ==========================================================================
   *
   * The intake asks for the name, then the salon, then the date, in that
   * order, and managers answer it on one line exactly as it was asked — which
   * is the whole point of asking it as a list. That line carries no
   * preposition, so `AT_A_PLACE` above saw nothing, and the second item came
   * back as a SECOND CAPITALISED PAIR: Ask Sunny asked whether the form was
   * for Sarah Johnson or for Lincoln South, one message after asking for both.
   *
   * THE SHAPE IS THE EVIDENCE, and it is as specific as the preposition was.
   * The whole message must OPEN with `<Name>, <Two capitalised words>, ` and
   * the third item must be a DATE — which is the third thing the intake asked
   * for and the thing no list of people ends with. Prose cannot match it: it
   * is anchored at the start, and a sentence describing somebody does not
   * reach a date by its second comma.
   *
   * SINGLE-WORD SALONS NEVER NEEDED THIS. "Kearney" is one capitalised word,
   * and a lone capitalised word is not a candidate unless it is the entire
   * message — so only the two-word salons were ever affected, which is the
   * same set `AT_A_PLACE` was written for.
   *
   * IT ONLY EVER REMOVES A CANDIDATE, and one that is named as a person
   * anywhere in the message survives, exactly as above.
   */
  const DATEISH =
    "(?:[Tt]oday|[Yy]esterday|[Tt]onight|[Tt]his morning|\\d{1,2}/\\d{1,2}|\\d{4}-\\d{2}-\\d{2}|(?:[Jj]an|[Ff]eb|[Mm]ar|[Aa]pr|[Mm]ay|[Jj]un|[Jj]ul|[Aa]ug|[Ss]ep|[Oo]ct|[Nn]ov|[Dd]ec)[a-z]*\\.?\\s+\\d{1,2})";
  const intakeSalon = new RegExp(
    `^\\s*${NAME}(?:\\s+${PART})*\\s*,\\s*(${NAME}(?:\\s+${PART})+)\\s*,\\s*${DATEISH}\\b`,
  ).exec(text)?.[1];

  const places = new Set(
    [
      ...[...text.matchAll(AT_A_PLACE)].map((match) => match[1]!.trim()),
      ...(intakeSalon ? [intakeSalon.trim()] : []),
    ]
      // Named as a person somewhere too, so the position is not the whole story.
      .filter((candidate) => !AS_A_PERSON(candidate)),
  );

  /*
   * ==========================================================================
   * "EMPLOYEE NAMED DEMO ALPHA TEST": THE MANAGER SAID WHICH WORDS ARE THE NAME
   * ==========================================================================
   *
   * Found in production QA. "Create a Demotion Form for a synthetic test
   * employee named Demo Alpha Test at salon 12 … current position is District
   * Manager … for QA" was asked whether the form was for Demo Alpha Test,
   * District Manager or QA. "The employee is Demo Alpha Test. … District
   * Manager is the current position" got the same question again. And
   * "…employee Transfer Beta Test" lost "Transfer" to the change-verb reading
   * below and became "Beta Test".
   *
   * ONLY PHRASES THAT IDENTIFY THE EMPLOYEE, and narrow on purpose. A first
   * version also read a bare "named X" and "Employee <Word>", so "a customer
   * named Karen", "the Employee Handbook", "the Employee Dress Code" and
   * "Employee Name: Jane Doe" put Karen, Handbook, Dress Code and Name on the
   * form. What counts now:
   *
   *   "employee named X", "team member named X"     never a bare "named X"
   *   "employee X", with "employee" in lower case   "the Employee Handbook"
   *                                                  is a document's title
   *   "employee name: X", "employee: X"
   *   "the employee is X", "X is the employee"
   *
   * and a name ending in a document word (Handbook, Code, Policy …) is never
   * one. Such a name is read whole, including a first word that is also a
   * form word ("employee Transfer Beta Test").
   *
   * THE FORM'S SUBJECT STILL WINS. The marked name is the only candidate in
   * the message only when no "<form> for <name>" in it names somebody else;
   * otherwise both are candidates and the manager is asked.
   */
  const MARKED_NAME = `${NAME}(?:\\s+${PART}){0,3}`;
  const PERSON_MARKED = [
    new RegExp(`\\b(?:[Ee]mployee|[Tt]eam\\s+[Mm]ember|[Ss]taff\\s+[Mm]ember)\\s+(?:named|called)\\s+(${MARKED_NAME})`, "g"),
    new RegExp(`\\bemployee\\s+(${MARKED_NAME})`, "g"),
    new RegExp(`\\b[Ee]mployee(?:['’]s)?\\s+[Nn]ame\\s*(?::|-|is\\b|was\\b)\\s*(${MARKED_NAME})`, "g"),
    new RegExp(`\\b(?:[Ee]mployee|[Tt]eam\\s+[Mm]ember)\\s*:\\s*(${MARKED_NAME})`, "g"),
    new RegExp(`\\b[Ee]mployee\\s+(?:is|was)\\s+(${MARKED_NAME})`, "g"),
    new RegExp(`\\b(${MARKED_NAME})\\s+is\\s+the\\s+employee\\b`, "g"),
  ];
  const marked: string[] = [];
  for (const pattern of PERSON_MARKED) {
    for (const match of text.matchAll(pattern)) {
      const candidate = markedName(match[1]!);
      if (candidate) marked.push(candidate);
    }
  }
  marked.push(...labelledNames(text));
  // "employee named paulyne co": the same marker, for a name typed without capitals.
  if (marked.length === 0) {
    for (const match of text.matchAll(/\b(?:employee|team member|staff member)\s+named\s+(\S+(?:\s+\S+)?)/gi)) {
      const candidate = readTypedName(match[1]!.split(/\s+/), false);
      if (candidate) marked.push(candidate);
    }
  }
  if (marked.length > 0) {
    const overlaps = (a: string, b: string) => {
      const [x, y] = [a.toLowerCase(), b.toLowerCase()];
      return x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `);
    };
    const subjects = formSubjectNames(text);
    if (subjects.every((subject) => marked.some((name) => overlaps(name, subject)))) {
      return settle(marked, [], text);
    }
    strong.push(...marked);
  }

  /*
   * A NAME WHOSE FIRST WORD IS ALSO A FORM WORD, straight after "<form> for":
   * "Position Transfer Form for Transfer Beta Test". That position already
   * says a person follows, and the form has already been named. Kept only
   * where at least two ordinary name words follow the form word. A message
   * that merely STARTS with a form word ("Demote Paulyne Co", "Exit Jane
   * Smith") is never read this way.
   */
  // Case-sensitive on the name; the form noun before "for" is checked in any case.
  const FORM_WORD_LED = new RegExp(
    `\\b([A-Za-z-]+)\\s+(?:[Ff]or|[Aa]bout|[Rr]egarding)\\s+(${NAME}(?:\\s+${PART}){2,3})`,
    "g",
  );
  const FORM_NOUN = new RegExp(`^(?:${FORM_NOUNS})$`, "i");
  for (const match of text.matchAll(FORM_WORD_LED)) {
    if (!FORM_NOUN.test(match[1]!)) continue;
    const words = match[2]!.trim().split(/\s+/);
    if (!isFormVocabulary(words[0]!) || /^forms?$/i.test(words[0]!)) continue;
    const candidate = markedName(match[2]!);
    if (candidate) strong.push(candidate);
  }

  const FULL = new RegExp(`\\b(${NAME}(?:\\s+${PART})+)`, "g");
  for (const match of text.matchAll(FULL)) {
    const run = match[1]!.trim();
    if (places.has(run)) continue;
    /*
     * "It's Avery Testperson", "Sorry Avery Testperson": the capitalised run
     * starts with the reply, not the name. The reply is dropped; a run that
     * was only the reply names nobody.
     */
    const candidate = withoutConversationalLead(run);
    if (candidate === null) continue;
    if (opensWithRosterState(candidate) && !AS_A_PERSON(candidate)) continue;
    if (isRosterSalonName(candidate)) continue;
    if (isJobTitlePhrase(candidate)) continue;
    if (!candidate.split(/\s+/).some(notAName)) {
      // Led by a reply ("It's …"), the run IS the answer.
      (candidate === run ? found : strong).push(candidate);
    }
  }

  const PREPOSED = new RegExp(`\\b(?:for|about|with|regarding)\\s+(${NAME})\\b`, "g");
  for (const match of text.matchAll(PREPOSED)) {
    const candidate = match[1]!.trim();
    if (!notAName(candidate)) found.push(candidate);
  }

  /*
   * ==========================================================================
   * "JESSICA IS AN SDIT AT LINCOLN SOUTH" NAMES JESSICA
   * ==========================================================================
   *
   * A FIRST NAME ON ITS OWN IS HOW MANAGERS REFER TO THEIR TEAM, and it was
   * reaching nothing: a full name needs two capitalised parts, the preposed
   * pattern needs "for" or "about", and the whole-message pattern needs the
   * name to be the entire turn. So the sentence a manager most naturally opens
   * with — the one that introduces the person and their role — resolved to no
   * employee at all, and Ask Sunny asked who the plan was for immediately
   * after being told.
   *
   * THE ROLE IS WHAT MAKES IT SAFE. This is not "accept a capitalised word":
   * it is a capitalised word, followed by a copula, followed by a JOB TITLE
   * THIS BUSINESS USES — checked through `extractJobTitle`, so the vocabulary
   * has one definition and this pattern cannot drift from the one the proposal
   * reads the title with.
   *
   * WHAT IT STILL REFUSES. "Create a coaching form for a performance concern"
   * has no copula-plus-role and yields nothing, which is the defect this whole
   * module was written to remove. "She is an SDIT" yields nothing, because the
   * pronouns are in `NOT_A_NAME`. A form's own name yields nothing, because
   * `isFormVocabulary` rejects it.
   */
  /*
   * THE WHOLE NAME BEFORE THE COPULA, not its last word. Anchored on `NAME`
   * alone this matched "Vance is an SDIT" inside "Jessica Vance is an SDIT"
   * and produced a SECOND candidate — so a manager who gave a full name was
   * asked to choose between it and its own surname.
   */
  const NAMED_ROLE = new RegExp(
    `\\b(${NAME}(?:\\s+${PART})*)\\s+(?:is|was)\\s+(?:an?|our|the)\\s+(?:new\\s+)?([A-Za-z][A-Za-z ]{0,28}?)(?=[,.;!?]|\\s+(?:at|in|on|and|who|but)\\b|$)`,
    "g",
  );
  for (const match of text.matchAll(NAMED_ROLE)) {
    const candidate = match[1]!.trim();
    if (candidate.split(/\s+/).some(notAName)) continue;
    if (extractJobTitle(match[2] ?? "") === null) continue;
    found.push(candidate);
  }

  /*
   * ==========================================================================
   * A NAME IS A NAME IN ANY CASE, WHERE THE SENTENCE SAYS IT IS ONE
   * ==========================================================================
   *
   * Everything above reads a capital letter as the evidence. That made
   * "Create a Corrective Action form for paulyne", "paulyne co" and "test test"
   * unreadable — no employee, so no form — while "Paulyne Co" worked. It also
   * lost names in an all-caps sentence ("…FORM FOR PAULYNE CO", where the full
   * pattern swallowed the whole line) and dropped a surname followed by a
   * capitalised word ("for Paulyne Co She wore…" yielded "Paulyne").
   *
   * Without capitals, THE POSITION IS THE EVIDENCE, and only three positions
   * are strong enough to carry it:
   *
   *   1. directly after a FORM plus "for" / "about" / "regarding" —
   *      "corrective action form for paulyne", "coaching for test test";
   *   2. the WHOLE MESSAGE, optionally introduced as "for …" / "it's for …" —
   *      the answer a manager types when Sunny has asked who the form is for;
   *   3. item 1 of a NUMBERED answer, which is the employee's name because the
   *      intake asks for the name first.
   *
   * "What is the policy for tardiness?" is none of these, so a question asked
   * while a proposal is open still reads as a question — the guarantee
   * `intentForTurn` depends on. The name is kept as typed (spaces collapsed):
   * the record is the manager's own words, and the field stays editable.
   */
  /*
   * EVERY FORM'S NAME, NOT A LIST OF SOME (#51). The lead words are the
   * library's own namings (`FORM_NAME_PATTERN`, derived from
   * `template-intent.ts`) plus the generic nouns, and "CA" is one of them. Up
   * to four words are read, so a middle name survives; `readTypedName` decides
   * where the name ends. See `formSubjectNames`.
   */
  strong.push(...formSubjectNames(text));

  /*
   * THE NAME RIGHT AFTER A FORM'S NAME, WITH NO "FOR": "Exit John Doe",
   * "coaching Dana Moss", "Demotion jane smith". Only where the message LEADS
   * with the form — the same reading `detectTemplateIntent` makes — so a form
   * named in passing never turns the next word into a person.
   */
  const leading = leadingFormRequest(text);
  if (leading && leading.subject.length > 0) {
    const candidate = readTypedName(leading.subject.slice(0, 4), false);
    if (candidate && !opensWithRosterState(candidate)) strong.push(candidate);
  }

  /*
   * ==========================================================================
   * 1b. THE PERSON A CHANGE IS DONE TO, OR WHO IS MAKING ONE
   * ==========================================================================
   *
   * "demote paulyne from manager to TC" and "transfer jane to salon 18" put the
   * name straight after the verb; "Jane is transferring from salon 12" and
   * "mike quit, last day was 9/25" put it at the start of the sentence, before
   * the change. Both positions are as strong as "<form> for <name>": the verb
   * says a person comes next, or the sentence opens with who it is about.
   *
   * The same `readTypedName` and stop words apply, so "transfer her", "transfer
   * form", "our SD is leaving" and "she quit" yield nobody, and the sentence
   * opener must be the name ALONE — "I think jane is leaving" is three words
   * before the verb and is not read.
   */
  const CHANGE_VERB_THEN_PERSON = /\b(?:demote|demoting|transfer|transferring|transfering)\s+(\S+(?:\s+\S+){0,3})/gi;
  for (const match of text.matchAll(CHANGE_VERB_THEN_PERSON)) {
    const candidate = readTypedName(match[1]!.split(/\s+/), false);
    if (candidate) strong.push(candidate);
  }
  const PERSON_THEN_CHANGE =
    /^(\S+?)(?:['’]s)?(?:\s+(?!(?:is|was|has|will|resigned|resigning|quit|quitting|transferring|transfering|transferred|moving|leaving|demoted|stepping|stepped|gave|put|wants|no)\b)(\S+?)(?:['’]s)?)?(?:,)?\s+(?:(?:is|was|has been|will be|'s)\s+)?(?:(?:being|getting|going to be)\s+)?(?:transferring|transfering|transferred|moving|leaving|quitting|quit|resigning|resigned|demoted|stepping down|stepped down|no[\s-]?call|gave (?:her |his |their )?notice|put in (?:her |his |their )?notice|wants to (?:step down|transfer|resign|quit))\b/i;
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const match = PERSON_THEN_CHANGE.exec(sentence.trim());
    if (!match) continue;
    const words = [match[1]!, ...(match[2] ? [match[2]] : [])];
    const candidate = readTypedName(words, true);
    if (candidate && !opensWithRosterState(candidate)) strong.push(candidate);
  }

  /*
   * THE PERSON A REQUEST IS FOR, NAMED FIRST: "avery testperson needs a
   * coaching form today". Found in production QA — the title-case control
   * passed and the lower-case one did not, because only a capitalised pair
   * was read in that position. The sentence must OPEN with the name alone,
   * like the change reading above, so "she needs a form" and "the team needs
   * coaching" name nobody — and what is needed must be a form or the coaching
   * itself, so "Punctuality needs work" names nobody either.
   */
  const PERSON_THEN_NEEDS =
    /^(\S+?)(?:['’]s)?(?:\s+(\S+?))?\s+(?:needs|need|requires|should\s+get|could\s+use|has\s+to\s+(?:get|have|do))\s+(?:(?:a|an|the|some|more|another|new)\s+)?(?:coaching|coached|forms?|documents?|documentation|write[- ]?ups?|ca|corrective|epp|plan|review|policy|exit|demotion|transfer|follow[- ]?up|to\s+be\s+(?:coached|written|documented))\b/i;
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const match = PERSON_THEN_NEEDS.exec(sentence.trim());
    if (!match) continue;
    const candidate = readTypedName([match[1]!, ...(match[2] ? [match[2]] : [])], true);
    if (candidate && !opensWithRosterState(candidate)) strong.push(candidate);
  }

  /*
   * THE PERSON A CONVERSATION WAS WITH, in any case: "i coached avery
   * testperson on client tours", "coach Avery", "talked to jordan". Narrative,
   * so it never outranks a name given on purpose — but it is somebody, and a
   * lower-case one used to be nobody at all.
   */
  const CONVERSED_WITH =
    /\b(?:coach|coached|talked\s+(?:to|with)|talk\s+(?:to|with)|spoke\s+(?:to|with)|speak\s+(?:to|with)|met\s+with|meet\s+with|sat\s+down\s+with|sit\s+down\s+with)\s+(\S+(?:\s+\S+){0,3})/gi;
  for (const match of text.matchAll(CONVERSED_WITH)) {
    const candidate = readTypedName(match[1]!.split(/\s+/), false);
    if (candidate && !opensWithRosterState(candidate)) found.push(candidate);
  }

  const answers = [
    text,
    ...text.split(/\n/).flatMap((line) => /^\s*1\s*[.)]\s*(.+)$/.exec(line)?.[1] ?? []),
  ];
  for (const answer of answers) {
    const words = withoutAnswerLead(answer.trim().replace(/[.?!]+$/, ""))
      .split(/\s+/)
      .filter(Boolean);
    const candidate = words.length <= 2 ? readTypedName(words, true) : null;
    if (candidate && !opensWithRosterState(candidate)) strong.push(candidate);
  }

  /*
   * ==========================================================================
   * 4. THE FIRST ITEM OF THE INTAKE, ANSWERED ON ONE LINE
   * ==========================================================================
   *
   * REPORTED FROM THE ROLLOUT as "Create a form from this conversation
   * is failing". The intake asks for the name, the salon, the date and the
   * concern as a numbered list, and a manager answered it the way people do:
   *
   *     "<first last>, KS <city>, she is the salon director. we can use todays
   *      date. the concern is …"
   *
   * In lower case, followed by a comma, the name was in none of the positions
   * above, so the turn yielded no employee, `intentForTurn` read it as a new
   * subject, and the open proposal was dropped: no card, no form.
   *
   * THE LIST IS THE EVIDENCE, as the numbered answer is in (3). It must have at
   * least THREE comma-separated items — the intake asks for four or five, and a
   * sentence that merely contains a comma rarely leads with two words and then
   * reaches a second one — and the first item must be a name on its own, one or
   * two words, read by the same `readTypedName` with the same stop words. So
   * "what is the policy for tardiness, call outs, and no shows?" still reads as
   * a question: its first item is six words.
   */
  const listed = INTAKE_LIST.exec(text)?.[1];
  if (listed) {
    const words = listed.trim().split(/\s+/).filter(Boolean);
    const candidate = words.length <= 2 ? readTypedName(words, true) : null;
    if (candidate && !opensWithRosterState(candidate)) strong.push(candidate);
  }

  return settle(strong, found, text);
}

/**
 * A capitalised name the manager marked as the person ("employee named …"),
 * or null when those words are not a name after all: a pronoun or article, a
 * job title ("the employee is District Manager" is not a name), or form words
 * with fewer than two ordinary name words beside them.
 */
function markedName(raw: string): string | null {
  const words = raw.trim().split(/\s+/);
  if (words.some((word) => NOT_A_NAME.has(word.toLowerCase()))) return null;
  if (words.some((word) => DOCUMENT_WORDS.has(word.toLowerCase()))) return null;
  const candidate = words.join(" ");
  if (isJobTitlePhrase(candidate) || isRosterSalonName(candidate)) return null;
  const ordinary = words.filter((word) => !isFormVocabulary(word)).length;
  if (ordinary === 0 || (ordinary < words.length && ordinary < 2)) return null;
  return candidate;
}

/*
 * ============================================================================
 * THE REPLY AROUND AN ANSWER IS NOT PART OF IT
 * ============================================================================
 *
 * "It's Avery Testperson", "Sorry, it's Avery", "I already said Avery
 * Testperson", "this is for avery testperson", "her name is Avery": the answer
 * to "who is this for?" arrives inside a reply, and the reply is not the name.
 * Found in production QA, where the capitalised run "It's Avery Testperson"
 * became the employee.
 */
const CONVERSATIONAL_LEAD = new Set([
  "it's", "it’s", "its", "it", "this", "that", "that's", "thats", "is", "the", "a", "an",
  "sorry", "no", "nope", "yes", "yeah", "yep", "oh", "ok", "okay", "actually", "hi", "hey",
  "hello", "so", "and", "but", "well", "um", "uh", "hmm", "like", "said", "already", "again",
  "also", "just", "please", "thanks", "oops", "correction", "wait", "her", "his", "their",
  "name", "name's", "names", "i", "i'm", "im", "meant", "mean",
]);

/** A lead that makes what follows an answer, so a lone first name after it counts. */
const ANSWER_LEAD = new Set([
  "it's", "it’s", "its", "this", "that's", "thats", "name", "name's", "sorry", "actually",
  "no", "nope", "said", "meant", "correction", "oops",
]);

/** A capitalised run without the reply it opened with, or null if it was all reply. */
function withoutConversationalLead(run: string): string | null {
  const words = run.split(/\s+/);
  let lead = 0;
  let answered = false;
  while (lead < words.length && CONVERSATIONAL_LEAD.has(words[lead]!.toLowerCase())) {
    if (ANSWER_LEAD.has(words[lead]!.toLowerCase())) answered = true;
    lead += 1;
  }
  if (lead === 0) return run;
  const rest = words.slice(lead);
  if (rest.length === 0 || (rest.length === 1 && !answered)) return null;
  return rest.join(" ");
}

/** The whole-message answer without the reply around it: "it's for …" → "…". */
const ANSWER_OPENER =
  /^(?:(?:sorry|oops|no|nope|actually|ok|okay|yes|yeah|oh|um|hmm|again|correction|like\s+i\s+said|as\s+i\s+said|i\s+(?:already\s+)?said|i\s+meant)\b[,.!:;\s-]*)+/i;
const ANSWER_FRAME =
  /^(?:(?:it'?s|it’s|it\s+is|its|this\s+is|this\s+one\s+is|that'?s|that\s+is|(?:the\s+)?(?:employee(?:['’]s)?\s+)?name\s+is|(?:her|his|their)\s+name\s+is|(?:the\s+)?employee\s+is|(?:the\s+)?person\s+is)\s+)?(?:(?:for|about)\s+)?/i;

function withoutAnswerLead(answer: string): string {
  return answer.replace(ANSWER_OPENER, "").replace(ANSWER_FRAME, "");
}

/*
 * ============================================================================
 * "EMPLOYEE: AVERY TESTPERSON" IN ANY CASE
 * ============================================================================
 *
 * The capitalised markers above read "Employee: Avery Testperson"; production
 * QA found "employee: avery testperson" read as nobody, so the Coaching intake
 * asked for the employee it had just been given. A LABEL is as strong as a
 * name position gets, so here the position is the evidence and case is not.
 *
 * A bare "name is …" counts only where it OPENS the message or a clause —
 * "name is avery testperson, today wearing slippers", found in production —
 * so "the company name is Sun Tan City" is still nobody.
 *
 * A copula ("the employee is …") is weaker than a colon, because what follows
 * is as often a description — "the employee is always late" — so there the
 * name must also visibly END: at the end of the line, at punctuation, or at a
 * word that starts the rest of the sentence.
 */
const LABELLED =
  /(?:\b(?:(?:the\s+)?(?:employee|team\s+member|staff\s+member)(?:['’]s)?\s+name|(?:the\s+)?(?:employee|team\s+member|staff\s+member|person)|(?:her|his|their|the)\s+name)|(?:^|[.!?\n,;]\s*)name)\s*(:|-|=|\bis\b|\bwas\b|\bshould\s+be\b|\bwill\s+be\b|\bshould\s+say\b)[ \t]*([^\n]*)/gi;

const LABEL_ENDS = new Set([
  "and", "but", "who", "she", "he", "they", "because", "since", "so", "today", "yesterday",
  "was", "is", "has", "had", "did", "from", "at", "in", "on", "for", "with", "not", "about",
]);

function labelledNames(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(LABELLED)) {
    const words = match[2]!.trim().split(/\s+/).filter(Boolean);
    const candidate = readTypedName(words, false);
    if (!candidate || !typedNameAllowed(candidate)) continue;
    if (!/^[:=-]$/.test(match[1]!)) {
      const length = candidate.split(/\s+/).length;
      const next = words[length]?.replace(WRAPPER_AFTER, "").toLowerCase();
      const ended = next === undefined || WRAPPER_AFTER.test(words[length - 1]!) || LABEL_ENDS.has(next);
      if (!ended) continue;
    }
    names.push(candidate);
  }
  for (const match of text.matchAll(/(?:^|[.!?\n]\s*)(\S+(?:\s+\S+)?)\s+is\s+the\s+employee\b/gi)) {
    const candidate = readTypedName(match[1]!.split(/\s+/), true);
    if (candidate && typedNameAllowed(candidate)) names.push(candidate);
  }
  return names;
}

/** A typed name that is not a job title, a salon, or a document's name. */
function typedNameAllowed(candidate: string): boolean {
  const words = candidate.toLowerCase().split(/\s+/);
  return !isJobTitlePhrase(candidate) && !isRosterSalonName(candidate) && !words.some((word) => DOCUMENT_WORDS.has(word));
}

/*
 * ============================================================================
 * "NO, NOT JORDAN TESTPERSON. AVERY TESTPERSON." NAMES ONE PERSON
 * ============================================================================
 *
 * VERIFIED IN PRODUCTION QA: both names were read as candidates, the turn was
 * ambiguous, and the manager who had just corrected the employee was asked
 * for the employee's full name. The negated name is the person it is NOT, so
 * it is removed from this turn's candidates and — in `resolveEmployee` — from
 * every earlier turn's too.
 */
const NEGATED_PERSON =
  /\b(?:not|isn'?t|wasn'?t|instead\s+of|rather\s+than)\s+(?:for\s+|about\s+)?(\S+(?:\s+\S+){0,2})/gi;

function negatedNames(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(NEGATED_PERSON)) {
    const candidate = readTypedName(match[1]!.split(/\s+/), false);
    if (candidate && typedNameAllowed(candidate)) names.push(candidate);
  }
  return names;
}

/**
 * A turn that corrects the employee. At the start of a sentence for the words
 * that are ordinary English elsewhere: "Actually it's Jordan" corrects, "she
 * actually covered for Jordan" does not.
 */
const CORRECTION_CUE =
  /(?:^|[.!?\n]\s*)(?:(?:sorry|oops|actually|correction)\b|no\s*[,.!]|no\s+not\b)|\b(?:i\s+meant|meant\s+to\s+say|wrong\s+(?:name|person|employee)|(?:name|employee|it|that)\s+should\s+(?:be|say|read)\s+\S|i\s+(?:already\s+)?said|like\s+i\s+said|as\s+i\s+said)\b|\binstead\s*[.!]?\s*$/i;

/** In a correction, a sentence that is only a name is the answer: "No, not Jordan. Avery." */
function sentenceAnswers(text: string): string[] {
  const names: string[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const words = withoutAnswerLead(sentence.trim().replace(/[.?!]+$/, "")).split(/\s+/).filter(Boolean);
    const candidate = words.length > 0 && words.length <= 2 ? readTypedName(words, true) : null;
    if (candidate && !opensWithRosterState(candidate)) names.push(candidate);
  }
  return names;
}

function settle(strong: string[], weak: string[], text: string): EmployeeMentions {
  const negated = negatedNames(text);
  const correction = negated.length > 0 || CORRECTION_CUE.test(text);
  const given = correction ? [...strong, ...sentenceAnswers(text)] : strong;
  const names = distinctNames([...given, ...weak]).filter(
    (name) => !negated.some((not) => samePerson(not, name)),
  );
  const explicit =
    names.length > 0 && (correction || names.some((name) => given.some((named) => samePerson(named, name))));
  return { names, explicit, negated };
}

/**
 * Whether two spellings are one person: the same words in any case, a first
 * name beside the full name, or a surname given as its initial ("Avery T").
 */
export function samePerson(a: string, b: string): boolean {
  const words = (name: string) =>
    name
      .toLowerCase()
      .replace(/['’]s\b/g, "")
      .replace(/\./g, "")
      .split(/\s+/)
      .filter(Boolean);
  const x = words(a);
  const y = words(b);
  if (x.length === 0 || y.length === 0) return false;
  if (x.join(" ") === y.join(" ")) return true;
  if (x.length === 1 || y.length === 1) return x[0] === y[0];
  if (x[0] !== y[0]) return false;
  const [last, other] = [x[x.length - 1]!, y[y.length - 1]!];
  return last === other || (last.length === 1 && other.startsWith(last)) || (other.length === 1 && last.startsWith(other));
}

/**
 * Words that end a document's or a policy's name, never a person's: "the
 * Employee Handbook", "the Employee Dress Code", "employee ID".
 */
const DOCUMENT_WORDS = new Set([
  "handbook", "code", "codes", "policy", "policies", "manual", "guide", "guidelines", "agreement",
  "discount", "portal", "id", "number", "file", "files", "record", "records", "benefits",
  "schedule", "conduct", "dress", "uniform", "training", "orientation", "meeting", "review",
  "reviews", "form", "forms", "badge", "account", "login", "lounge", "parking", "break", "room",
  "month", "week", "year", "day",
]);

/** The nouns that name a form or an action, before "for <person>". */
const FORM_NOUNS =
  "ca|forms?|actions?|coaching|plans?|epps?|dpoas?|warnings?|write[- ]?ups?|reviews?|notes?|documents?|records?|paperwork|demotions?|transfers?|resignations?|exits?|separations?";

/**
 * ============================================================================
 * THE PERSON A FORM IS FOR: "<FORM> FOR <NAME>"
 * ============================================================================
 *
 * "corrective action form for paulyne", "coaching for test test": directly
 * after a form plus "for" / "about" / "regarding", in any case. Also the
 * subject a marked name ("employee named …") must agree with before it is
 * taken alone. A description of the person that leads into the marked name
 * ("form for synthetic test employee Transfer Beta Test") is not a subject:
 * "synthetic test" is followed by "employee", so the name comes after it.
 */
function formSubjectNames(text: string): string[] {
  const subjects: string[] = [];
  const FORM_THEN_PERSON = new RegExp(
    `\\b(?:${FORM_NAME_PATTERN}|c\\.a\\.?|ca|${FORM_NOUNS})\\s+(for|about|regarding|on)\\s+(\\S+(?:\\s+\\S+){0,3})`,
    "gi",
  );
  for (const match of text.matchAll(FORM_THEN_PERSON)) {
    /*
     * "COACHING ABOUT OPENING THE SALON LATE" IS A TOPIC. Found in production
     * QA: "about" + a word ending "-ing" put "opening" on the form in place of
     * the confirmed employee. A form is ABOUT an activity far more often than
     * about a person; "for" is how a person is introduced, and it is unchanged.
     */
    if (!/^for$/i.test(match[1]!) && /ing$/i.test(match[2]!.split(/\s+/)[0]!)) continue;
    const candidate = readTypedName(match[2]!.split(/\s+/), false);
    if (!candidate) continue;
    /*
     * "A coaching ON avery testperson" (production QA). "On" introduces a topic
     * as often as a person — "coaching on memberships" — so after it only a
     * first name AND a surname are read as somebody.
     */
    if (/^on$/i.test(match[1]!) && candidate.split(/\s+/).length < 2) continue;
    const following = `${match[2]!} ${text.slice((match.index ?? 0) + match[0].length)}`
      .trim()
      .split(/\s+/)
      .slice(candidate.split(/\s+/).length);
    if (/^(?:employee|team|staff|named)$/i.test(following[0] ?? "")) continue;
    subjects.push(candidate);
  }
  return subjects;
}

/*
 * ============================================================================
 * "DISTRICT MANAGER" IS A JOB, NOT A SECOND EMPLOYEE
 * ============================================================================
 *
 * Found in production QA: "Their current position is District Manager" made
 * "District Manager" a candidate beside the employee, and Ask Sunny asked
 * which of the two the form was for. A capitalised pair that is wholly a job
 * title (one the business uses, or a title word such as Manager or Director
 * led only by words like Salon, District or Assistant) is never a person.
 */
const TITLE_HEAD = /^(?:managers?|directors?|consultants?|supervisors?|leads?|trainers?|coordinators?|specialists?)$/i;
const TITLE_MODIFIER =
  /^(?:salon|district|regional|area|store|general|assistant|shift|training|operations|tanning|spa|senior|junior|head|key)$/i;

function isJobTitlePhrase(candidate: string): boolean {
  if (JOB_TITLES.some((entry) => entry.pattern.test(candidate) && candidate.replace(entry.pattern, "").trim() === "")) {
    return true;
  }
  const words = candidate.trim().split(/\s+/);
  return (
    words.length >= 2 &&
    TITLE_HEAD.test(words[words.length - 1]!) &&
    words.slice(0, -1).every((word) => TITLE_MODIFIER.test(word))
  );
}

function distinctNames(found: readonly string[]): string[] {
  /*
   * ONE SPELLING PER PERSON, BEFORE ANYTHING IS COUNTED.
   *
   * "Paulyne C." matches both the sentence pattern and the whole-message one,
   * with and without the full stop, and the de-duplication below compares a
   * bare first name against a full one — it would have let those through as
   * TWO candidates and asked the manager which of the two Paulynes they meant.
   * Dropping the stop off a trailing initial makes them the same string.
   */
  const spellings = found.map((name) =>
    name.replace(/\s+/g, " ").replace(/\s([A-Za-z])\.$/, " $1"),
  );

  /*
   * De-duplicated, and a bare first name that is part of a full name already
   * found is the same person rather than a second candidate. COMPARED WITHOUT
   * CASE: "PAULYNE CO" found by the capitalised pattern and by the typed-name
   * one is one person, and "Paulyne" beside "paulyne co" is not two.
   */
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const first = (name: string) => name.split(/\s+/)[0]!;
  const unique: string[] = [];
  for (const name of spellings) {
    if (unique.some((kept) => same(kept, name))) continue;
    if (unique.some((kept) => same(first(kept), name) || same(first(name), kept))) {
      // Keep the longer form: "Sarah Jones" over "Sarah".
      const index = unique.findIndex((kept) => same(first(kept), first(name)));
      if (index >= 0 && name.length > unique[index]!.length) unique[index] = name;
      continue;
    }
    unique.push(name);
  }
  /*
   * "BETA TEST" INSIDE "TRANSFER BETA TEST" IS THE SAME PERSON. The change-verb
   * reading takes "Transfer" for the verb and reads what follows; where the
   * whole name was also read, the shorter one is its tail, not a second person.
   */
  return unique.filter(
    (name) =>
      !unique.some((other) => {
        if (other === name || !other.toLowerCase().endsWith(` ${name.toLowerCase()}`)) return false;
        const lead = other.slice(0, other.length - name.length).trim().split(/\s+/);
        return lead.every((word) => isFormVocabulary(word));
      }),
  );
}

/**
 * Who the form is about, read from MANAGER turns only, most recent first.
 *
 * There is no employee directory in Ask Sunny and none is invented here: the
 * value is the manager's own words, and `form_instances.employee_name` has
 * always been free text.
 */
export function resolveEmployee(context: ManagerContext): EmployeeResolution {
  return employeeState(context).resolution;
}

export interface EmployeeState {
  resolution: EmployeeResolution;
  /** Everybody the manager said the form is NOT for, in the window. */
  excluded: string[];
}

/**
 * ============================================================================
 * THE EMPLOYEE, AS THE CONVERSATION HAS SETTLED IT
 * ============================================================================
 *
 * This used to take the newest turn that yielded any name. VERIFIED IN
 * PRODUCTION QA, that meant a confirmed employee could be silently replaced
 * by whatever the next turn happened to contain — "coaching about opening"
 * put "opening" on the form one turn after the manager corrected it to Avery
 * Testperson.
 *
 * So the manager's turns are read IN ORDER, and each one can only do what its
 * words entitle it to (see `readEmployeeMentions` for what "explicit" means):
 *
 *   A NEGATION        removes that person, from this turn and every earlier
 *                     one — "not Jordan" is never the answer again.
 *   AN EXPLICIT NAME  sets the employee, replacing anybody before: a label, a
 *                     correction, "<form> for <name>", the whole answer.
 *   A PASSING NAME    sets the employee only when there is none yet. Beside a
 *                     CONFIRMED employee it changes nothing; beside one that
 *                     was itself only mentioned in passing, it is a second
 *                     candidate and the manager is asked.
 *   THE SAME PERSON   keeps the fuller spelling: "Avery" after "Avery
 *                     Testperson" is still Avery Testperson.
 *   TWO PEOPLE        named on purpose in one turn is a question, never a
 *                     choice — as it always was.
 *
 * Topic words, dates, salons and pronouns name nobody, so they cannot reach
 * any of this. There is no employee directory: every value is the manager's
 * own words, in the manager's own spelling.
 */
export function employeeState(context: ManagerContext): EmployeeState {
  let current: string | null = null;
  let confirmed = false;
  let pending: string[] | null = null;
  const excluded: string[] = [];
  const fuller = (kept: string, name: string) =>
    name.split(/\s+/).length >= kept.split(/\s+/).length ? name : kept;

  for (const message of context.messages) {
    const reading = readEmployeeMentions(message.content);
    for (const not of reading.negated) {
      excluded.push(not);
      if (current !== null && samePerson(current, not)) {
        current = null;
        confirmed = false;
      }
      if (pending) {
        pending = pending.filter((candidate) => !samePerson(candidate, not));
        if (pending.length === 1) [current, pending, confirmed] = [pending[0]!, null, false];
        else if (pending.length === 0) pending = null;
      }
    }
    const names = reading.names.filter((name) => !excluded.some((not) => samePerson(not, name)));
    if (names.length === 0) continue;

    if (names.length === 1) {
      const name = names[0]!;
      if (current !== null && samePerson(current, name)) {
        current = fuller(current, name);
        confirmed ||= reading.explicit;
        continue;
      }
      if (pending) {
        const matches: string[] = pending.filter((candidate) => samePerson(candidate, name));
        if (matches.length === 1) {
          [current, pending, confirmed] = [fuller(matches[0]!, name), null, reading.explicit];
          continue;
        }
        if (matches.length > 1) {
          pending = matches;
          continue;
        }
      }
      if (reading.explicit || (current === null && pending === null)) {
        [current, pending, confirmed] = [name, null, reading.explicit];
        continue;
      }
      if (confirmed) continue;
      pending = [...(pending ?? []), ...(current !== null ? [current] : []), name];
      [current, confirmed] = [null, false];
      continue;
    }

    // Several people in one turn. In passing, beside a confirmed employee, it changes nothing.
    if (!reading.explicit && confirmed) continue;
    [current, pending, confirmed] = [null, names, false];
  }

  if (pending) return { resolution: { kind: "ambiguous", candidates: distinctNames(pending) }, excluded };
  if (current !== null) return { resolution: completePartialName(current, context, excluded), excluded };
  return { resolution: { kind: "missing" }, excluded };
}

/**
 * ============================================================================
 * "FOR JANE" AFTER "JANE SMITH QUIT" IS JANE SMITH — AND AFTER TWO JANES, A
 * QUESTION
 * ============================================================================
 *
 * A first name on its own is how managers refer to somebody they have already
 * named in full: "Jane Smith walked out yesterday… termination/exit form for
 * Jane". Reading only the latest turn put "Jane" on the form. But the same
 * sentence after "Jane Smith and Jane Doe both quit" names neither, and taking
 * the first would be choosing whose file the form goes on.
 *
 * So a lone first name is completed from the manager's own earlier turns, by
 * first name and without regard to case: one full name that starts with it is
 * that person; two or more is AMBIGUOUS and the manager is asked which; none
 * leaves the first name as they typed it. There is no employee directory, so
 * this is the only place a partial name can be completed from — the
 * conversation — and nothing is looked up or invented.
 */
function completePartialName(
  name: string,
  context: ManagerContext,
  excluded: readonly string[] = [],
): EmployeeResolution {
  const allowed = (candidate: string) =>
    !excluded.some((not) => not.trim().split(/\s+/).length > 1 && samePerson(not, candidate));
  /*
   * "BETA TEST" AFTER "EMPLOYEE TRANSFER BETA TEST" IS TRANSFER BETA TEST. A
   * bare "Transfer Beta Test." reads "Transfer" as the verb, as "Demote
   * Paulyne Co" must. Where the manager's own earlier turn named the full
   * name, and the only extra words are form words, that is who they mean.
   */
  if (/\s/.test(name.trim())) {
    const lower = name.trim().toLowerCase();
    const fuller = new Set<string>();
    for (const message of context.messages) {
      for (const candidate of extractEmployeeNames(message.content)) {
        if (!allowed(candidate) || !candidate.toLowerCase().endsWith(` ${lower}`)) continue;
        const lead = candidate.slice(0, candidate.length - name.trim().length).trim().split(/\s+/);
        if (lead.every((word) => isFormVocabulary(word))) fuller.add(candidate);
      }
    }
    return { kind: "resolved", employeeName: fuller.size === 1 ? [...fuller][0]! : name };
  }
  const first = name.trim().toLowerCase();
  const full: string[] = [];
  for (const message of context.messages) {
    for (const candidate of extractEmployeeNames(message.content)) {
      const parts = candidate.trim().split(/\s+/);
      if (!allowed(candidate) || parts.length < 2 || parts[0]!.toLowerCase() !== first) continue;
      if (!full.some((kept) => kept.toLowerCase() === candidate.toLowerCase())) full.push(candidate);
    }
  }
  if (full.length === 1) return { kind: "resolved", employeeName: full[0]! };
  if (full.length > 1) return { kind: "ambiguous", candidates: full };
  return { kind: "resolved", employeeName: name };
}

/* ------------------------------------------------------------- proposal -- */

export interface ProposalInput {
  proposalId: string;
  templateKey: string;
  templateName: string;
  context: ManagerContext;
  scope: AccessScope | null;
  /**
   * Whether THIS TEMPLATE can be created and edited without leaving chat.
   *
   * Passed in rather than decided here: which templates the inline editor
   * supports is a phase-by-phase product fact, and this module's job is reading
   * a conversation. The caller reads it off the validated library row.
   */
  inlineDraftSupported: boolean;
  /**
   * The single reading this template prints as, when it prints as one.
   *
   * Read off the published version by the caller for the same reason
   * `inlineDraftSupported` is: the database is the authority at runtime, and a
   * seed file is not. Null for a document with no variants.
   */
  variantKey?: string | null;
  /**
   * The business day (`YYYY-MM-DD`), which supplies the year for a date typed
   * as month and day. Defaults to `businessToday()`.
   */
  today?: string;
  /**
   * Whether a date in the conversation is THE FORM'S date. True for every form
   * whose date is the incident's; false for the Resignation/Exit Form, whose
   * Date is the day it is completed and whose conversation is full of other
   * dates — the last day worked, the notice — that must not become it.
   */
  formDateFromConversation?: boolean;
  /**
   * WHO, AS THE CALLER SETTLED IT AGAINST THE EMPLOYEE DIRECTORY — the
   * directory's spelling, or a question when the typed name was only close.
   * Absent: the conversation's own reading, as it always was.
   */
  employee?: EmployeeResolution;
  /** The employee's salons, from the directory, already in the actor's scope. */
  employeeSalonIds?: readonly string[];
}

/**
 * ============================================================================
 * THE JOB TITLE, WHERE THE MANAGER STATED IT AND NOWHERE ELSE
 * ============================================================================
 *
 * Job Title is a `system` field: the server fills it from the record at
 * creation, so a model cannot write it and `enforceResponsibilities` would drop
 * it if it tried. That leaves exactly one honest source — the manager's own
 * words — and this reads them.
 *
 * WHY NOT INFER IT FROM THE TEMPLATE. An SDIT EPP is not proof that the
 * employee's title is "SDIT": managers write one for an ASD on the SDIT track,
 * and the abbreviations vary by district. A title printed on somebody's
 * employment record because a template was chosen is a fabricated fact, and the
 * blank line it replaces is one the manager can fill in a second.
 *
 * THE ABBREVIATIONS ARE UPPER-CASED and the spelled-out titles are title-cased,
 * because that is how they are printed on the form — not because the manager
 * typed them that way.
 */
export const JOB_TITLES: { pattern: RegExp; title: string }[] = [
  /*
   * PLURALS COUNT. "One of my TCs" states the title as plainly as "a TC", and
   * managers say it that way about their own team.
   */
  { pattern: /\b(?:sdits?|salon directors? in training)\b/i, title: "SDIT" },
  { pattern: /\b(?:tsds?|training salon directors?)\b/i, title: "TSD" },
  { pattern: /\b(?:dmits?|district managers? in training)\b/i, title: "DMIT" },
  { pattern: /\b(?:fttcs?|full[- ]time tanning consultants?)\b/i, title: "FTTC" },
  { pattern: /\b(?:asds?|assistant salon directors?)\b/i, title: "ASD" },
  { pattern: /\b(?:tcs?|tanning consultants?)\b/i, title: "Tanning Consultant" },
  { pattern: /\b(?:sds?|salon directors?)\b/i, title: "Salon Director" },
  { pattern: /\b(?:dm|district managers?)\b/i, title: "District Manager" },
];

/**
 * The job title the manager stated, or null.
 *
 * FIRST MATCH IN THIS FILE'S ORDER, which runs from the most specific title to
 * the least: "salon director in training" contains "salon director", and
 * reading it as the latter would print the wrong role on the form. Two
 * different titles in one conversation is not refused the way two employee
 * names are — a manager comparing an SDIT to her Salon Director has still told
 * us what the subject is, and the field is editable — but the ORDER means the
 * most specific one wins rather than whichever came first in the sentence.
 */
export function extractJobTitle(text: string): string | null {
  for (const entry of JOB_TITLES) {
    if (entry.pattern.test(text)) return entry.title;
  }
  return null;
}

/**
 * Assembles the proposal from parts that were each established, not guessed.
 *
 * THE TEMPLATE IS ALREADY VALIDATED by the time this is called — the caller
 * resolves it against the published, active library, so a key this module
 * detected can never reach a proposal unless a real published template answers
 * to it.
 */
export function buildProposal(input: ProposalInput): ChatFormProposal {
  const employee = input.employee ?? resolveEmployee(input.context);
  /*
   * A TEAM-WIDE COACHING FORM. Only where nobody is named, only on a template
   * that allows it, and only on the manager's own words — see `team-subject.ts`.
   */
  const team =
    employee.kind === "missing" &&
    allowsTeamSubject(input.templateKey) &&
    // Per turn: two turns joined ("…for the team" + "coaching form please") are not one phrase.
    input.context.messages.some((message) => readsAsTeamSubject(message.content));
  /*
   * THE MANAGER'S WORDS, THEN THE EMPLOYEE'S SALON, THEN THE ACCOUNT. A salon
   * is used only where their scope proves it; see `proposeLocation`.
   */
  const location = proposeLocation(
    input.scope,
    input.context.text,
    team ? [] : (input.employeeSalonIds ?? []),
  );

  const employeeName = team
    ? TEAM_SUBJECT_LABEL
    : employee.kind === "resolved"
      ? employee.employeeName
      : null;
  const locationId = location.resolution === "resolved" ? location.locationId : null;
  /*
   * `not_applicable` IS AN ANSWER, NOT A GAP. A global actor is not assigned to
   * a salon, and the server already permits a form that names none — so the
   * proposal is ready, and the card says the form will carry no salon. Only
   * `needs_selection` (several to choose between) and `unavailable` (a salon
   * exists and cannot be verified) leave a question outstanding.
   */
  const salonSettled =
    location.resolution === "resolved" || location.resolution === "not_applicable";

  /*
   * ORDER MATTERS: the employee is asked for before the salon. A manager who
   * has not said who the form is about cannot usefully be asked which salon it
   * belongs to, and asking two questions at once gets one answer.
   */
  const status: ChatFormProposal["status"] =
    employeeName === null ? "needs_employee" : salonSettled ? "ready" : "needs_location";

  return {
    proposalId: input.proposalId,
    templateKey: input.templateKey,
    templateName: input.templateName,
    /*
     * READY, AND SUPPORTED. A proposal still missing the employee or the salon
     * offers no create action — not a disabled one, and not one that opens a
     * form with a gap in it. The gap is the reason it is not offered.
     */
    supportsInlineDraft: input.inlineDraftSupported && status === "ready",
    variantKey: input.variantKey ?? null,
    employeeName,
    /*
     * FROM THE MANAGER'S TURNS, like the employee name and through the same
     * bounded window — never from the assistant's, and never from the template.
     */
    employeeRole: team ? null : extractJobTitle(input.context.text),
    /* Same rule: the manager's own words, read as U.S. month/day. */
    formDate:
      input.formDateFromConversation === false
        ? null
        : extractFormDate(input.context.text, input.today ?? businessToday()),
    locationId,
    /*
     * NO DISPLAY NAME. There is no salon roster to resolve one from an id, and
     * `PRODUCTION_SALONS` is the roster rather than a per-record authority — putting a
     * fictional salon name in front of a manager about to file a disciplinary
     * record is exactly the class of thing this phase exists to stop.
     */
    locationName: null,
    locationResolution: location.resolution,
    authorizedLocationIds:
      location.resolution === "needs_selection" ? location.authorizedIds : [],
    /* Present only when it applies, so an ordinary proposal carries no extra key. */
    ...(location.resolution === "needs_selection" && location.outOfScopeName
      ? { namedLocationOutOfScope: location.outOfScopeName }
      : {}),
    status,
    sourceMessageIds: input.context.ids,
    ...(team ? { subject: "team" as const } : {}),
  };
}
