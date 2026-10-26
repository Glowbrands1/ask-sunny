import { isAppLine, withoutAppLines } from "@/lib/ai/app-sentences";
import { dateAnswerAppliedEnabled, dateAnswerKeepsOpenEnabled, keepFormEmployeeEnabled, priorSentenceFixEnabled } from "@/lib/config/chat-quality-flags";

/** DATE_ANSWER_KEEPS_OPEN_ENABLED, on top of the live DATE_ANSWER_APPLIED_ENABLED. */
const keepsOpen = () => dateAnswerAppliedEnabled() && dateAnswerKeepsOpenEnabled();

import {
  explicitFormDate,
  formDateChange,
  heldCoachingDates,
  listFormDates,
  listIncidentDates,
  statedIncidentDates,
  yearlessWrittenOut,
} from "./form-date-answer";
import { incidentOnly, incidentOnlyOn } from "./form-date-incident-only";
import { priorSentenceFixFor } from "./prior-sentence-scope";
import { correctsTheEmployee } from "./proposal";

/**
 * ============================================================================
 * SEVERAL INCIDENT DATES ARE A QUESTION, NOT "WHICHEVER CAME FIRST"
 * ============================================================================
 *
 * Ask Bubbles admin feedback, 16 Oct 2026 (ported from 9c02dcb; QA, 22 Oct
 * 2026, found Ask Sunny doing the same): "She was late on 10/5 and 10/15"
 * dated the Corrective Action 10/5 — the FIRST date in the message, which for
 * a repeated behaviour is the earlier incident, not the one the document is
 * written about.
 * `extractFormDate` takes the first date that is not a follow-up or an earlier
 * step, which is right when there is one and arbitrary when there are two.
 *
 * Three different dates can be on a conversation, and they are not the same
 * thing:
 *
 *   INCIDENT DATES   when it happened — every one belongs in the description.
 *   EARLIER STEPS    "verbally coached on 9/1" — history, never the form's date
 *                    (already excluded by `form-date-answer.ts`).
 *   THE FORM'S DATE  the form's Date line. One date, chosen on purpose: the
 *                    manager's choice, or — until they choose — the day the
 *                    form is created (today), never a guess among incidents.
 *
 * With ONE incident date the form is dated by it, as before. With several, the
 * manager is asked once which date goes on the form; the incidents stay in the
 * written description either way. Pure.
 */

export const DATE_QUESTION_TAG = "Which date goes on the form?";

type Turn = { readonly role: string; readonly content: string };

/**
 * The distinct incident dates in the manager's words, oldest first, none in
 * the future. A date the manager gave the FORM ("dated 10/20") is not one of
 * them — it answers the question this module would otherwise ask.
 */
export function incidentDates(text: string, today: string, coaching = false): string[] {
  const explicit = explicitFormDate(text, today);
  // PRIOR_SENTENCE_FIX_ENABLED: yearless "10-5 and 10-15" are two incident dates too, a range is one
  // (`statedIncidentDates`). Not on a Coaching Form, whose date is the coaching held.
  const read = priorSentenceFixFor(text) && !coaching ? statedIncidentDates(text, today) : listIncidentDates(text, today);
  return [...new Set(incidentOnly(text, today, read).map((found) => found.iso))]
    .filter((iso) => iso <= today && iso !== explicit)
    .sort();
}

function shown(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${Number(month)}/${Number(day)}`;
}

export function dateQuestion(dates: readonly string[]): string {
  const latest = dates[dates.length - 1]!;
  return `You mentioned more than one date (${dates.map((iso) => `**${shown(iso)}**`).join(", ")}). ${DATE_QUESTION_TAG} Say "most recent" (${shown(latest)}), pick one, or say "today" for the day you create it. Every date stays in the description of what happened — this only sets the form's Date, and until you choose it is dated today.`;
}

export function askedForDate(content: string): boolean {
  return typeof content === "string" && content.includes(DATE_QUESTION_TAG);
}

export function dateAlreadyAsked(history: readonly Turn[]): boolean {
  return history.some((turn) => turn.role === "assistant" && askedForDate(turn.content));
}

/** What a reply to the date question chose: a calendar date, or "today". */
export type DateChoice = { kind: "date"; iso: string } | { kind: "today" };

export function readDateChoice(reply: string, dates: readonly string[], today: string): DateChoice | null {
  const text = (reply ?? "").toLowerCase();
  if (/\?\s*$/.test(text.trim())) return null;
  /*
   * A DATE OF THE INCIDENT, not any date: "she was coached 1-1-26 on the jba
   * manual", typed after the question, is history and answered nothing (QA, 22
   * Oct 2026, round 3 — the form was dated 1/1).
   */
  const typed = listFormDates(reply, today).filter((found) => found.iso <= today);
  // DATE_ANSWER_KEEPS_OPEN_ENABLED: "10/5 and 10/15" repeats the dates; it does not pick one.
  if (keepsOpen() && new Set(typed.map((found) => found.iso)).size > 1) return null;
  if (typed.length > 0) return { kind: "date", iso: typed[typed.length - 1]!.iso };
  // DATE_ANSWER_APPLIED_ENABLED: "10-15", "the 15th" pick the date asked about with that day.
  const picked = dateAnswerAppliedEnabled() ? askedDayIn(text, dates) : null;
  if (picked) return { kind: "date", iso: picked };
  if (/\b(?:most recent|latest|newest|last (?:one|date)|second)\b/.test(text)) {
    return { kind: "date", iso: dates[dates.length - 1]! };
  }
  if (/\b(?:first|earliest|oldest)\b/.test(text)) return { kind: "date", iso: dates[0]! };
  if (/\b(?:today|the day (?:i|we) (?:create|file|write)|creation)\b/.test(text)) return { kind: "today" };
  return null;
}

/*
 * DATE_ANSWER_APPLIED_ENABLED (QA, 26 Oct 2026): a reply that is only a day —
 * "10-15", "10.15", "the 15th", "15th" — names the date asked about with that
 * month and day, or that day when only one of them has it. Live, "the 15th"
 * read as nothing and the form was dated today.
 */
const MONTH_DAY_REPLY = /^\s*(?:on\s+)?(?:the\s+)?(\d{1,2})[-./](\d{1,2})(?:[-./]\d{2,4})?\s*[.!]*\s*$/;
const DAY_REPLY = /^\s*(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)(?:\s+one)?\s*[.!]*\s*$/;

function askedDayIn(text: string, dates: readonly string[]): string | null {
  const monthDay = MONTH_DAY_REPLY.exec(text);
  if (monthDay) {
    const [month, day] = [Number(monthDay[1]), Number(monthDay[2])];
    return dates.find((iso) => Number(iso.slice(5, 7)) === month && Number(iso.slice(8, 10)) === day) ?? null;
  }
  const day = DAY_REPLY.exec(text);
  if (!day) return null;
  const same = dates.filter((iso) => Number(iso.slice(8, 10)) === Number(day[1]));
  return same.length === 1 ? same[0]! : null;
}

/** DATE_ANSWER_APPLIED_ENABLED: a short reply that only answers the date question. */
function bareDateAnswer(reply: string, dates: readonly string[], today: string): DateChoice | null {
  if (!keepsOpen()) {
    if (String(reply).trim().split(/\s+/).length > 4) return null;
    return readDateChoice(reply, dates, today);
  }
  // DATE_ANSWER_KEEPS_OPEN_ENABLED: the manager's line only: the app adds its own lines around it ("10-15\nNo payroll deduction. Warning level: verbal.").
  for (const line of String(reply).split("\n")) {
    const own = line.trim();
    if (own === "" || isAppLine(own) || own.split(/\s+/).length > 4) continue;
    const choice = readDateChoice(own, dates, today);
    if (choice) return choice;
  }
  return null;
}

/** DATE_ANSWER_APPLIED_ENABLED: the date question is open — asked earlier, and no reply since has answered it. */
function dateQuestionOpen(turns: readonly Turn[], dates: readonly string[], today: string): boolean {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]!;
    if (turn.role === "assistant" && askedForDate(turn.content)) return true;
    if (turn.role === "user" && bareDateAnswer(turn.content, dates, today)) return false;
  }
  return false;
}

/** The manager's answer to an earlier date question, over the whole conversation. */
export function dateAnsweredIn(conversation: readonly Turn[], dates: readonly string[], today: string): DateChoice | null {
  let choice: DateChoice | null = null;
  for (let index = 1; index < conversation.length; index += 1) {
    const turn = conversation[index]!;
    const before = conversation[index - 1]!;
    if (turn.role !== "user") continue;
    if (before.role === "assistant" && askedForDate(before.content)) {
      choice = readDateChoice(turn.content, dates, today) ?? (keepsOpen() ? bareDateAnswer(turn.content, dates, today) : null) ?? choice;
      continue;
    }
    // DATE_ANSWER_APPLIED_ENABLED: "10/15" after "She is at Kearney" still answers the open question.
    if (dateAnswerAppliedEnabled() && dateQuestionOpen(conversation.slice(0, index), dates, today)) {
      choice = bareDateAnswer(turn.content, dates, today) ?? choice;
    }
  }
  return choice;
}

/** Whether the last turn is a bare answer to a pending date question. */
export function answersDateQuestion(history: readonly Turn[], question: string, dates: readonly string[], today: string): boolean {
  const lastAssistant = [...history].reverse().find((turn) => turn.role === "assistant");
  const asked = dates.length ? dates : [today];
  // DATE_ANSWER_APPLIED_ENABLED: the question asked a turn or two back is still open.
  if (dateAnswerAppliedEnabled() && dateQuestionOpen(history, asked, today) && bareDateAnswer(question, asked, today) !== null) return true;
  return !!lastAssistant && askedForDate(lastAssistant.content) && readDateChoice(question, asked, today) !== null;
}

/*
 * ============================================================================
 * WHICH DATE THE FORM CARRIES, BY WHAT EACH DATE MEANS
 * ============================================================================
 *
 * QA, 22 Oct 2026. In order:
 *
 *   1. A date the manager gave the FORM ("dated 10/20") is its Date.
 *   2. On a Coaching Form, the coaching the manager says they HELD ("I coached
 *      her on 10/16") is its Date — when nothing she did is dated after it.
 *      Two such coachings are a question, among them.
 *   3. Several incident dates are a question ("Which date goes on the form?");
 *      until it is answered the form carries no date, so it is dated the day
 *      it is created — never whichever incident was typed first.
 *   4. Otherwise nothing is decided here: one incident date dates the form,
 *      as it always has, and none leaves it to the day it is created.
 *
 * Earlier steps (coaching or warnings already given) are never the form's
 * date — `form-date-answer.ts` keeps them out of every list used here.
 */
const DATED_TEMPLATES: ReadonlySet<string> = new Set(["coaching", "follow-up-coaching", "dpoa", "policy-review"]);
const COACHING_TEMPLATES: ReadonlySet<string> = new Set(["coaching", "follow-up-coaching"]);

export interface FormDateDecision {
  /** Set when this module decides the date; `null` means "the day it is created". Absent: leave it as read. */
  readonly formDate?: string | null;
  /** The dates the manager is choosing among, while the question is open. */
  readonly candidates?: string[];
  /** The question to ask, once. */
  readonly question?: string;
}

export function decideFormDate(input: {
  readonly text: string;
  readonly templateKey: string;
  readonly history: readonly Turn[];
  readonly conversation: readonly Turn[];
  readonly today: string;
  /**
   * The incident date the manager corrected the conversation to ("the meeting
   * was actually on 10-19-26"), where they did. Among several dates it is the
   * answer: the date it replaced is not a second incident, and no question is
   * asked about it.
   */
  readonly correctedTo?: string | null;
}): FormDateDecision {
  if (!DATED_TEMPLATES.has(input.templateKey)) return {};
  const explicit = explicitFormDate(input.text, input.today);
  if (explicit) return { formDate: explicit };

  let dates = incidentDates(input.text, input.today, COACHING_TEMPLATES.has(input.templateKey));
  if (COACHING_TEMPLATES.has(input.templateKey)) {
    const latestIncident = dates[dates.length - 1] ?? "";
    const held = heldCoachingDates(input.text, input.today).filter((iso) => iso >= latestIncident);
    if (held.length === 1) return { formDate: held[0]! };
    if (held.length > 1) dates = held;
  }
  /*
   * FORM_DATE_INCIDENT_ONLY_ENABLED (D3): the date the card would otherwise
   * take — the first one read, as `extractFormDate` gives it — may be a
   * deadline, assignment or prior-action date. Then the form is dated by the
   * one incident date left, or the day it is created when none is.
   */
  if (incidentOnlyOn() && dates.length <= 1) {
    const first = listIncidentDates(input.text, input.today)[0];
    if (first && incidentOnly(input.text, input.today, [first]).length === 0) return { formDate: dates[0] ?? null };
  }
  if (dates.length <= 1) return {};
  if (input.correctedTo && dates.includes(input.correctedTo)) return { formDate: input.correctedTo };

  const choice = dateAnsweredIn(input.conversation, dates, input.today);
  if (choice) return { formDate: choice.kind === "date" ? choice.iso : null };
  return {
    formDate: null,
    candidates: dates,
    // DATE_ANSWER_KEEPS_OPEN_ENABLED: asked on every card until answered, as the payroll question is.
    ...((keepsOpen() ? dateQuestionOpen(input.conversation, dates, input.today) || !dateAlreadyAsked(input.history) : !dateAlreadyAsked(input.history))
      ? { question: dateQuestion(dates) }
      : {}),
  };
}

/**
 * The manager turns that ANSWER the date question — "most recent", "the first
 * one", "10/15", "today" — trimmed. Such a turn is often the whole message,
 * and the typed-name reader takes a whole short message for a name, so the
 * name readers skip these turns (the date reader still sees them). A
 * correction ("no, it's for Sam Jones") is never one. As Ask Bubbles'
 * `question-answers.ts` does for its date question.
 */
export function dateAnswerTurns(conversation: readonly Turn[]): Set<string> {
  const answered = new Set<string>();
  for (let index = 1; index < conversation.length; index += 1) {
    const turn = conversation[index]!;
    const before = conversation[index - 1]!;
    if (turn.role !== "user") continue;
    const asked = before.role === "assistant" && askedForDate(before.content);
    // DATE_ANSWER_APPLIED_ENABLED: "most recent" after "She is at Kearney" still answers the open question.
    const stillOpen =
      !asked &&
      dateAnswerAppliedEnabled() &&
      dateQuestionOpen(conversation.slice(0, index), ["0000-00-00"], "9999-12-31") &&
      bareDateAnswer(String(turn.content), ["0000-00-00"], "9999-12-31") !== null;
    if (!asked && !stillOpen) continue;
    const reply = String(turn.content).trim();
    /*
     * KEEP_FORM_EMPLOYEE_ENABLED: the answer is in the manager's words. The
     * lines the app wrote onto the question ("The employee is test employee.
     * It happened on 10/16/2026.") are not an answer, so "create the ca" after
     * "Which date goes on the form?" is not dropped from the name readers —
     * dropping it lost the employee line, and the reply named the new hire an
     * earlier turn described (QA round 10, conv_mvnjix4r2wm7u7r).
     */
    const words = keepFormEmployeeEnabled() ? withoutAppLines(reply).trim() : reply;
    if (words !== "" && !correctsTheEmployee(words) && readDateChoice(words, ["0000-00-00"], "9999-12-31") !== null) {
      answered.add(reply);
    }
  }
  return answered;
}

/*
 * ============================================================================
 * PRIOR_SENTENCE_FIX_ENABLED — TWO INCIDENT DATES ARE ASKED, ON EVERY PATH
 * ============================================================================
 *
 * Coordinator's ruling, 26 Oct 2026 (QA-6, live: "she was late on 10-5 and
 * 10-15" dated 10/5 or 10/15 silently, and "coached her 10-16, written
 * warning on 10-20" dated 10/20). For a reader that picks the form's date on
 * its own — the full remap — the same rule `decideFormDate` applies to
 * written-out dates, for yearless ones too:
 *
 *   - the newest "change the date to …" the manager typed is the date;
 *   - a date given to the form ("dated 10/20") is the date;
 *   - one incident date is the date; a range ("from 10-5 to 10-9") is one
 *     incident, its first day;
 *   - two or more are asked once ("Which date goes on the form?"), and until
 *     the manager answers the form is dated the day it is created (null);
 *     the answer ("10/15", "most recent", "the first one", "today") sets it;
 *   - an earlier step's, a follow-up's or a deadline's date is never one of
 *     them (`statedIncidentDates`).
 *
 * Null with the flag off, or when the manager gave no incident date — then
 * the caller's own reading stands (with earlier steps' dates blanked).
 */
export interface StatedFormDate {
  /** The form's date, or null for the day it is created. */
  readonly iso: string | null;
  /** The incident dates being asked about; empty once one is settled. */
  readonly candidates: readonly string[];
  /** The question to ask, once; null when settled or already asked. */
  readonly question: string | null;
}

export function statedFormDate(conversation: readonly Turn[], today: string): StatedFormDate | null {
  if (!priorSentenceFixFor(conversation.filter((turn) => turn.role === "user").map((turn) => String(turn.content)).join("\n"))) return null;
  // The manager's own words: the lines the app writes onto a question ("It happened on 10/5/2026.") are not.
  const said = conversation.map((turn) => (turn.role === "user" ? { ...turn, content: withoutAppLines(String(turn.content)).trim() } : turn));
  const answers = dateAnswerTurns(said);
  const users = said
    .filter((turn) => turn.role === "user")
    .map((turn) => String(turn.content))
    .filter((turn) => turn !== "" && !answers.has(turn.trim()));
  const change = (turn: string) => formDateChange(yearlessWrittenOut(turn, today), today);
  for (const turn of [...users].reverse()) {
    const changed = change(turn);
    if (changed) return { iso: changed, candidates: [], question: null };
  }
  const text = users.filter((turn) => !change(turn)).join("\n");
  const explicit = explicitFormDate(yearlessWrittenOut(text, today), today);
  if (explicit) return { iso: explicit, candidates: [], question: null };
  const dates = [...new Set(incidentOnly(text, today, statedIncidentDates(text, today)).map((found) => found.iso))].sort();
  if (dates.length === 0) return null;
  if (dates.length === 1) return { iso: dates[0]!, candidates: [], question: null };
  const written = said.map((turn) => (turn.role === "user" ? { ...turn, content: yearlessWrittenOut(String(turn.content), today) } : turn));
  const choice = dateAnsweredIn(written, dates, today);
  if (choice) return { iso: choice.kind === "date" ? choice.iso : null, candidates: [], question: null };
  // DATE_ANSWER_KEEPS_OPEN_ENABLED: asked on every card until answered.
  const askAgain = keepsOpen() && dateQuestionOpen(said, dates, today);
  return { iso: null, candidates: dates, question: dateAlreadyAsked(said) && !askAgain ? null : dateQuestion(dates) };
}

/** PRIOR_SENTENCE_FIX_ENABLED: the manager turns that only answer the date question ("10/15", "most recent"), in their own words. */
export function dateAnswersSaid(conversation: readonly Turn[]): Set<string> {
  if (!priorSentenceFixEnabled()) return new Set();
  return dateAnswerTurns(conversation.map((turn) => (turn.role === "user" ? { ...turn, content: withoutAppLines(String(turn.content)).trim() } : turn)));
}

/** DATE_ANSWER_APPLIED_ENABLED: "most recent", "the latest", "first one" answer the date question; they name nobody. */
const DATE_ANSWER_WORDS = /^(?:the\s+)?(?:most\s+recent|latest|newest|last(?:\s+(?:one|date))?|first(?:\s+one)?|earliest|oldest|second(?:\s+one)?)$/i;

export function isDateAnswerWords(name: string): boolean {
  return dateAnswerAppliedEnabled() && DATE_ANSWER_WORDS.test(name.trim());
}
