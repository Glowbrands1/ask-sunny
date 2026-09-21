import "server-only";

import { isFormVocabulary } from "./template-intent";
import { boundManagerTurns, type BoundedContext } from "./bounded-context";
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

const NOT_A_NAME = new Set([
  "a", "an", "the", "my", "our", "this", "that", "them", "him", "her", "it",
  "me", "us", "someone", "somebody", "everyone", "everybody", "today",
  "tomorrow", "yesterday", "monday", "tuesday", "wednesday", "thursday",
  "friday", "saturday", "sunday",
  /*
   * THE SUBJECT PRONOUNS. They could not reach a candidate before: a full name
   * needs two capitalised parts and the preposed pattern needs "for"/"about",
   * so a sentence-initial "She" matched nothing. `NAMED_ROLE` below reads
   * "<Name> is an SDIT", and "She is an SDIT" is that shape exactly — so the
   * pronouns have to be named here or the employee on a performance plan
   * becomes "She".
   */
  "she", "he", "they", "we", "you",
  /*
   * THE TWO LONE CAPITALS THAT ARE NEVER A SURNAME INITIAL. A trailing initial
   * is now accepted — see `INITIAL` — and "Sarah I saw her today" would
   * otherwise yield an employee called "Sarah I". "A" is already above and
   * does the same job for "Sarah A lot of things happened".
   */
  "i",
]);

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
 */
export function extractEmployeeNames(text: string): string[] {
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

  const FULL = new RegExp(`\\b(${NAME}(?:\\s+${PART})+)`, "g");
  for (const match of text.matchAll(FULL)) {
    const candidate = match[1]!.trim();
    if (places.has(candidate)) continue;
    if (!candidate.split(/\s+/).some(notAName)) {
      found.push(candidate);
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
   * THE WHOLE MESSAGE, which is what a manager types when Sunny has just asked
   * who the form is for — "Paulyne C" on its own, initial included. The
   * trailing full stop is stripped first so "Paulyne C." is the same answer.
   */
  const whole = text.trim().replace(/[.?!]+$/, "");
  if (
    new RegExp(`^${NAME}(?:\\s+${PART})?$`).test(whole) &&
    !whole.split(/\s+/).some(notAName)
  ) {
    found.push(whole);
  }

  /*
   * ONE SPELLING PER PERSON, BEFORE ANYTHING IS COUNTED.
   *
   * "Paulyne C." matches both the sentence pattern and the whole-message one,
   * with and without the full stop, and the de-duplication below compares a
   * bare first name against a full one — it would have let those through as
   * TWO candidates and asked the manager which of the two Paulynes they meant.
   * Dropping the stop off a trailing initial makes them the same string.
   */
  const spellings = found.map((name) => name.replace(/\s([A-Za-z])\.$/, " $1"));

  // De-duplicated, and a bare first name that is part of a full name already
  // found is the same person rather than a second candidate.
  const unique: string[] = [];
  for (const name of spellings) {
    if (unique.some((kept) => kept === name)) continue;
    if (unique.some((kept) => kept.split(/\s+/)[0] === name || name.split(/\s+/)[0] === kept)) {
      // Keep the longer form: "Sarah Jones" over "Sarah".
      const index = unique.findIndex(
        (kept) => kept.split(/\s+/)[0] === name.split(/\s+/)[0],
      );
      if (index >= 0 && name.length > unique[index]!.length) unique[index] = name;
      continue;
    }
    unique.push(name);
  }
  return unique;
}

/**
 * Who the form is about, read from MANAGER turns only, most recent first.
 *
 * There is no employee directory in Ask Sunny and none is invented here: the
 * value is the manager's own words, and `form_instances.employee_name` has
 * always been free text.
 */
export function resolveEmployee(context: ManagerContext): EmployeeResolution {
  for (const message of [...context.messages].reverse()) {
    const names = extractEmployeeNames(message.content);
    if (names.length === 1) return { kind: "resolved", employeeName: names[0]! };
    if (names.length > 1) return { kind: "ambiguous", candidates: names };
  }
  return { kind: "missing" };
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
const JOB_TITLES: { pattern: RegExp; title: string }[] = [
  { pattern: /\b(?:sdit|salon director in training)\b/i, title: "SDIT" },
  { pattern: /\b(?:tsd|training salon director)\b/i, title: "TSD" },
  { pattern: /\b(?:dmit|district manager in training)\b/i, title: "DMIT" },
  { pattern: /\b(?:fttc|full[- ]time tanning consultant)\b/i, title: "FTTC" },
  { pattern: /\b(?:asd|assistant salon director)\b/i, title: "ASD" },
  { pattern: /\b(?:tc|tanning consultant)\b/i, title: "Tanning Consultant" },
  { pattern: /\b(?:sd|salon director)\b/i, title: "Salon Director" },
  { pattern: /\b(?:dm|district manager)\b/i, title: "District Manager" },
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
  const employee = resolveEmployee(input.context);
  const location = proposeLocation(input.scope);

  const employeeName = employee.kind === "resolved" ? employee.employeeName : null;
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
    employeeRole: extractJobTitle(input.context.text),
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
    status,
    sourceMessageIds: input.context.ids,
  };
}
