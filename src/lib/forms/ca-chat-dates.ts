import { correctedDates, datesInText, listFormDates, priorSteps } from "./form-date-answer";
import { statedPriorActions } from "./prior-actions";
import { isQuestion } from "./employment-change";

/**
 * ============================================================================
 * "THE MEETING WAS ACTUALLY ON 10/19" — A DATE CORRECTED ON AN OPEN CA DRAFT
 * ============================================================================
 *
 * Owner decision, 22 Oct 2026: a manager may correct dates on an editable
 * Corrective Action draft from the chat. A CA carries three kinds of date, and
 * a correction must reach the right one and only that one:
 *
 *   THE FORM'S DATE   the Date line ("change the form date to 10/19").
 *   THE INCIDENT      when it happened: the account in Observation of Offense,
 *                     and the Date line too where the form is dated by it
 *                     ("the meeting was actually on 10/19").
 *   A PRIOR ACTION    a line of the history ("the verbal CA was 9/2, not 9/1").
 *                     A prior step stated after the draft exists ("prior
 *                     coaching: jba policy manual 1-1-26") is added to it.
 *
 * A date with no field to tie it to ("actually it was 10/19", "change the date
 * to 10/19" on a form whose Date line IS the incident's) is a question: the
 * manager is asked which, and nothing is written until they say.
 *
 * Pure: the reading only. `chat-correction.ts` authorises, saves as the
 * manager's own edit, and records the change.
 */

/** Marks Ask Sunny's own "which date?" question, and carries the date asked about. */
export const CA_DATE_QUESTION = "Which date is";

export interface CaFormDates {
  /** The Date line, `YYYY-MM-DD`, or null. */
  readonly formDate: string | null;
  /** Observation of Offense as it stands. */
  readonly observation: string;
  /** The prior-actions list as it stands, one entry per line. */
  readonly priorActions: string;
}

export type CaDateEdit =
  | { readonly kind: "form"; readonly to: string }
  | { readonly kind: "incident"; readonly from: string | null; readonly to: string }
  | { readonly kind: "prior"; readonly value: string; readonly changes: readonly { from: string | null; to: string }[] }
  | { readonly kind: "ask"; readonly to: string };

/* ------------------------------------------------------------ the words -- */

const STEP = /\b(?:coach(?:ing|ed)?|verbal|written|warnings?|c\.?a\.?s?|corrective\s+actions?|write[- ]?ups?|disciplin\w*)\b/i;
const HISTORY = /\b(?:prior|previous(?:ly)?|earlier|past|last\s+(?:time|month|week)|before|already|signed|received|got|had|was\s+given|were\s+given)\b/i;
const CORRECTS =
  /\b(?:actually|instead|wrong|incorrect|correction|i\s+meant|meant\s+to\s+say|should\s+(?:be|have\s+been|say|read)|sorry|oops|typo|my\s+(?:mistake|bad)|not\s+(?:on\s+)?\d|fix|change|update|correct|set)\b/i;
const FORM_DATE =
  /\b(?:form(?:['’]s)?\s+date|date\s+(?:on|of)\s+the\s+form|date\s+line|date\s+the\s+form|form\s+(?:should\s+be\s+|is\s+)?dated|the\s+form\s+date)\b/i;
const INCIDENT =
  /\b(?:incident|it\s+happened|happened|occurred|took\s+place|offen[cs]e|meeting|mtg|shift|seminar|webinar|training|huddle|the\s+day\s+(?:she|he|they)|(?:she|he|they)\s+(?:missed|skipped|was|were|came|left|didn['’]?t|did\s+not|no[- ]?showed))\b/i;
const GENERIC_DATE = /\b(?:change|update|correct|fix|set|make)\b[^.?!]*\bdate\b|\bdate\s+(?:should|is|was|needs)\b|\bwrong\s+date\b/i;
const ADDS = /\b(?:also|too|again|another|as\s+well|plus|and\s+then)\b/i;

/* ------------------------------------------------------------- the dates -- */

function shownUs(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

/** "**10/19/2026**" in Ask Sunny's own question, back to `2026-10-19`. */
function askedDate(content: string): string | null {
  if (!content.includes(CA_DATE_QUESTION)) return null;
  const match = /\*\*(\d{2})\/(\d{2})\/(\d{4})\*\*/.exec(content);
  return match ? `${match[3]}-${match[1]}-${match[2]}` : null;
}

/** The one date a turn gives, not counting a date it retracts ("not 10/20"). */
function targetDate(text: string, today: string): string | null {
  const retracted = new Set(correctedDates(text, today).keys());
  const own = [...new Set(datesInText(text, today).map((found) => found.iso))].filter((iso) => !retracted.has(iso));
  return own.length === 1 ? own[0]! : null;
}

/** The incident date the account gives: the one date it names, else null. */
function accountDate(observation: string, today: string): string | null {
  const dates = [...new Set(listFormDates(observation, today).map((found) => found.iso))];
  return dates.length === 1 ? dates[0]! : null;
}

/* ---------------------------------------------------------- the history -- */

/** The step a history line records: what precedes its first " — ". */
function lineStep(line: string): string {
  return line.split(" — ")[0]!.trim().toLowerCase();
}

function lineDate(line: string, today: string): string | null {
  return datesInText(line, today)[0]?.iso ?? null;
}

/** The step words of a stated line, for matching it to a line already on the form. */
function sameKind(a: string, b: string): boolean {
  const kind = (step: string) =>
    /verbal/.test(step) ? "verbal" : /final/.test(step) ? "final" : /written/.test(step) ? "written" : /coach/.test(step) ? "coaching" : step;
  return kind(a) === kind(b);
}

function readPrior(text: string, today: string, current: string): CaDateEdit | null {
  const lines = current
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !/^none\b/i.test(line));
  const changes: { from: string | null; to: string }[] = [];
  let next = [...lines];

  /* "9/2, not 9/1": the line dated 9/1 is the one corrected. */
  for (const [from, to] of correctedDates(text, today)) {
    const at = next.findIndex((line) => lineDate(line, today) === from);
    if (at < 0) continue;
    next[at] = next[at]!.replace(/signed\s+\d{2}\/\d{2}\/\d{4}/, `signed ${shownUs(to)}`);
    changes.push({ from: lines[at]!, to: next[at]! });
  }

  let restated = false;
  if (changes.length === 0) {
    const stated = statedPriorActions(text, today);
    restated = stated.length > 0;
    const correcting = CORRECTS.test(text) && !ADDS.test(text);
    for (const line of stated) {
      const date = lineDate(line, today);
      if (next.some((existing) => lineDate(existing, today) === date && sameKind(lineStep(existing), lineStep(line)))) continue;
      const same = next.filter((existing) => sameKind(lineStep(existing), lineStep(line)));
      if (correcting && same.length === 1 && date) {
        const at = next.indexOf(same[0]!);
        next[at] = same[0]!.replace(/signed\s+\d{2}\/\d{2}\/\d{4}/, `signed ${shownUs(date)}`);
        changes.push({ from: same[0]!, to: next[at]! });
      } else {
        next.push(line);
        changes.push({ from: null, to: line });
      }
    }
  }
  // Every line stated is already on the form: an edit with nothing to change, answered as such.
  if (changes.length === 0) return restated ? { kind: "prior", value: lines.join("\n"), changes: [] } : null;
  // Oldest first, as the line is kept everywhere else; a line with no date keeps its place at the end.
  next = [
    ...next.filter((line) => lineDate(line, today)).sort((a, b) => lineDate(a, today)!.localeCompare(lineDate(b, today)!)),
    ...next.filter((line) => !lineDate(line, today)),
  ];
  return { kind: "prior", value: next.join("\n"), changes };
}

/* --------------------------------------------------------------- reading -- */

/**
 * The date correction this turn makes to an open Corrective Action draft, or
 * null when it makes none. `lastAssistant` is Ask Sunny's previous turn, read
 * only for its own "which date?" question.
 */
export function readCaDateEdit(input: {
  readonly text: string;
  readonly today: string;
  readonly form: CaFormDates;
  readonly lastAssistant?: string;
}): CaDateEdit | null {
  const text = (input.text ?? "").trim();
  if (text === "" || isQuestion(text)) return null;
  const { today, form } = input;

  /* THE ANSWER TO "WHICH DATE?" — the date was carried in the question. */
  const pending = askedDate(input.lastAssistant ?? "");
  if (pending) {
    if (/\b(?:both|incident|it\s+happened|meeting|observation|account|when\s+it\s+happened)\b/i.test(text)) {
      return { kind: "incident", from: accountDate(form.observation, today) ?? form.formDate, to: pending };
    }
    if (/\b(?:form|date\s+line|just\s+the\s+date|only\s+the\s+date|top)\b/i.test(text)) return { kind: "form", to: pending };
  }

  /* A PRIOR ACTION — named, with a history cue or a date of its own. */
  if (STEP.test(text) && (HISTORY.test(text) || priorSteps(text, today).length > 0 || correctedDates(text, today).size > 0)) {
    return readPrior(text, today, form.priorActions);
  }

  const to = targetDate(text, today);
  if (!to) return null;
  if (FORM_DATE.test(text)) return { kind: "form", to };

  const retracted = [...correctedDates(text, today).keys()][0] ?? null;
  if (INCIDENT.test(text) && (CORRECTS.test(text) || /\b(?:was|happened|occurred)\s+(?:actually\s+)?on\b/i.test(text)) && !ADDS.test(text)) {
    return { kind: "incident", from: retracted ?? accountDate(form.observation, today) ?? form.formDate, to };
  }

  /*
   * "CHANGE THE DATE TO 10/19", "actually it was 10/19": no field named. Where
   * the Date line is the incident's own date, which one is meant is a
   * question; where it is not, "the date" is the Date line.
   */
  if (GENERIC_DATE.test(text) || (CORRECTS.test(text) && !ADDS.test(text) && /^\W*(?:actually|sorry|oops|no|wait|correction)\b/i.test(text))) {
    const incident = accountDate(form.observation, today);
    if (incident && incident === form.formDate && to !== incident) return { kind: "ask", to };
    if (GENERIC_DATE.test(text)) return { kind: "form", to };
    return { kind: "ask", to };
  }
  return null;
}

/** The question asked when the date's field is not clear. */
export function caDateQuestion(to: string, form: CaFormDates): string {
  const date = shownUs(to);
  const current = form.formDate ? shownUs(form.formDate) : null;
  return `${CA_DATE_QUESTION} **${date}**: when it happened (the account and the form's Date line${current ? `, now ${current}` : ""}), only the form's Date line, or a prior action's date? Tell me which and I'll change just that.`;
}

/* --------------------------------------------------------- rewriting text -- */

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** `iso` written the way `raw` was written: "October 20, 2026", "10/20/26", "Oct 20", "10-20-2026". */
function writtenLike(raw: string, iso: string): string {
  const [y, m, d] = iso.split("-") as [string, string, string];
  const month = Number(m);
  const day = Number(d);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return iso;
  const named = /^([A-Za-z]+)\.?\s+\d/.exec(raw);
  if (named) {
    const full = MONTH_NAMES[month - 1]!;
    const name = named[1]!.length > 3 ? full : full.slice(0, 3);
    const year = /\d{4}\s*$/.test(raw) ? `, ${y}` : "";
    return `${name} ${day}${year}`;
  }
  const separator = raw.includes("-") ? "-" : "/";
  const parts = raw.split(separator);
  const pad = (value: number, like: string | undefined) => (like && like.length === 2 ? String(value).padStart(2, "0") : String(value));
  const yearPart = parts[2] === undefined ? "" : `${separator}${parts[2].length === 2 ? y.slice(2) : y}`;
  return `${pad(month, parts[0])}${separator}${pad(day, parts[1])}${yearPart}`;
}

/**
 * The text with every date that reads as `from` rewritten as `to`, each in the
 * shape it was written in. Returns the text unchanged when none does.
 */
export function rewriteDate(text: string, from: string, to: string, today: string): { text: string; replaced: number } {
  let out = "";
  let at = 0;
  let replaced = 0;
  for (const found of datesInText(text, today)) {
    if (found.iso !== from) continue;
    out += text.slice(at, found.index) + writtenLike(text.slice(found.index, found.end), to);
    at = found.end;
    replaced += 1;
  }
  return { text: out + text.slice(at), replaced };
}
