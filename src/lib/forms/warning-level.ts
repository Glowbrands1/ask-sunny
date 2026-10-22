/**
 * The warning level a manager states for the Corrective Action Form being
 * written — read from their own words, never from the model's.
 *
 * ITS OWN MODULE, WITH NO IMPORTS, ON PURPOSE. `template-intent.ts` reads it
 * to tell a request from a remark, and `corrective-action-intake.ts` (which
 * imports `payroll-deduct.ts`, which imports `template-intent.ts`) re-exports
 * it. Living inside the intake, it closed an import cycle that a production
 * build evaluates in a different order from the test runner: `/api/chat` and
 * the forms routes failed with "Cannot access … before initialization"
 * (local production-build check, 22 Oct 2026). Pure and browser-safe.
 */

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
  /^\s*(?:(?:for\s+(?:this|that|it)|on\s+\S+)\s+)?(?:before|previously|already|ago|last\s+(?:week|month|year|time)|in\s+(?:january|february|march|april|may|june|july|august|september|october|november|december))\b/;

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
  String.raw`\b(?:(?:issue|issuing|give|giving)\s+(?:[a-z'’-]+\s+){0,2}?|(?:put\s+(?:[a-z'’-]+\s+){1,3}?on|start|do|need|needs|want|document|doc|file|log|(?:i|we)'?d\s+like|(?:i|we)\s+would\s+like|write\s+(?:her|him|them)\s+up\s+with)\s+(?:her\s+|him\s+|them\s+)?)an?\s+(verbal|written)\b${LEVEL_FOLLOW}|\b(?:just|only)\s+(?:a\s+)?(verbal|written)\b${LEVEL_FOLLOW}`,
  "g",
);

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
  String.raw`^\s*(?:\d+\s*[.)]?\s*)?${LEVEL_LEAD_IN}(?:${LEVEL_SUBJECT}\s+)?(?:a\s+)?(verbal|written)(?:\s+warning)?\s*$`,
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

/** The level one manager turn states for this form, or null. */
export function statedWarningLevel(text: string): StatedWarningLevel | null {
  const levels = new Set<StatedWarningLevel>();
  // A sentence at a time, so a cue in one sentence says nothing about the next.
  for (const sentence of normalize(text).matchAll(/[^.;!?\n]+[.;!?\n]?/g)) {
    const body = sentence[0].replace(/[.;!?\n]$/, "");
    if (sentence[0].endsWith("?") && !POLITE_LEVEL_REQUEST.test(body)) continue;

    const bare = LEVEL_BARE.exec(body);
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
