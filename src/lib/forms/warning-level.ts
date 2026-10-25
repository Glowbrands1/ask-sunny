/**
 * The warning level a manager states for the Corrective Action Form being
 * written — read from their own words, never from the model's.
 *
 * ITS OWN MODULE, IMPORTING ONLY THE IMPORT-FREE PAYROLL READER, ON PURPOSE. `template-intent.ts` reads it
 * to tell a request from a remark, and `corrective-action-intake.ts` (which
 * imports `payroll-deduct.ts`, which imports `template-intent.ts`) re-exports
 * it. Living inside the intake, it closed an import cycle that a production
 * build evaluates in a different order from the test runner: `/api/chat` and
 * the forms routes failed with "Cannot access … before initialization"
 * (local production-build check, 22 Oct 2026). Pure and browser-safe.
 */

import { statedPayrollDeduct } from "./payroll-deduct-answer";

/** Lower-cased, with horizontal runs collapsed and newlines kept (the same reading as the intake's). */
function normalize(text: string): string {
  return (text ?? "").toLowerCase().replace(/[^\S\n]+/g, " ");
}

/*
 * ============================================================================
 * "CREATE VERBAL CA FOR …" — THE LEVEL THE MANAGER STATED FOR THIS FORM
 * ============================================================================
 *
 * District Manager feedback, 21 Oct 2026: "create verbal CA for <employee> for
 * violating …" and "… on 10-20-26. verbal. no payroll deduct. …" both named the
 * level, and Ask Sunny still answered "You'll set the verbal/written warning
 * level on the form — I won't guess at it." The level was in the request, in
 * the shorthand managers use for the form itself, and as a sentence of its
 * own — neither of which `WARNING_LEVEL_GIVEN` reads.
 *
 * UNLIKE THE TESTS ABOVE, THIS ONE PUTS A VALUE ON THE FORM, so it is narrow
 * where they are generous. The level the manager stated is ticked on Type of
 * Warning as their statement (see `WARNING_LEVEL_STATED_KEYS`), which makes
 * reading a history as this form's level the mistake that matters:
 *
 *   NAMED             "verbal CA", "written C/A", "verbal corrective action",
 *                     "written warning" — singular, so "verbal CAs before" is
 *                     a pattern of past ones, not this form.
 *   NOT HISTORY       a named level after "had", "gave", "got", "previous",
 *                     "prior" … in the same sentence, or before "before",
 *                     "previously", "last week" …, is a step already taken:
 *                     "she had a written CA in august" states no level here.
 *                     So is one listed under a history heading ("previous
 *                     coaching: jba policy manual 1-1-26, verbal ca 9-1-26").
 *   A BARE LEVEL      only as a sentence of its own — "… 10-20-26. verbal. no
 *                     payroll deduct." or "5. verbal" — never mid-sentence,
 *                     for the reason the intake gives above.
 *   LABELLED          "warning level: written", "type of warning - verbal".
 *
 * Only verbal and written. A final written warning is not an option the form
 * prints, and termination or demotion is never ticked from chat — those are
 * the leadership process's (see `escalation-guard.ts`). Two different levels
 * in one turn are a list, not a decision, and state nothing; a question
 * states nothing either.
 */
export type StatedWarningLevel = "verbal" | "written";

/** The Type of Warning group on the Corrective Action Form. */
export const WARNING_TYPE_KEY = "warning_type";

/** The one key a stated warning level may write — see `applyStatedFacts`. */
export const WARNING_LEVEL_STATED_KEYS: ReadonlySet<string> = new Set([WARNING_TYPE_KEY]);

export function isStatedWarningLevel(value: unknown): value is StatedWarningLevel {
  return value === "verbal" || value === "written";
}

const LEVEL_NAMED = /\b(verbal|written)\s+(?:warning|ca|c\/a|corrective(?:\s+action)?)\b/g;

/** A step already taken, said before the level: "she had a written CA", "prior verbal warning". */
const LEVEL_HISTORY_BEFORE =
  /\b(?:gave|given|issued|received|got|had|has|have|previous(?:ly)?|prior|past|last|earlier|already|final)\s+(?:(?:her|him|them|a|an|the|one|their|his)\s+)?$/;

/** …or after it: "a written warning before", "verbal CA last month". */
const LEVEL_HISTORY_AFTER =
  /^\s*(?:(?:(?:for\s+(?:this|that|it)|on\s+\S+)\s+)?(?:before|previously|already|ago|last\s+(?:week|month|year|time)|in\s+(?:january|february|march|april|may|june|july|august|september|october|november|december))\b|(?:was|were)\s+(?:actually\s+)?(?:(?:given|signed|issued)\s+)?(?:on\s+)?\d)/;

/**
 * …or anywhere after a history heading in the same sentence: "previous
 * coaching: …", "previous CA: …", "prior actions - …" open a list of what
 * already happened. HR, 21 Oct 2026: "create a written CA for … previous
 * coaching: jba policy manual 1-1-26, verbal ca 9-1-26" lists a verbal CA on
 * file; the form being written is the written one requested.
 */
// "last CA: written warning" is a heading too (QA, 22 Oct 2026, round 3).
const LEVEL_HISTORY_HEADING =
  /\b(?:prior|previous|past|earlier|last)\s+(?:actions?|warnings?|discipline|disciplinary(?:\s+actions?)?|corrective\s+actions?|coachings?|cas?|c\/a|steps|history|write[- ]?ups?)\s*[:\-–—]/;

/*
 * "PRIOR COACHING JBA POLICY MANUAL 1-1-26, VERBAL CA 9-1-26" — the same list
 * without the colon (QA, 22 Oct 2026). A level with its own date, after a
 * history label earlier in the sentence, is one more step on file.
 */
const LEVEL_HISTORY_LABEL =
  /\b(?:prior|previous|past|earlier)\s+(?:actions?|warnings?|coachings?|cas?|c\/a|corrective\s+actions?|write[- ]?ups?|discipline)\b/;
const DATED_AFTER = /^\s*(?:on\s+|dated\s+|signed\s+)?\d{1,2}[/.-]\d{1,2}\b/;

/*
 * "SHE HAD COACHING ON THE JBA MANUAL 1/1/26 AND A VERBAL CA 9/1/26" — the same
 * list, said as a sentence (QA, 22 Oct 2026, round 3). A level with its own
 * date, after a verb of something already received, is one more step on file.
 */
const LEVEL_HISTORY_VERB =
  /\b(?:had|got|received|was\s+given|were\s+given|been\s+given|was\s+issued|been\s+issued|coached|counsell?ed)\b/;

/*
 * THE LEVEL, NAMED AS THE THING TO ISSUE. QA, 22 Oct 2026, round 3: "issue a
 * verbal", "put Tess Varga on a written", "I'd like a verbal corrective for …"
 * stated nothing. A verbal or written being issued, given, put on somebody or
 * asked for is this form's level; a written statement, test or note is not. A
 * level on file ("she had a verbal before") has no such verb, and is not read.
 */
/* What may follow a level that is the thing to issue — never "a written statement", "a written copy". */
const LEVEL_FOLLOW = String.raw`(?=\s*(?:$|[.,;:!—–-]|warning|ca\b|c\/a|corrective|write[- ]?up|for\b|on\b|about\b|because|regarding|over\b|this\b|today|please|pls|and\b|since|due|after|then\b|is\s+(?:fine|enough|ok)))`;
const LEVEL_AS_DOCUMENT =
  new RegExp(
  String.raw`\b(?:(?:issue|issuing|give|giving)\s+(?:[a-z'’-]+\s+){0,2}?|(?:put\s+(?:[a-z'’-]+\s+){1,3}?on|start|do|need|needs|want|document|doc|file|log|(?:i|we)'?d\s+like|(?:i|we)\s+would\s+like|write\s+(?:her|him|them)\s+up\s+with)\s+(?:her\s+|him\s+|them\s+)?)(?:an?\s+)?(verbal|written)\b${LEVEL_FOLLOW}|\b(?:just|only)\s+(?:a\s+)?(verbal|written)\b${LEVEL_FOLLOW}`,
  "g",
);

/** A request put as a question, ending right at the level: "can you make a", "could you please write up a". */
const ASKS_FOR_THE_FORM =
  /\b(?:can|could|would|will)\s+(?:you|u)\s+(?:please\s+|pls\s+)?(?:make|do|create|write(?:\s+up)?|draft|start|prepare|put\s+together|get\s+me|give\s+me|fill\s+out|open)\s+(?:me\s+)?(?:a|an)\s+(?:verbal|written)\b/;

/** A request asked as a question — "can we put … on a written …?" — still states the level. */
const POLITE_LEVEL_REQUEST =
  /^\s*(?:hey,?\s+|hi,?\s+|ok,?\s+)?(?:can|could|would|will)\s+(?:you|we|i|u)\s+(?:please\s+|pls\s+)?(?:help\s+(?:me|us)\s+(?:to\s+)?)?(?:put|write|start|create|make|do|issue|give|document|doc|file|draft|open|get)\b/;

/** "actually written", "no, make it verbal" — a correction's lead-in. */
const LEVEL_LEAD_IN = String.raw`(?:(?:actually|no|sorry|oops|wait|ok|okay|rather|i\s+meant|i\s+mean|make\s+that|on\s+second\s+thought|scratch\s+that)[\s,:-]*)*`;

/**
 * "it's a verbal", and the same said about the form itself — "this is a
 * verbal", "this one is a written", "it will be a verbal". HR, 22 Oct 2026:
 * "make corrective action for … this is a verbal. previous coaching …" was
 * answered "You'll set the verbal/written warning level on the form".
 */
// "should've been written", "bump it up to a written", "downgrade to verbal" (QA, 22 Oct 2026, round 3)
const LEVEL_SUBJECT = String.raw`(?:it'?s|make\s+it|just|only|it'?ll\s+be|this'?ll\s+be|(?:it|this)(?:\s+one)?\s+(?:is|will\s+be|should\s+be|needs\s+to\s+be)|(?:it\s+|this\s+)?should(?:'ve|\s+have)\s+been|(?:let'?s\s+)?go\s+with|(?:bump(?:ed)?|move[ds]?|upgrade[ds]?|downgrade[ds]?|drop(?:ped)?|bring|take)\s+(?:it\s+|this\s+|that\s+|her\s+|him\s+|them\s+)?(?:up\s+|down\s+|back\s+)?to)`;

const LEVEL_BARE = new RegExp(
  String.raw`^\s*(?:\d+\s*[.)]?\s*)?${LEVEL_LEAD_IN}(?:(?:${LEVEL_SUBJECT}|make\s+this|(?:change|switch|set|put)\s+(?:it|this)\s+(?:back\s+)?to|switch\s+(?:back\s+)?to|go\s+(?:back\s+)?(?:to|with)|let'?s\s+(?:do|go\s+with)|keep\s+(?:it|this)(?:\s+(?:as|at))?|do)\s+)?(?:a\s+)?(verbal|written)(?:\s+(?:warning|ca|corrective\s+action|one))?(?:[\s,]+(?:instead|then|please|now|after\s+all|again))*\s*$`,
);

const LEVEL_LABELLED =
  /\b(?:type\s+of\s+warning|warning\s*(?:level|type)|level)\s*(?:is|should\s+be|[:=-])\s*(?:a\s+)?(verbal|written)\b/g;

/*
 * A LEVEL AS A CLAUSE OF ITS OWN, RIGHT AFTER THE REQUEST. QA, 22 Oct 2026:
 * "please write tess varga up — verbal — she missed …" stated nothing. A level
 * standing alone between dashes, commas or a colon, straight after the manager
 * asks for the form in the same sentence, is the level of the form asked for.
 * After any other clause it is not read, and words of history earlier in the
 * sentence make it history.
 */
const CLAUSE_LEVEL =
  /^\s*(?:(?:it'?s|it\s+is|make\s+it|just|only)\s+)?(?:a\s+|an\s+)?(verbal|written)(?:\s+(?:warning|corrective\s+action|ca|c\/a|write[- ]?up))?(?:\s+(?:please|pls|plz))?\s*$/;
const REQUEST_CLAUSE =
  /\b(?:writ(?:e|ing)\s+up|writ(?:e|ing)\s+[a-z'’-]+(?:\s+[a-z'’-]+)?\s+up|create|make|start|draft|issue|need|needs|want|give|corrective\s+action\s+for|c\.?a\.?|c\/a|corrective\s+actions?(?:\s+form)?|write[- ]?up\s+for)\b/;
const CLAUSE_HISTORY =
  /\b(?:had|has|have|got|received|given|issued|previous(?:ly)?|prior|past|earlier|already|before|history|record|ago|last|back\s+in|spring|summer|fall|autumn|winter|q[1-4]|review|warnings|write[- ]?ups|coached|coaching)\b/;

function clauseLevelAfterRequest(sentence: string): StatedWarningLevel | null {
  const clauses = sentence.replace(/ - /g, " — ").split(/[,:—–]/);
  for (let i = 1; i < clauses.length; i += 1) {
    const own = CLAUSE_LEVEL.exec(clauses[i]!);
    if (!own) continue;
    const before = clauses.slice(0, i).join(" ");
    if (!REQUEST_CLAUSE.test(before)) continue;
    if (CLAUSE_HISTORY.test(before.replace(new RegExp(REQUEST_CLAUSE.source, "g"), " "))) continue;
    return own[1] as StatedWarningLevel;
  }
  return null;
}

/**
 * "verbal, payroll deduct no." — a bare level in a clause of its own, beside
 * clauses that only answer the payroll question. HR, 21 Oct 2026 (ported from
 * Ask Bubbles 9530112): the comma made the sentence more than a bare level, so
 * the level was asked for again. Every other clause must state a payroll
 * answer; anything else ("verbal, she was late") is not read.
 */
function levelBesidePayrollAnswer(body: string): RegExpExecArray | null {
  const clauses = body.split(",").map((clause) => clause.trim());
  if (clauses.length < 2) return null;
  const levels = clauses.map((clause) => LEVEL_BARE.exec(clause));
  if (levels.filter(Boolean).length !== 1) return null;
  const others = clauses.filter((_, index) => !levels[index]);
  return others.every((clause) => statedPayrollDeduct(clause) !== null) ? levels.find(Boolean)! : null;
}

/** The level one manager turn states for this form, or null. */
export function statedWarningLevel(
  text: string,
  options: { readonly undecidedStatesNothing?: boolean } = {},
): StatedWarningLevel | null {
  const levels = new Set<StatedWarningLevel>();
  // Only `managerStatedWarningLevel` asks for this; it is reached behind WARNING_LEVEL_MANAGER_ONLY_ENABLED.
  const read = options.undecidedStatesNothing ? withoutUndecidedLevels(normalize(text)) : normalize(text);
  // A sentence at a time, so a cue in one sentence says nothing about the next.
  for (const sentence of read.matchAll(/[^.;!?\n]+[.;!?\n]?/g)) {
    const body = sentence[0].replace(/[.;!?\n]$/, "");
    if (sentence[0].endsWith("?") && !POLITE_LEVEL_REQUEST.test(body) && !ASKS_FOR_THE_FORM.test(body)) continue;

    // The level as the whole reply is a few words; a long sentence is never tested, so it stays linear.
    const bare = (body.length <= 80 ? LEVEL_BARE.exec(body) : null) ?? levelBesidePayrollAnswer(body);
    if (bare) levels.add(bare[1] as StatedWarningLevel);
    const clause = clauseLevelAfterRequest(body);
    if (clause) levels.add(clause);

    for (const match of body.matchAll(LEVEL_LABELLED)) levels.add(match[1] as StatedWarningLevel);
    for (const match of body.matchAll(LEVEL_AS_DOCUMENT)) levels.add((match[1] ?? match[2]) as StatedWarningLevel);

    for (const match of body.matchAll(LEVEL_NAMED)) {
      const before = body.slice(0, match.index);
      const after = body.slice(match.index + match[0].length);
      if (
        LEVEL_HISTORY_BEFORE.test(before) ||
        LEVEL_HISTORY_AFTER.test(after) ||
        LEVEL_HISTORY_HEADING.test(before) ||
        ((LEVEL_HISTORY_LABEL.test(before) || LEVEL_HISTORY_VERB.test(before)) && DATED_AFTER.test(after))
      ) {
        continue;
      }
      levels.add(match[1] as StatedWarningLevel);
    }
  }
  return levels.size === 1 ? [...levels][0]! : null;
}

/*
 * "THE VERBAL/WRITTEN WARNING LEVEL" NAMES THE CHOICE, NOT A LEVEL. Live
 * replays, 24 Oct 2026: Ask Sunny's own "You'll set the verbal/written warning
 * level … I won't guess at them" was read as "written warning", and the next
 * reply said "Written Warning, as you said". "verbal or written", "written /
 * verbal", "verbal vs written" are the two options side by side, undecided.
 * Read so by `managerStatedWarningLevel` only, which the intent reading calls
 * behind WARNING_LEVEL_MANAGER_ONLY_ENABLED (this module imports no flags).
 */
const UNDECIDED_LEVELS = /\b(?:verbal|written)\s*(?:\/|\bor\b|\bvs\.?|\bversus\b)\s*(?:verbal|written)\b/g;

function withoutUndecidedLevels(text: string): string {
  return text.replace(UNDECIDED_LEVELS, "either level");
}

/** A whole reply that only says yes. */
const BARE_YES = /^\s*(?:yes|yeah|yep|yup|correct|that'?s\s+(?:right|correct))\s*[.!]*\s*$/i;

/** A yes/no question opens with the verb: "Should this be …?", "Is it …?". */
const YES_NO_OPENING =
  /^\s*(?:so\s+|and\s+|just\s+to\s+confirm,?\s+)?(?:is|isn'?t|are|was|should|shall|do|does|did|will|would|can|could)\b/;

/**
 * The one level an assistant turn asks a single yes/no question about —
 * "Should I tick **Written Warning** on the form?" — or null. Null when the
 * turn asks more than one question (a bare "Yes" could answer either), when
 * the question offers a choice ("verbal or written?", "Yes or No?"), or when
 * it names no level or both.
 */
export function levelAskedYesNo(assistant: string): StatedWarningLevel | null {
  const plain = normalize((assistant ?? "").replace(/[*_`]/g, ""));
  const questions = plain.match(/[^.!?\n]*\?/g) ?? [];
  if (questions.length !== 1) return null;
  const question = questions[0]!;
  if (!YES_NO_OPENING.test(question) || /\bor\b/.test(question)) return null;
  const named = new Set([...question.matchAll(LEVEL_NAMED)].map((match) => match[1] as StatedWarningLevel));
  return named.size === 1 ? [...named][0]! : null;
}

/*
 * ============================================================================
 * THE LEVEL CLAUSE BY CLAUSE — WHAT LEADS, WHAT IS TIED TO THIS CA, WHAT IS PAST
 * ============================================================================
 *
 * QA, 24 Oct 2026 (Ask Bubbles conv_mvmo24rs2rjnl7q; the same turn replayed in
 * Ask Sunny): "verbal, prior = manual ack 9/01, no payroll" states verbal, and
 * "prior verbal on 9-1, this one is written" states written. The sentence
 * reader above reads neither — the first is more than a bare level, and the
 * second holds two — so once the word-presence fallback was gone, both were
 * lost. Read clause by clause:
 *
 *   TIED TO THIS CA   "this one is written", "the CA is written", "it's a
 *                     verbal", "make it verbal" — the current level.
 *   PAST              a clause with prior / previous / had / already /
 *                     coached / "prior =" … is history, and so is every bare
 *                     level listed after it in the same sentence.
 *   LEADING           a bare level as its own clause ("verbal, …") before
 *                     any history is the current level.
 *
 * Only `managerStatedWarningLevel` reads this (WARNING_LEVEL_MANAGER_ONLY_ENABLED).
 */
const CLAUSE_PAST =
  /\b(?:prior|previous(?:ly)?|had|has\s+had|already|coached|counsell?ed|before|earlier|got|received|was\s+given|were\s+given|last\s+(?:one|time|week|month|year))\b|\bprior\s*[=:]/;
const CLAUSE_TIED =
  /\b(?:(?:this|it|that)(?:\s+one)?|the\s+(?:ca|c\/a|form|corrective\s+action|warning)|(?:this\s+)?(?:ca|c\/a))\s+(?:is|will\s+be|should\s+be|needs\s+to\s+be)\s+(?:a\s+|an\s+)?(verbal|written)\b|\b(?:it'?s|this'?s)\s+(?:a\s+)?(verbal|written)\b|\bmake\s+(?:it|this)\s+(?:a\s+)?(verbal|written)\b/;
const CLAUSE_ALONE =
  /^\s*(?:a\s+)?(verbal|written)(?:\s+(?:warning|ca|c\/a|corrective\s+action|write[- ]?up))?\s*$/;

function clauseStatedLevel(text: string): StatedWarningLevel | null {
  const levels = new Set<StatedWarningLevel>();
  for (const sentence of withoutUndecidedLevels(normalize(text)).split(/[.;!?\n]+/)) {
    let pastOpen = false;
    for (const clause of sentence.replace(/ - /g, " — ").split(/[,—–]/)) {
      const tied = CLAUSE_TIED.exec(clause);
      const past = CLAUSE_PAST.test(clause);
      if (tied && !past) {
        levels.add((tied[1] ?? tied[2] ?? tied[3]) as StatedWarningLevel);
        continue;
      }
      if (past) {
        pastOpen = true;
        continue;
      }
      const alone = CLAUSE_ALONE.exec(clause);
      if (alone && !pastOpen) levels.add(alone[1] as StatedWarningLevel);
    }
  }
  return levels.size === 1 ? [...levels][0]! : null;
}

/**
 * Whether a template has a Type of Warning to tick — the Corrective Action
 * Form, published as "dpoa". A level is never carried onto any other form
 * (live, 24 Oct 2026: "Written" rode onto a Resignation/Exit Form and a Policy
 * Review). Read by the WARNING_LEVEL_MANAGER_ONLY_ENABLED paths.
 */
export function templateHasWarningLevel(
  template: { readonly key?: string | null; readonly name?: string | null } | null | undefined,
): boolean {
  if (!template) return false;
  return template.key === "dpoa" || /\bcorrective\s+action\b/i.test(template.name ?? "");
}

export interface WarningLevelTurn {
  readonly role: string;
  readonly content: string;
}

/**
 * The level the MANAGER stated, read from their turns only — the latest that
 * states one winning. Ask Sunny's turns never state a level; they only make a
 * bare "Yes" count, and only when the assistant turn right before it asked one
 * yes/no question about that exact level (see `levelAskedYesNo`). Live
 * replays, 24 Oct 2026: "for Test Employee" and a bare "Yes" (answering the
 * payroll question) were each read as "Written Warning, as you said".
 */
export function managerStatedWarningLevel(turns: readonly WarningLevelTurn[]): StatedWarningLevel | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]!;
    if (turn.role !== "user" || typeof turn.content !== "string") continue;
    const level = clauseStatedLevel(turn.content) ?? statedWarningLevel(turn.content, { undecidedStatesNothing: true });
    if (level) return level;
    const before = turns[index - 1];
    if (BARE_YES.test(turn.content) && before?.role === "assistant") {
      const asked = levelAskedYesNo(before.content);
      if (asked) return asked;
    }
  }
  return null;
}

/**
 * The level the manager's turns state, the latest that states one winning —
 * "verbal" and then "actually written" is written.
 */
export function warningLevelFromTurns(turns: readonly string[]): StatedWarningLevel | null {
  for (const turn of [...turns].reverse()) {
    const level = statedWarningLevel(turn);
    if (level) return level;
  }
  return null;
}

/** The value to store for a stated level: one ticked option where the form offers it, or nothing. */
export function warningLevelChecked(
  level: StatedWarningLevel | null | undefined,
  offered: readonly string[],
): Record<string, string[]> {
  return isStatedWarningLevel(level) && offered.includes(level) ? { [WARNING_TYPE_KEY]: [level] } : {};
}
