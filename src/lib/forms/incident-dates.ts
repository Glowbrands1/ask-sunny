import { withoutAppLines } from "@/lib/ai/app-sentences";
import { futureIncidentDateAskEnabled, keepFormEmployeeEnabled } from "@/lib/config/chat-quality-flags";

import { datesInText, explicitFormDate, heldCoachingDates, listFormDates, listIncidentDates } from "./form-date-answer";
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
export function incidentDates(text: string, today: string): string[] {
  const explicit = explicitFormDate(text, today);
  return [...new Set(listIncidentDates(text, today).map((found) => found.iso))]
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
  if (typed.length > 0) return { kind: "date", iso: typed[typed.length - 1]!.iso };
  if (/\b(?:most recent|latest|newest|last (?:one|date)|second)\b/.test(text)) {
    return { kind: "date", iso: dates[dates.length - 1]! };
  }
  if (/\b(?:first|earliest|oldest)\b/.test(text)) return { kind: "date", iso: dates[0]! };
  if (/\b(?:today|the day (?:i|we) (?:create|file|write)|creation)\b/.test(text)) return { kind: "today" };
  return null;
}

/** The manager's answer to an earlier date question, over the whole conversation. */
export function dateAnsweredIn(conversation: readonly Turn[], dates: readonly string[], today: string): DateChoice | null {
  let choice: DateChoice | null = null;
  for (let index = 1; index < conversation.length; index += 1) {
    const turn = conversation[index]!;
    const before = conversation[index - 1]!;
    if (turn.role !== "user" || before.role !== "assistant" || !askedForDate(before.content)) continue;
    choice = readDateChoice(turn.content, dates, today) ?? choice;
  }
  return choice;
}

/** Whether the last turn is a bare answer to a pending date question. */
export function answersDateQuestion(history: readonly Turn[], question: string, dates: readonly string[], today: string): boolean {
  const lastAssistant = [...history].reverse().find((turn) => turn.role === "assistant");
  return !!lastAssistant && askedForDate(lastAssistant.content) && readDateChoice(question, dates.length ? dates : [today], today) !== null;
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

export const FUTURE_DATE_TAG = "is after today";

/** "finish it by 12-20-26", "due 12/1": a date something is owed by, which may well be ahead. */
const DUE_BEFORE = /\b(?:by|due(?:\s+(?:on|by))?|until|till|til|before|deadline(?:\s+(?:of|is|on))?)\s+(?:the\s+)?$/i;
/*
 * "missing the 11/1 woven deadline", "the 12-20-26 due date": a date a deadline
 * word follows, up to two words on (QA-7, 26 Oct 2026). The same rule as
 * FORM_DATE_INCIDENT_ONLY's `DEADLINE_NEAR_AFTER`; kept here so this flag
 * stands on its own.
 */
const DEADLINE_AFTER =
  /^\s*(?:(?!(?:and|for|the|but|or|then|after|before|so|to|was|were|is|are|of|on|at|with|because|when|while|she|he|they|her|his|it)\b)[a-z]+\s+){0,2}(?:deadline|due\s+date)\b/i;

function longDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${Number(month)}/${Number(day)}/${year}`;
}

/** Asked once when the account dates the incident after today. */
export function futureDateQuestion(iso: string, today: string): string {
  return `The date you gave, **${longDate(iso)}**, ${FUTURE_DATE_TAG} (${longDate(today)}), and a form records something that already happened. What date did it happen? Say "today" for today — until you do, the form is dated the day it is created.`;
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
  /*
   * FUTURE_INCIDENT_DATE_ASK_ENABLED (QA, 26 Oct 2026, sibling tester U4): a
   * written CA "for not attending the monthly meeting on 12-20-26", written on
   * 10/25, was accepted in full wording and challenged only in the terse
   * typo version. A form documents something that already happened: an
   * incident date after today is asked about once, in every register, and
   * the form is never dated by it. A deadline or a follow-up in the future is
   * not an incident date and is not asked about (`listIncidentDates`), and
   * neither is a date the manager gave the form itself ("dated 10/2", above).
   */
  if (futureIncidentDateAskEnabled()) {
    const ends = new Map(datesInText(input.text, input.today).map((date) => [date.index, date.end]));
    const read = listIncidentDates(input.text, input.today).filter(
      (found) =>
        !DUE_BEFORE.test(input.text.slice(Math.max(0, found.index - 30), found.index)) &&
        !DEADLINE_AFTER.test(input.text.slice(ends.get(found.index) ?? found.index, (ends.get(found.index) ?? found.index) + 30)),
    );
    const future = [...new Set(read.map((found) => found.iso))].filter((iso) => iso > input.today);
    /*
     * Asked only when NO past incident date was stated (coordinator, 26 Oct
     * 2026): "late on 10-20-26, meeting is on 12-20-26" is dated 10-20, the one
     * past incident date, and the meeting ahead is not challenged.
     */
    const past = incidentDates(input.text, input.today);
    if (future.length > 0 && past.length === 1) return { formDate: past[0]! };
    if (
      future.length > 0 &&
      past.length === 0 &&
      !input.history.some((turn) => turn.role === "assistant" && turn.content.includes(FUTURE_DATE_TAG))
    ) {
      return { formDate: null, question: futureDateQuestion(future[future.length - 1]!, input.today) };
    }
  }

  let dates = incidentDates(input.text, input.today);
  if (COACHING_TEMPLATES.has(input.templateKey)) {
    const latestIncident = dates[dates.length - 1] ?? "";
    const held = heldCoachingDates(input.text, input.today).filter((iso) => iso >= latestIncident);
    if (held.length === 1) return { formDate: held[0]! };
    if (held.length > 1) dates = held;
  }
  if (dates.length <= 1) return {};
  if (input.correctedTo && dates.includes(input.correctedTo)) return { formDate: input.correctedTo };

  const choice = dateAnsweredIn(input.conversation, dates, input.today);
  if (choice) return { formDate: choice.kind === "date" ? choice.iso : null };
  return {
    formDate: null,
    candidates: dates,
    ...(dateAlreadyAsked(input.history) ? {} : { question: dateQuestion(dates) }),
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
    if (turn.role !== "user" || before.role !== "assistant" || !askedForDate(before.content)) continue;
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
