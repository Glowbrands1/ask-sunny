import { shiftDays, weekdayOf } from "@/lib/business-date";
import { exitEffectiveDateEnabled, exitIntakeFixEnabled } from "@/lib/config/chat-quality-flags";

import {
  EXIT_DATE_FIELDS,
  EXIT_NOTICE_GROUP,
  EXIT_OPTION,
  EXIT_TYPE_GROUP,
} from "./exit-library";
import { datesInText } from "./form-date-answer";
import { mostRecent } from "./late-open";

/**
 * ============================================================================
 * WHAT THE MANAGER SAID ABOUT A DEPARTURE — READ BY CODE, NOT BY THE MODEL
 * ============================================================================
 *
 * The Resignation/Exit Form's facts are dates and ticks: the last day worked,
 * when notice was given, when it was fulfilled, and how the person left. Every
 * one of them has payroll consequences, and a language model asked to fill a
 * date it was not given produces a plausible one. So they are read here,
 * deterministically, from the MANAGER'S OWN WORDS — the same bounded manager
 * turns the proposal reads — and the drafting route overrides whatever the
 * model returned for those keys with what this module found. Pure and
 * browser-safe; nothing here knows who is asking.
 *
 * THE RULE IS "CLEAR OR NOTHING". A date is assigned to a line only when the
 * words beside it say which line ("her last day was 9/15", "gave her two weeks
 * notice on Sept 1"). A date with no such cue is not guessed into one. Two
 * different dates claiming the same line, a bare weekday ("Friday") in a
 * role position, or two separation types that contradict each other are
 * reported as AMBIGUITIES and left blank, so the manager is asked instead of
 * handed a guess.
 *
 * WHAT IS NEVER DERIVED, whatever the manager says:
 *
 *   The yes/no questions — returned items, the salon key, payroll deduction,
 *   bonus forfeiture, minimum wage, written notice, rehire. They are `manager`
 *   fields and no MODEL draft writes them; the ones the manager answered in
 *   so many words are read by `exit-details.ts`, not here.
 *
 *   "Immediate involuntary separation" FROM ANYTHING SHORT OF A COMPLETED ACT.
 *   It is a fact about what already happened, so it is ticked only when the
 *   manager's words say an employer-initiated separation HAS happened — "Jane
 *   was terminated today", "we fired Jane yesterday", "Jane was let go on
 *   Friday". Intent is not the act: "should we terminate Jane?", "we may fire
 *   Jane", "termination paperwork for Jane" and a question about the
 *   termination policy tick nothing. See `completedInvoluntary`. The MODEL can
 *   never tick it — `SENSITIVE_ACTION_OPTION_KEYS` refuses the key from its
 *   output — so the only path to the box is this reader.
 *
 *   The notice-fulfilled date from a duration. "Two weeks notice on 9/1" does
 *   not make 9/15 the fulfilled date; that is arithmetic about a fact nobody
 *   stated.
 *
 * ONE DATE IS CARRIED ACROSS, because managers asked for it (20 Oct 2026): a
 * notice fulfilled on a stated date ends on that date, so with no last day of
 * its own the Last Day Worked is the fulfilled date. Only a STATED fulfilled
 * date, never one computed, and never for a notice said not to be fulfilled.
 */

/**
 * `resigned` is HR's Details line (revision 2), not a line of the Word form:
 * the date the employee quit or resigned. It is read by the same cues-or-
 * nothing rule, and it is a `manager` field — see `exit-details.ts` — so it is
 * never among the keys `exitFactValues` hands the drafting route.
 */
export type ExitDateRole = "lastDayWorked" | "noticeGiven" | "noticeFulfilled" | "resigned";

type FormDateRole = Exclude<ExitDateRole, "resigned">;

export type ExitAmbiguity =
  /** Two different dates were given for the same line. */
  | { kind: "date_conflict"; role: ExitDateRole; dates: string[] }
  /** A weekday with no way to tell which week ("her last day was Friday"). */
  | { kind: "weekday"; role: ExitDateRole; phrase: string }
  /** The separation described two ways that cannot both be true. */
  | { kind: "separation_conflict"; described: string[] };

export interface ExitFacts {
  lastDayWorked: string | null;
  noticeGiven: string | null;
  noticeFulfilled: string | null;
  /**
   * The Resignation Date: a date the manager tied to quitting ("quit on
   * 9/20", "no call no show on 9/20", "her resignation date is 9/1"), or else
   * the date notice was given — handing in notice IS resigning. Two different
   * dates between them are an ambiguity, and it stays blank.
   */
  resignationDate: string | null;
  /** Option keys for the `resignation_notice` group. */
  noticeOptions: string[];
  /**
   * Option keys for the `resignation_type` group. The involuntary one only for
   * a separation the manager stated as already done.
   */
  typeOptions: string[];
  ambiguities: ExitAmbiguity[];
}

/** Every key this module is the author of on the exit form. */
export const EXIT_DERIVED_KEYS: ReadonlySet<string> = new Set([
  EXIT_DATE_FIELDS.lastDayWorked,
  EXIT_DATE_FIELDS.noticeGiven,
  EXIT_DATE_FIELDS.noticeFulfilled,
  EXIT_NOTICE_GROUP,
  EXIT_TYPE_GROUP,
]);

const ROLE_FIELD: Record<FormDateRole, string> = {
  lastDayWorked: EXIT_DATE_FIELDS.lastDayWorked,
  noticeGiven: EXIT_DATE_FIELDS.noticeGiven,
  noticeFulfilled: EXIT_DATE_FIELDS.noticeFulfilled,
};

/** How each line is written back to the manager. The form's own labels. */
export const EXIT_ROLE_LABEL: Record<ExitDateRole, string> = {
  lastDayWorked: "Last Day Worked",
  noticeGiven: "Date that notice was given",
  noticeFulfilled: "Date that notice was fulfilled",
  resigned: "Resignation Date",
};

/* ------------------------------------------------------------ the words -- */

/** Curly apostrophes are how phones type "didn't". */
function normalize(text: string): string {
  return (text ?? "").replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"');
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY = WEEKDAYS.join("|");

/** A negation close enough before a verb to reverse it. */
const NEGATED_BEFORE =
  /\b(?:did ?n[o']?t|didn't|does ?n[o']?t|never|failed to|refused to|won't|will not|wasn't|was not|weren't|were not|isn't|is not|not)\s+(?:\w+\s+){0,2}$/;

/** What a notice period is called. Fulfilling or skipping one reads these. */
const NOTICE_ONLY = String.raw`(?:notice|two[- ]weeks?'?(?: notice)?|2[- ]weeks?'?(?: notice)?|two[- ]week notice|14[- ]day(?: notice)?|30[- ]day(?: notice)?)`;
/** And what GIVING notice may be called, which includes handing in a resignation. */
const NOTICE_NOUN = String.raw`(?:${NOTICE_ONLY}|resignation)`;

/**
 * THE CUES THAT SAY WHICH LINE A DATE BELONGS TO, read in the words BEFORE it.
 *
 * Each is a phrase that names the line; none is a bare verb that merely
 * accompanies a date. "She quit on 9/20" is not a last day worked — people quit
 * by text on days they are not scheduled — and so it assigns nothing.
 */
const BEFORE_CUES: { role: ExitDateRole; pattern: RegExp }[] = [
  {
    role: "noticeFulfilled",
    pattern: new RegExp(
      String.raw`\b(?:fulfilled|completed|finished|served|worked out)\b[^.;!?\n]{0,30}?\b${NOTICE_ONLY}|\b(?:notice|two weeks)\s+(?:was\s+|were\s+|is\s+)?(?:fulfilled|completed|finished|served|up|ended|ends)\b`,
      "g",
    ),
  },
  {
    role: "noticeGiven",
    pattern: new RegExp(
      String.raw`\b(?:gave|give|gives|giving|given|provided|provides|providing|put in|puts in|putting in|submitted|submits|turned in|handed in|sent)\b[^.;!?\n]{0,30}?\b${NOTICE_NOUN}|\bnotice\s+(?:was\s+)?(?:given|submitted|received|dated)\b|\bresigned\b|\bresignation\s+(?:letter\s+)?(?:was\s+)?(?:dated|received|submitted|on)\b`,
      "g",
    ),
  },
  {
    role: "lastDayWorked",
    pattern:
      /\b(?:last|final)\s+(?:day|shift|date)(?:\s+(?:worked|of work|of employment|on the schedule))?\b|\blast\s+worked\b|\bworked\s+(?:through|thru|until|till)\b/g,
  },
];

/**
 * THE RESIGNATION DATE'S CUE, read alongside the three above. A date is the
 * resignation date only when a quitting word is the NEAREST cue before it, so
 * "her last day was 9/15" stays a last day and "quit on 9/20" is not one.
 */
const RESIGNED_CUE: { role: ExitDateRole; pattern: RegExp } = {
  role: "resigned",
  pattern:
    /\b(?:quit|quits|walked (?:out|off)|no[\s-]*call[\s,/&-]*(?:and\s+)?no[\s-]*show(?:ed|s)?|ncns|resignation date|date (?:she|he|they) (?:quit|resigned))\b/g,
};

/**
 * The same lines, named in the words AFTER a date — "9/15 was her last day".
 * Anchored to the date so a cue belonging to the NEXT clause is never borrowed.
 */
const AFTER_CUES: { role: ExitDateRole; pattern: RegExp }[] = [
  {
    role: "lastDayWorked",
    pattern:
      /^\s*(?:was|is|will be|as|being)\s+(?:her|his|their|the|my|our)\s+(?:last|final)\s+(?:day|shift)\b/,
  },
  {
    role: "noticeGiven",
    pattern: /^\s*(?:is|was)\s+when\s+(?:she|he|they)\s+(?:gave|put in|submitted|turned in)\b/,
  },
  /*
   * THE DATE FIRST, THEN WHO HANDED IT IN — "On 9-15-26, she provided her
   * resignation to management", "on 9/15 delphine gave her two weeks". The
   * subject is a pronoun or the employee's name (one or two words, whatever
   * its case), never the employer: "on 9/1 we gave her notice" is somebody
   * else's act and assigns nothing.
   */
  {
    role: "noticeGiven",
    pattern: new RegExp(
      String.raw`^\s*,?\s*(?!(?:we|i|management|the manager|my manager|the company)\b)(?:she|he|they|[a-z][a-z'-]*(?:\s+[a-z][a-z'-]*)?)\s+(?:provided|gave|submitted|sent|turned in|handed in|put in)\s+(?:in\s+)?(?:her|his|their|a|an|the)?\s*(?:written\s+)?${NOTICE_NOUN}`,
    ),
  },
];

/** "Texted me on 9/20 that she quit", "9/20 is when he resigned". */
const RESIGNED_AFTER: { role: ExitDateRole; pattern: RegExp } = {
  role: "resigned",
  pattern:
    /^\s*(?:,\s*)?(?:that|when|and said|saying|to say)\s+(?:she|he|they)\s+(?:was\s+|were\s+|is\s+|had\s+)?(?:quit|quitting|resigned|resigning|done|walking out|not coming back)\b|^\s*(?:is|was)\s+when\s+(?:she|he|they)\s+(?:quit|resigned|walked out)\b/,
};

/* ---------------------------------------------------------- the dates -- */

/*
 * ============================================================================
 * "LAST DAY 10-24" IS A DATE (EXIT_INTAKE_FIX_ENABLED)
 * ============================================================================
 *
 * Sibling app's live QA, 25 Oct 2026: "she resigned, last day 10-24" left Last Day Worked
 * blank, while "10-17-26" filled it. The shared date reader needs a year on a
 * dashed date, because "10-12" alone is more often a range ("10-12 hours").
 * On the exit form a date is only ever placed on a line by the words beside
 * it ("last day", "gave notice"), so a yearless dashed month-day is read
 * here as the most recent such day on or before today — the rule the
 * late-opening reader uses (`late-open.ts`). A range ("10-12 hours") is not
 * a date, and a date with no cue still fills nothing.
 */
const YEARLESS_DASHED = /(?<![\d/.-])(\d{1,2})-(\d{1,2})(?![\d/-]|\.\d)/g;
const RANGE_AFTER = /^\s*(?:min|mins|minutes|hrs?|hours?|days?|weeks?|months?|years?|people|times|x\b|%|am\b|pm\b|dollars?)/i;

/*
 * ============================================================================
 * "SHE DID NOT CALL IN FOR HER LAST TWO SHIFTS" IS A NO CALL NO SHOW
 * ============================================================================
 *
 * Sibling app's live QA (25 Oct 2026): the manager described the no call no show in words
 * and the box stayed unticked. Not calling in (or not calling or showing) for
 * a shift is what the box means. Only with EXIT_INTAKE_FIX_ENABLED; "called
 * in sick for her shift" is not this, and neither is a shift she did call
 * about. Read by `exit-details.ts` too, for How Employee Resigned.
 */
/*
 * "GAVE NOTICE 9/25/26 – FULFILLED 10/9/26" (the sibling app's live QA, 25 Oct 2026): the
 * fulfilled date follows a bare "fulfilled", the notice named once before it
 * in the same sentence. Only with EXIT_INTAKE_FIX_ENABLED.
 */
const BARE_FULFILLED: { role: ExitDateRole; pattern: RegExp } = {
  role: "noticeFulfilled",
  pattern: /\b(?:fulfilled|completed|served|worked out)(?:\s+(?:on|by|thru|through))?\s*[:\-–—]?\s*$/g,
};

export const NO_CALL_FOR_SHIFT =
  /\b(?:did ?n[o']?t|didn't|never|failed to)\s+(?:call(?:\s+in)?(?:\s+or\s+show(?:\s+up)?)?|show(?:\s+up)?\s+or\s+call(?:\s+in)?)\b[^.;!?\n]{0,40}?\bshifts?\b/;

interface DateToken {
  /** Null for a weekday that names no particular week. */
  iso: string | null;
  phrase: string;
  index: number;
  end: number;
}

/**
 * Dates in the text, the calendar ones AND the relative ones managers say
 * about a departure: today, yesterday, tomorrow, "last Friday", "next Monday".
 *
 * RELATIVE TO THE BUSINESS DAY, never the host's clock, so "yesterday" is the
 * same day to the proposal and to the draft. A bare weekday — "Friday", "this
 * Friday", "on Friday" — is kept as a token with no date: it tells us a date
 * was meant and not which, which is exactly what the manager should be asked.
 */
function dateTokens(text: string, today: string): DateToken[] {
  const tokens: DateToken[] = datesInText(text, today).map((found) => ({
    iso: found.iso,
    phrase: text.slice(found.index, found.end),
    index: found.index,
    end: found.end,
  }));

  const add = (pattern: RegExp, resolve: (match: RegExpMatchArray) => string | null) => {
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      const end = index + match[0].length;
      if (tokens.some((token) => index < token.end && end > token.index)) continue;
      tokens.push({ iso: resolve(match), phrase: match[0], index, end });
    }
  };

  // "today", "today's" and the "todays date" managers actually type.
  add(/\btoday(?:'?s)?(?:\s+date)?\b/gi, () => today);
  add(/\byesterday\b/gi, () => shiftDays(today, -1));
  add(/\btomorrow\b/gi, () => shiftDays(today, 1));
  add(new RegExp(String.raw`\b(?:last|this past|past)\s+(${WEEKDAY})\b`, "gi"), (match) => {
    const target = WEEKDAYS.indexOf(match[1]!.toLowerCase());
    const back = ((weekdayOf(today) - target + 7) % 7) || 7;
    return shiftDays(today, -back);
  });
  add(new RegExp(String.raw`\bnext\s+(${WEEKDAY})\b`, "gi"), (match) => {
    const target = WEEKDAYS.indexOf(match[1]!.toLowerCase());
    const ahead = ((target - weekdayOf(today) + 7) % 7) || 7;
    return shiftDays(today, ahead);
  });
  add(new RegExp(String.raw`\b(?:this\s+|on\s+)?(?:${WEEKDAY})\b`, "gi"), () => null);
  if (exitIntakeFixEnabled()) {
    for (const match of text.matchAll(YEARLESS_DASHED)) {
      const index = match.index ?? 0;
      const end = index + match[0].length;
      if (tokens.some((token) => index < token.end && end > token.index)) continue;
      if (RANGE_AFTER.test(text.slice(end, end + 12))) continue;
      const iso = mostRecent(Number(match[1]), Number(match[2]), today);
      if (iso) tokens.push({ iso, phrase: match[0], index, end });
    }
  }

  /*
   * "FRIDAY, SEPTEMBER 12" IS ONE DATE. A weekday written beside a calendar
   * date is that date's label, not a second, unplaceable one — so the two
   * become a single token that starts where the weekday does, and the cue in
   * front of the weekday is the date's cue.
   */
  const sorted = tokens.sort((left, right) => left.index - right.index);
  const merged: DateToken[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const token = sorted[i]!;
    const next = sorted[i + 1];
    if (
      token.iso === null &&
      next?.iso &&
      /^[\s,]*(?:the\s+)?$/.test(text.slice(token.end, next.index))
    ) {
      merged.push({ ...next, index: token.index, phrase: text.slice(token.index, next.end) });
      i += 1;
      continue;
    }
    merged.push(token);
  }
  return merged;
}

/** The latest-ending cue in `window`, which is the one nearest the date. */
function nearestCue(
  window: string,
  cues: readonly { role: ExitDateRole; pattern: RegExp }[],
): ExitDateRole | null {
  let best: { role: ExitDateRole; end: number } | null = null;
  for (const cue of cues) {
    cue.pattern.lastIndex = 0;
    for (const match of window.matchAll(cue.pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      // "didn't fulfill her notice on 9/14" names no fulfilled date.
      if (
        (cue.role === "noticeFulfilled" || cue.role === "resigned") &&
        NEGATED_BEFORE.test(window.slice(0, start))
      ) {
        continue;
      }
      if (!best || end >= best.end) best = { role: cue.role, end };
    }
  }
  return best?.role ?? null;
}

const CLAUSE_END = /[.!?;\n]/;

function roleFor(
  text: string,
  tokens: DateToken[],
  position: number,
  cues: readonly { role: ExitDateRole; pattern: RegExp }[] = BEFORE_CUES,
  afterCues: readonly { role: ExitDateRole; pattern: RegExp }[] = AFTER_CUES,
): ExitDateRole | null {
  const token = tokens[position]!;
  const previousEnd = position > 0 ? tokens[position - 1]!.end : 0;
  const nextStart = position + 1 < tokens.length ? tokens[position + 1]!.index : text.length;

  // BEFORE: back to the previous date or the start of the sentence, and no
  // further than a clause's length — a cue three sentences up is not this one's.
  let before = text.slice(Math.max(previousEnd, token.index - 80), token.index);
  const sentence = [...before].reverse().findIndex((char) => CLAUSE_END.test(char));
  if (sentence >= 0) before = before.slice(before.length - sentence);
  const fromBefore = nearestCue(before.toLowerCase(), cues);
  if (fromBefore) return fromBefore;
  // EXIT_INTAKE_FIX_ENABLED: "gave notice 9/25/26 – fulfilled 10/9/26".
  if (exitIntakeFixEnabled() && nearestCue(before.toLowerCase(), [BARE_FULFILLED])) {
    const sentenceStart = Math.max(...[".", "!", "?", ";", "\n"].map((mark) => text.lastIndexOf(mark, token.index - 1)));
    if (/\bnotice\b/i.test(text.slice(sentenceStart + 1, token.index))) return "noticeFulfilled";
  }

  // AFTER: only an anchored phrase, only up to the next date.
  const after = text.slice(token.end, nextStart).toLowerCase();
  for (const cue of afterCues) {
    if (cue.pattern.test(after)) return cue.role;
  }
  return null;
}

/* ------------------------------------------------- the separation type -- */

interface SeparationReading {
  fulfilled: boolean;
  notFulfilled: boolean;
  voluntary: boolean;
  noCallNoShow: boolean;
  involuntary: boolean;
}

/** True when a match of `pattern` in `text` is not negated just before it. */
function affirmed(text: string, pattern: RegExp): boolean {
  for (const match of text.matchAll(pattern)) {
    if (!NEGATED_BEFORE.test(text.slice(0, match.index ?? 0))) return true;
  }
  return false;
}

/**
 * ============================================================================
 * AN EMPLOYER-INITIATED SEPARATION THAT HAS ALREADY HAPPENED
 * ============================================================================
 *
 * Only a COMPLETED act, in the manager's own words, counts:
 *
 *   passive   "Jane was terminated today", "he got fired", "she has been let
 *             go", "they were dismissed", "was involuntarily separated"
 *   active    "we fired Jane yesterday", "I terminated him", "we let her go",
 *             "we had to let Jane Smith go"
 *
 * WHAT DOES NOT COUNT, and each is the reason this is not a keyword match:
 *
 *   the NOUN   "termination paperwork", "termination form", "the termination
 *              policy" — naming the form, or the process, is not the act.
 *   intent     "should we terminate Jane?", "we may fire Jane", "we're going
 *              to let her go", "if we fire her" — the base verb never matches,
 *              and a past form under a modal ("might have been fired") or a
 *              conditional ("if she was fired") is refused by `HYPOTHETICAL`.
 *   questions  any sentence that ends in "?", whatever it contains.
 *   negation   "she wasn't fired", "we did not let her go".
 */
const COMPLETED_INVOLUNTARY = [
  /\b(?:was|were|has been|have been|had been|got|been)\s+(?:\w+\s+)?(?:terminated|fired|let go|dismissed|discharged|involuntarily separated)\b/g,
  /\b(?:we|i|management|leadership|hr|the company|the dm|my dm|our dm|they)\s+(?:\w+\s+)?(?:terminated|fired|dismissed|discharged)\b/g,
  /\b(?:we|i|management|leadership|hr|the company|the dm|my dm|our dm|they)\s+(?:had to\s+)?let\s+(?:\S+\s+){1,2}?go\b/g,
];

/** A modal, conditional or plan before the act, in the same clause. */
const HYPOTHETICAL =
  /\b(?:may|might|could|would|should|must|will|shall|can|going to|gonna|plan(?:ning)? to|want(?:s|ed)? to|need(?:s)? to|thinking (?:about|of)|considering|about to|if|whether|unless|once)\b[^.;!?\n]{0,30}$/;

function completedInvoluntary(q: string): boolean {
  for (const pattern of COMPLETED_INVOLUNTARY) {
    for (const match of q.matchAll(pattern)) {
      const start = match.index ?? 0;
      const clauseStart = Math.max(
        ...[".", "!", "?", ";", "\n"].map((mark) => q.lastIndexOf(mark, start - 1)),
      );
      const before = q.slice(clauseStart + 1, start);
      const endMatch = /[.!?\n]/.exec(q.slice(start));
      const sentenceEnd = endMatch ? q[start + endMatch.index] : "";
      if (sentenceEnd === "?") continue;
      if (NEGATED_BEFORE.test(q.slice(0, start)) || /\b(?:not|never|n't)\b/.test(match[0])) continue;
      if (HYPOTHETICAL.test(before)) continue;
      // "Employees who were terminated…" is a rule about people, not this departure.
      if (/\b(?:who|that|which|anyone|anybody|someone|employees|people)\s*$/.test(before)) continue;
      return true;
    }
  }
  return false;
}

function readSeparation(text: string): SeparationReading {
  const q = text.toLowerCase();

  const noCallNoShow =
    /\bno[\s-]*call[\s,/&-]*(?:and\s+)?no[\s-]*show(?:s|ed)?\b|\bncns\b/.test(q) ||
    (exitIntakeFixEnabled() && NO_CALL_FOR_SHIFT.test(q));

  const notFulfilled =
    new RegExp(
      String.raw`\b(?:did ?n[o']?t|didn't|never|failed to|refused to|wouldn't|would not|won't|will not)\s+(?:\w+\s+){0,2}?(?:fulfill|finish|complete|serve|work(?:\s+out)?)\b[^.;!?\n]{0,25}?\b${NOTICE_ONLY}`,
    ).test(q) ||
    new RegExp(String.raw`\bleft before\s+(?:her|his|their|the)\s+${NOTICE_ONLY}`).test(q) ||
    /\bcut\s+(?:her|his|their)\s+notice\s+short\b/.test(q) ||
    /\bnotice\s+(?:was\s+|is\s+)?(?:not|never)\s+(?:fulfilled|completed|served|finished)\b/.test(q) ||
    /\bdid not fulfill required\b/.test(q);

  /*
   * PLAIN "WORKED" NEEDS AN OWNER. "Worked her two weeks" is a notice served;
   * "only worked 2 weeks before quitting" is a tenure, and ticking Submitted &
   * Fulfilled Notice for it would say the opposite of what happened.
   */
  const fulfilled =
    affirmed(
      q,
      new RegExp(
        String.raw`\b(?:fulfilled|completed|finished|served|worked out)\s+(?:her|his|their|the|a|an)?\s*(?:full\s+|entire\s+|whole\s+)?${NOTICE_ONLY}`,
        "g",
      ),
    ) ||
    affirmed(
      q,
      new RegExp(
        String.raw`\bworked\s+(?:out\s+)?(?:her|his|their|the|a|an)\s+(?:full\s+|entire\s+|whole\s+)?${NOTICE_ONLY}`,
        "g",
      ),
    ) ||
    /*
     * NO OWNER, BUT THE WORD "NOTICE" — "gave and worked 2 week notice". A
     * bare duration is still a tenure ("only worked 2 weeks"); it is the word
     * notice that makes it the notice period.
     */
    affirmed(
      q,
      /\bworked\s+(?:out\s+)?(?:(?:two|2)[- ]weeks?'?|(?:14|30)[- ]days?)\s+notice\b/g,
    ) ||
    /\bsubmitted\s*(?:&|and)\s*fulfilled\s+notice\b/.test(q) ||
    affirmed(q, /\bnotice\s+(?:was\s+)?(?:fulfilled|completed|served)\b/g);

  const voluntary =
    /\b(?:quit|quits|resigned|resigns|left)\b[^.;!?\n]{0,30}?\b(?:immediately|on the spot|effective immediately|without (?:any |giving |a |her |his |their )?(?:notice|two weeks)|with no notice|same day|mid[- ]shift)\b/.test(
      q,
    ) ||
    affirmed(q, /\bwalked\s+(?:out|off)\b/g) ||
    /\bimmediate\s+(?:voluntary\s+)?resignation\b/.test(q) ||
    /\bquit\s+on the spot\b/.test(q);

  const involuntary = completedInvoluntary(q);

  return { fulfilled, notFulfilled, voluntary, noCallNoShow, involuntary };
}

/* ------------------------------------------------------------- reading -- */

/**
 * Everything the manager's words establish about a departure.
 *
 * `today` is the business day (`YYYY-MM-DD`). It supplies the year for "9/15"
 * and the anchor for "yesterday" and "last Friday".
 */
/** "effective october 2", "effective on 10/2", "effective as of 10/2". */
const EFFECTIVE_BEFORE = /\beffective(?:\s+(?:on|as\s+of|date(?:\s+(?:is|was|of))?))?\s*[:\-]?\s*$/i;
/** The departure the date is effective for: "exit for …", "resigned …", "her termination …". */
const DEPARTURE_CUE = /\b(?:exit\w*|resign\w*|quit\w*|terminat\w*|fired|separat\w*|leav(?:e|es|ing)|last day)\b/gi;
/** Something else the date could be effective for, between the departure and "effective". */
const OTHER_SUBJECT = /\b(?:transfer\w*|mov(?:e|ed|es|ing)|promot\w*|policy|code|schedule|raise|pay|rate|change\w*)\b/i;
/** "not effective", "never effective", "do not make it effective". */
const EFFECTIVE_NEGATED = /\b(?:not|never|no longer|don't|isn't|wasn't|won't|can't|cannot)\b(?:\s+\S+){0,3}\s*$/i;
/** "effective october 2 was cancelled, she stayed". */
const EFFECTIVE_UNDONE =
  /\b(?:cancel\w*|rescind\w*|withdr[ae]wn?|withdraws?|withdrawing|revoked|stayed|is staying|no longer|changed (?:her|his|their) mind|scratch that|never ?mind|wrong)\b/i;

/**
 * EXIT_EFFECTIVE_DATE_ENABLED: is the date at `index` the day a departure is
 * effective? Within its sentence, "effective" sits right before it, a
 * departure word comes before that with nothing else in between that the date
 * could belong to, and nothing negates or undoes it (QA-6, 26 Oct 2026).
 */
function departureEffectiveOn(text: string, index: number, end: number): boolean {
  const start = Math.max(text.lastIndexOf(".", index - 1), text.lastIndexOf(";", index - 1), text.lastIndexOf("\n", index - 1), text.lastIndexOf("!", index - 1), text.lastIndexOf("?", index - 1)) + 1;
  const prefix = text.slice(start, index);
  const cue = EFFECTIVE_BEFORE.exec(prefix);
  if (!cue) return false;
  const before = prefix.slice(0, cue.index);
  if (EFFECTIVE_NEGATED.test(before)) return false;
  if (EFFECTIVE_UNDONE.test(before)) return false;
  const stop = text.slice(end).search(/[.;!?\n]/);
  const after = stop === -1 ? text.slice(end) : text.slice(end, end + stop);
  if (EFFECTIVE_UNDONE.test(after)) return false;
  // "Exit form for <name>. Effective 11/1.": a sentence that opens with "effective" belongs to the one before it.
  const said = before.trim() === "" ? previousSentence(text, start) : before;
  const departures = [...said.matchAll(DEPARTURE_CUE)];
  const departure = departures[departures.length - 1];
  if (!departure) return false;
  return !OTHER_SUBJECT.test(said.slice((departure.index ?? 0) + departure[0].length)) && !EFFECTIVE_UNDONE.test(said);
}

/** How many "effective …" phrases name a date, readable or not: never "effective immediately", nor a negated one. */
function effectivePhrases(text: string): number {
  let count = 0;
  for (const match of text.matchAll(/\beffective\b/gi)) {
    const at = match.index ?? 0;
    if (/^\s+immediately\b/i.test(text.slice(at + match[0].length))) continue;
    if (EFFECTIVE_NEGATED.test(text.slice(Math.max(0, at - 40), at))) continue;
    count += 1;
  }
  return count;
}

/** The sentence ending just before `start` (the start of the current one). */
function previousSentence(text: string, start: number): string {
  const head = text.slice(0, start).replace(/[\s.;!?]+$/, "");
  const from = Math.max(...[".", ";", "!", "?", "\n"].map((mark) => head.lastIndexOf(mark))) + 1;
  return head.slice(from);
}

export function readExitFacts(rawText: string, today: string): ExitFacts {
  const text = normalize(rawText);
  const ambiguities: ExitAmbiguity[] = [];

  const tokens = dateTokens(text, today);
  const byRole: Record<ExitDateRole, { dates: Set<string>; weekday: string | null }> = {
    lastDayWorked: { dates: new Set(), weekday: null },
    noticeGiven: { dates: new Set(), weekday: null },
    noticeFulfilled: { dates: new Set(), weekday: null },
    resigned: { dates: new Set(), weekday: null },
  };
  const place = (role: ExitDateRole | null, token: DateToken) => {
    if (!role) return;
    if (token.iso) byRole[role].dates.add(token.iso);
    else byRole[role].weekday ??= token.phrase;
  };
  tokens.forEach((token, position) => {
    place(roleFor(text, tokens, position), token);
    /*
     * A SEPARATE PASS, so adding the quitting cue changes nothing about the
     * three lines above: "her last day was when she quit on 9/15" is still a
     * last day, and is ALSO the day she quit.
     */
    const resigned = roleFor(text, tokens, position, [...BEFORE_CUES, RESIGNED_CUE], [
      ...AFTER_CUES,
      RESIGNED_AFTER,
    ]);
    if (resigned === "resigned") place(resigned, token);
  });

  const settle = (role: ExitDateRole): string | null => {
    const { dates, weekday } = byRole[role];
    if (weekday && dates.size === 0) {
      ambiguities.push({ kind: "weekday", role, phrase: weekday });
      return null;
    }
    if (dates.size > 1 || (weekday && dates.size > 0)) {
      ambiguities.push({ kind: "date_conflict", role, dates: [...dates].sort() });
      return null;
    }
    return dates.size === 1 ? [...dates][0]! : null;
  };

  let lastDayWorked = settle("lastDayWorked");
  /*
   * EXIT_EFFECTIVE_DATE_ENABLED (QA, 26 Oct 2026, conv_mvon64pk28tpb3k): "exit
   * for <name> effective october 2" filled nothing. On an exit form the date
   * a departure is effective is the last day of employment, so it fills Last
   * Day Worked when no last day was stated. "effective immediately" names no
   * date, and two effective dates are not guessed between.
   */
  if (exitEffectiveDateEnabled() && !lastDayWorked && !ambiguities.some((entry) => "role" in entry && entry.role === "lastDayWorked")) {
    const read = tokens.filter((token) => token.iso && departureEffectiveOn(text, token.index, token.end));
    /*
     * QA-6 / QA-4, 26 Oct 2026: "effective october 2 or 11/1" names two
     * dates, not the first one; and when a second "effective …" phrase has a
     * date that could not be read ("effective 2 october and effective 11/8"),
     * the one that could is not picked. Two readable dates are asked about.
     */
    const alternatives = tokens.filter(
      (token) =>
        token.iso &&
        read.some((first) => first.end <= token.index && /^\s*,?\s*(?:or|and|,)\s*$/i.test(text.slice(first.end, token.index))),
    );
    const effective = [...new Set([...read, ...alternatives].map((token) => token.iso!))].sort();
    if (effective.length === 1 && effectivePhrases(text) <= 1) lastDayWorked = effective[0]!;
    else if (effective.length > 1) ambiguities.push({ kind: "date_conflict", role: "lastDayWorked", dates: effective });
  }
  const noticeGiven = settle("noticeGiven");
  const noticeFulfilled = settle("noticeFulfilled");
  const quitDate = settle("resigned");
  /*
   * HANDING IN NOTICE IS RESIGNING, so the notice date stands in for a
   * resignation date nobody stated separately. Two different ones — "gave
   * notice 9/1, then quit 9/10" — are the manager's to settle.
   */
  let resignationDate = quitDate ?? noticeGiven;
  if (quitDate && noticeGiven && quitDate !== noticeGiven) {
    ambiguities.push({ kind: "date_conflict", role: "resigned", dates: [noticeGiven, quitDate].sort() });
    resignationDate = null;
  }

  /*
   * THE SEPARATION, WITH ITS CONTRADICTIONS REFUSED. A notice both worked and
   * not worked, a notice worked by somebody who quit on the spot, or a
   * resignation that was also a firing, is not something to pick a side of on
   * a payroll document. Each conflicting pair is dropped and reported; what is
   * not in conflict is kept.
   */
  const reading = readSeparation(text);
  let { fulfilled, notFulfilled, voluntary } = reading;
  const conflict = (described: string[]) =>
    ambiguities.push({ kind: "separation_conflict", described });

  if (fulfilled && notFulfilled) {
    conflict(["Submitted & Fulfilled Notice", "Did not fulfill required 14 day / 30 day notice"]);
    fulfilled = false;
    notFulfilled = false;
  }
  if (fulfilled && voluntary) {
    conflict(["Submitted & Fulfilled Notice", "Immediate Voluntary Resignation"]);
    fulfilled = false;
    voluntary = false;
  }
  /*
   * A RESIGNATION THAT WAS ALSO A FIRING is not a box to pick: all three of the
   * conflicting ticks are dropped and the manager is asked which it was.
   */
  let involuntary = reading.involuntary;
  if (involuntary && (fulfilled || voluntary)) {
    conflict([
      fulfilled ? "Submitted & Fulfilled Notice" : "Immediate Voluntary Resignation",
      "Immediate involuntary separation",
    ]);
    fulfilled = false;
    voluntary = false;
    involuntary = false;
  }

  /*
   * THE FULFILLED DATE IS THE LAST DAY WORKED when no last day was given and
   * the notice was not said to be cut short. A last day stated two ways is
   * still an ambiguity, and stays blank.
   */
  const lastDayUnclear = ambiguities.some((entry) => entry.kind !== "separation_conflict" && entry.role === "lastDayWorked");
  const separationUnclear = ambiguities.some((entry) => entry.kind === "separation_conflict");
  if (
    !lastDayWorked &&
    !lastDayUnclear &&
    noticeFulfilled &&
    !separationUnclear &&
    !reading.notFulfilled &&
    !reading.noCallNoShow &&
    !involuntary
  ) {
    lastDayWorked = noticeFulfilled;
  }

  return {
    lastDayWorked,
    noticeGiven,
    noticeFulfilled,
    resignationDate,
    noticeOptions: fulfilled ? [EXIT_OPTION.submittedFulfilledNotice] : [],
    typeOptions: [
      ...(voluntary ? [EXIT_OPTION.immediateVoluntary] : []),
      ...(involuntary ? [EXIT_OPTION.immediateInvoluntary] : []),
      ...(notFulfilled ? [EXIT_OPTION.noticeNotFulfilled] : []),
      ...(reading.noCallNoShow ? [EXIT_OPTION.noCallNoShow] : []),
    ],
    ambiguities,
  };
}

/**
 * The facts as form values, keyed the way the stored version keys them.
 *
 * ONLY WHAT WAS ESTABLISHED. An unknown date is absent rather than empty, and
 * a group with nothing ticked is absent — `enforceResponsibilities` and the
 * write both treat absence as "leave the field as it is", which on a fresh
 * draft is visibly blank.
 */
export function exitFactValues(facts: ExitFacts): {
  values: Record<string, string>;
  checked: Record<string, string[]>;
} {
  const values: Record<string, string> = {};
  for (const role of Object.keys(ROLE_FIELD) as FormDateRole[]) {
    const iso = facts[role];
    if (iso) values[ROLE_FIELD[role]] = iso;
  }
  const checked: Record<string, string[]> = {};
  if (facts.noticeOptions.length > 0) checked[EXIT_NOTICE_GROUP] = facts.noticeOptions;
  if (facts.typeOptions.length > 0) checked[EXIT_TYPE_GROUP] = facts.typeOptions;
  return { values, checked };
}

/** Whether the manager's words established anything at all about the departure. */
export function exitFactsSupplied(facts: ExitFacts): boolean {
  return (
    facts.lastDayWorked !== null ||
    facts.noticeGiven !== null ||
    facts.noticeFulfilled !== null ||
    facts.resignationDate !== null ||
    facts.noticeOptions.length > 0 ||
    facts.typeOptions.length > 0 ||
    facts.ambiguities.length > 0
  );
}
