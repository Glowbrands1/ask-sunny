import { shiftDays, weekdayOf } from "@/lib/business-date";

import {
  EXIT_DATE_FIELDS,
  EXIT_NOTICE_GROUP,
  EXIT_OPTION,
  EXIT_TYPE_GROUP,
} from "./exit-library";
import { datesInText } from "./form-date-answer";

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
 *   The six yes/no questions — returned items, payroll deduction, bonus
 *   forfeiture, minimum wage, written notice, rehire. They are `manager` fields
 *   and no draft writes them.
 *
 *   "Immediate involuntary separation". A described firing is REPORTED
 *   (`involuntaryDescribed`) so Ask Sunny can say it left the box for the
 *   manager, and it is never ticked: the approved process routes a termination
 *   through leadership, and the leadership-authority guard refuses the key from
 *   any draft (`SENSITIVE_ACTION_OPTION_KEYS`).
 *
 *   The notice-fulfilled date from a duration. "Two weeks notice on 9/1" does
 *   not make 9/15 the fulfilled date; that is arithmetic about a fact nobody
 *   stated.
 */

export type ExitDateRole = "lastDayWorked" | "noticeGiven" | "noticeFulfilled";

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
  /** Option keys for the `resignation_notice` group. */
  noticeOptions: string[];
  /** Option keys for the `resignation_type` group. Never the involuntary one. */
  typeOptions: string[];
  /** The manager described being let go / fired. Reported, never ticked. */
  involuntaryDescribed: boolean;
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

const ROLE_FIELD: Record<ExitDateRole, string> = {
  lastDayWorked: EXIT_DATE_FIELDS.lastDayWorked,
  noticeGiven: EXIT_DATE_FIELDS.noticeGiven,
  noticeFulfilled: EXIT_DATE_FIELDS.noticeFulfilled,
};

/** How each line is written back to the manager. The form's own labels. */
export const EXIT_ROLE_LABEL: Record<ExitDateRole, string> = {
  lastDayWorked: "Last Day Worked",
  noticeGiven: "Date that notice was given",
  noticeFulfilled: "Date that notice was fulfilled",
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
      String.raw`\b(?:gave|give|gives|giving|given|put in|puts in|putting in|submitted|submits|turned in|handed in|sent)\b[^.;!?\n]{0,30}?\b${NOTICE_NOUN}|\bnotice\s+(?:was\s+)?(?:given|submitted|received|dated)\b|\bresigned\b|\bresignation\s+(?:letter\s+)?(?:was\s+)?(?:dated|received|submitted|on)\b`,
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
];

/* ---------------------------------------------------------- the dates -- */

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

  add(/\btoday\b/gi, () => today);
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
function nearestCue(window: string): ExitDateRole | null {
  let best: { role: ExitDateRole; end: number } | null = null;
  for (const cue of BEFORE_CUES) {
    cue.pattern.lastIndex = 0;
    for (const match of window.matchAll(cue.pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      // "didn't fulfill her notice on 9/14" names no fulfilled date.
      if (cue.role === "noticeFulfilled" && NEGATED_BEFORE.test(window.slice(0, start))) continue;
      if (!best || end >= best.end) best = { role: cue.role, end };
    }
  }
  return best?.role ?? null;
}

const CLAUSE_END = /[.!?;\n]/;

function roleFor(text: string, tokens: DateToken[], position: number): ExitDateRole | null {
  const token = tokens[position]!;
  const previousEnd = position > 0 ? tokens[position - 1]!.end : 0;
  const nextStart = position + 1 < tokens.length ? tokens[position + 1]!.index : text.length;

  // BEFORE: back to the previous date or the start of the sentence, and no
  // further than a clause's length — a cue three sentences up is not this one's.
  let before = text.slice(Math.max(previousEnd, token.index - 80), token.index);
  const sentence = [...before].reverse().findIndex((char) => CLAUSE_END.test(char));
  if (sentence >= 0) before = before.slice(before.length - sentence);
  const fromBefore = nearestCue(before.toLowerCase());
  if (fromBefore) return fromBefore;

  // AFTER: only an anchored phrase, only up to the next date.
  const after = text.slice(token.end, nextStart).toLowerCase();
  for (const cue of AFTER_CUES) {
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

function readSeparation(text: string): SeparationReading {
  const q = text.toLowerCase();

  const noCallNoShow = /\bno[\s-]*call[\s,/&-]*(?:and\s+)?no[\s-]*show(?:s|ed)?\b|\bncns\b/.test(q);

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
        String.raw`\b(?:fulfilled|completed|finished|served|worked out)\s+(?:her|his|their|the)?\s*(?:full\s+|entire\s+|whole\s+)?${NOTICE_ONLY}`,
        "g",
      ),
    ) ||
    affirmed(
      q,
      new RegExp(
        String.raw`\bworked\s+(?:out\s+)?(?:her|his|their|the)\s+(?:full\s+|entire\s+|whole\s+)?${NOTICE_ONLY}`,
        "g",
      ),
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

  const involuntary = affirmed(
    q,
    /\b(?:fired|terminated|let (?:her|him|them) go|(?:was|were|been|being|got) let go|dismissed|discharged|involuntar(?:y|ily))\b/g,
  );

  return { fulfilled, notFulfilled, voluntary, noCallNoShow, involuntary };
}

/* ------------------------------------------------------------- reading -- */

/**
 * Everything the manager's words establish about a departure.
 *
 * `today` is the business day (`YYYY-MM-DD`). It supplies the year for "9/15"
 * and the anchor for "yesterday" and "last Friday".
 */
export function readExitFacts(rawText: string, today: string): ExitFacts {
  const text = normalize(rawText);
  const ambiguities: ExitAmbiguity[] = [];

  const tokens = dateTokens(text, today);
  const byRole: Record<ExitDateRole, { dates: Set<string>; weekday: string | null }> = {
    lastDayWorked: { dates: new Set(), weekday: null },
    noticeGiven: { dates: new Set(), weekday: null },
    noticeFulfilled: { dates: new Set(), weekday: null },
  };
  tokens.forEach((token, position) => {
    const role = roleFor(text, tokens, position);
    if (!role) return;
    if (token.iso) byRole[role].dates.add(token.iso);
    else byRole[role].weekday ??= token.phrase;
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

  const lastDayWorked = settle("lastDayWorked");
  const noticeGiven = settle("noticeGiven");
  const noticeFulfilled = settle("noticeFulfilled");

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
  if (reading.involuntary && (fulfilled || voluntary)) {
    conflict([
      fulfilled ? "Submitted & Fulfilled Notice" : "Immediate Voluntary Resignation",
      "Immediate involuntary separation",
    ]);
    fulfilled = false;
    voluntary = false;
  }

  return {
    lastDayWorked,
    noticeGiven,
    noticeFulfilled,
    noticeOptions: fulfilled ? [EXIT_OPTION.submittedFulfilledNotice] : [],
    typeOptions: [
      ...(voluntary ? [EXIT_OPTION.immediateVoluntary] : []),
      ...(notFulfilled ? [EXIT_OPTION.noticeNotFulfilled] : []),
      ...(reading.noCallNoShow ? [EXIT_OPTION.noCallNoShow] : []),
    ],
    involuntaryDescribed: reading.involuntary,
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
  for (const role of Object.keys(ROLE_FIELD) as ExitDateRole[]) {
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
    facts.noticeOptions.length > 0 ||
    facts.typeOptions.length > 0 ||
    facts.involuntaryDescribed ||
    facts.ambiguities.length > 0
  );
}
