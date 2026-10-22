/**
 * ============================================================================
 * THE DATE A MANAGER TYPED, AS THE FORM'S DATE
 * ============================================================================
 *
 * The intakes only ever asked WHETHER a date had been given (`DATE_GIVEN` in
 * `corrective-action-intake.ts` and `epp-intake.ts`). Nothing read WHICH date,
 * so a manager who answered "3. 9/11" got a form dated today — and the drafting
 * route, correctly trusting `form_date`, then rewrote the "September 11" in the
 * observation to today as well.
 *
 * This reads the date itself, in the shapes managers actually type:
 *
 *   9/11   02/21   9/11/26   09/11/2026   2026-09-11
 *   Sep 11   Sept. 11th   September 11   September 11, 2026
 *
 * NUMERIC DATES ARE U.S. MONTH/DAY. "02/21" is February 21st; "21/02" is not a
 * date and is ignored rather than flipped.
 *
 * NO YEAR IS NEEDED. A month and day take the current business year. The form's
 * Date field stays editable, so a manager writing in January about December 30
 * corrects one field rather than being stopped for a year nobody types.
 *
 * "today", "yesterday" and weekdays are deliberately NOT resolved here. "Today"
 * is already what `form_date` defaults to, and the rest were never turned into a
 * calendar date before either.
 */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const MONTH_NAME =
  "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec";

/**
 * Every date shape, one alternative per shape so the match says which it was.
 * The numeric one refuses to start or end inside a longer run of digits and
 * slashes, so "1/2/3/4" and "12345/6" are not read as dates.
 */
const DATE_IN_TEXT = new RegExp(
  [
    String.raw`\b(\d{4})-(\d{2})-(\d{2})\b`,
    String.raw`(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])`,
    /*
     * "10-05-2026" and "10-5-26": U.S. month-day-year with dashes. The YEAR IS
     * REQUIRED, unlike the slashed form, because "10-12" on its own is far more
     * often a range ("10-12 hours") than a date.
     */
    String.raw`(?<![\d-])(\d{1,2})-(\d{1,2})-(\d{4}|\d{2})(?![\d-])`,
    String.raw`\b(${MONTH_NAME})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4})\b)?`,
  ].join("|"),
  "gi",
);

/**
 * A date that names the REVIEW, not the incident — "follow up the week of
 * October 5". Kept in step with `FOLLOW_UP_GIVEN` in `epp-intake.ts`.
 */
const FOLLOW_UP_BEFORE =
  /\b(?:week of|follow[- ]?up|followup|re[- ]?eval\w*|revisit|check back|check[- ]?in)\b[^.\n]{0,25}$/i;

/**
 * A date that names an EARLIER STEP, not this form — "got a verbal warning on
 * september 21", "was coached on 9/2", "previous corrective action 8/15".
 * Production: "create ca for paulyne co she was late today, got verbal warning
 * on september 21" dated the new Corrective Action Form September 21, the day
 * of the PRIOR warning. Read within the date's own clause, and only with a
 * past-tense or "previous/prior/already" marker, so "give her a written
 * warning on 10/2" — an instruction about this form — is not affected.
 */
const PRIOR_STEP_BEFORE =
  /\b(?:got|gotten|received|was given|were given|been given|given|had|issued|gave|was|were|previous(?:ly)?|prior|already|last time)\b[^.;\n]{0,40}\b(?:warn(?:ing|ings|ed)|write[- ]?ups?|written up|coach(?:ed|ing)?|corrective actions?|disciplin\w*)\b[^.;\n]{0,20}$/i;

/*
 * ============================================================================
 * "PREVIOUS COACHING WAS JBA POLICY MANUAL 1-1-26" — A LABELLED EARLIER STEP
 * ============================================================================
 *
 * District Manager feedback, 21 Oct 2026. Managers write the employee's
 * history as a label and what it was about, with the date last:
 *
 *   "previous coaching was jba policy manual 1-1-26"
 *   "previous coaching - jba policy manual 1-20-26"
 *   "jba manual 1-1-26 for previous coaching"
 *
 * The topic between the label and the date is longer than `PRIOR_STEP_BEFORE`
 * allows, and in the last one the label comes after the date — so the
 * coaching's date could become the form's own (a request whose only date was
 * the coaching's was dated by it), and never reached the prior-actions line.
 * A step named "previous / prior / past / last / earlier …" is history
 * wherever its date sits: up to five words of topic after the label, or the
 * label right after the date. The topic words stop at anything that starts an
 * account ("previous coaching was about lateness and she was late on 10/20"
 * leaves 10/20 an incident date).
 */
const STEP_NOUN = String.raw`(?:coachings?|coached|warnings?|write[- ]?ups?|written\s+up|corrective\s+actions?|(?:disciplinary\s+)?actions?|cas|ca|c\/a|disciplin\w*)`;
const HISTORY_LABEL = String.raw`(?:previous|prior|past|last|earlier)\s+${STEP_NOUN}`;
const TOPIC_WORD = String.raw`(?!(?:and|but|or|she|he|they|then|again|today|yesterday|was|were|is|late|on|at|for)\b)[a-z0-9&'/]+`;

/**
 * "previous coaching was jba policy manual " — the label, then up to five
 * words of what it was about. A label followed by a colon or a dash
 * ("previous coaching: …", "prior actions - …") opens a LIST (`marker`).
 */
const LABELLED_STEP_BEFORE = new RegExp(
  String.raw`\b${HISTORY_LABEL}\b\s*(?:(?:was|were|is|on|dated|signed)\s+|(?<marker>[:=\-–—])\s*(?:(?:[-*•]|\d+[.)])\s+)?)?(?<topic>(?:${TOPIC_WORD}\s+){0,5})$`,
  "i",
);

/** "1-1-26 for previous coaching" — the label right after the date. */
const LABELLED_STEP_AFTER = new RegExp(
  String.raw`^\s*(?:for|as|was|were|is|[:=\-–—])?\s*(?:(?:the|her|his|their|a|an)\s+)?${HISTORY_LABEL}\b`,
  "i",
);

/** The topic in front of a date the label follows: "jba manual" in "… deduct. jba manual 1-1-26 for previous coaching". */
const TOPIC_BEFORE_DATE = new RegExp(String.raw`(?:^|[.;\n,]\s*)((?:${TOPIC_WORD}\s+){1,5})$`, "i");

/*
 * "PREVIOUS COACHING: JBA POLICY MANUAL 1-1-26, VERBAL CA 9-1-26" — A LIST.
 *
 * HR, 21 Oct 2026. Under a label with a colon or a dash, the manager lists the
 * whole history, and EVERY item in it is history: coaching, a verbal or
 * written CA or warning, a policy acknowledgement. Only the first item sat
 * right after the label, so the second ("verbal ca 9-1-26") was dropped from
 * the prior actions and handed to the drafting model as one of the manager's
 * dates for the form. The list runs from one dated item to the next across a
 * comma, "and", "&" or a new bulleted line, each item up to five words before
 * its date; it ends at the end of the sentence, or at anything that starts an
 * account ("…1-1-26, late again on 10/20").
 */
const LIST_ITEM_BEFORE = new RegExp(
  String.raw`^\s*(?:,\s*(?:(?:and|&)\s+)?|\s+(?:and|&)\s+|\s*\n\s*(?:[-*•]|\d+[.)])\s*)((?:${TOPIC_WORD}\s+){0,5}?)(?:(?:on|dated|signed)\s+)?$`,
  "i",
);

interface LabelledStep {
  /** The words that name the step: the label, and the item's own words. */
  named: string;
  /** What it was about, as the manager wrote it. */
  topic: string;
}

/** Every date in `dates` that is a labelled earlier step, by its offset, with its label and topic. */
function labelledSteps(text: string, dates: readonly DateInText[]): Map<number, LabelledStep> {
  const found = new Map<number, LabelledStep>();
  // The label of the list the previous date was an item of, while the list is still open.
  let list: string | null = null;
  let previousEnd = 0;
  for (const date of dates) {
    const item = list === null ? null : LIST_ITEM_BEFORE.exec(text.slice(previousEnd, date.index));
    previousEnd = date.end;
    if (list !== null && item) {
      found.set(date.index, { named: `${list}${item[1] ?? ""}`, topic: (item[1] ?? "").trim() });
      continue;
    }
    list = null;
    const before = text.slice(0, date.index);
    const ahead = LABELLED_STEP_BEFORE.exec(before);
    if (ahead) {
      const topic = ahead.groups?.topic ?? "";
      found.set(date.index, { named: ahead[0], topic: topic.trim() });
      if (ahead.groups?.marker) list = ahead[0].slice(0, ahead[0].length - topic.length);
      continue;
    }
    const after = LABELLED_STEP_AFTER.exec(text.slice(date.end));
    if (after) found.set(date.index, { named: after[0].trim(), topic: (TOPIC_BEFORE_DATE.exec(before)?.[1] ?? "").trim() });
  }
  return found;
}

function isOtherDate(text: string, found: DateInText, labelled: ReadonlyMap<number, LabelledStep>): boolean {
  const before = text.slice(0, found.index);
  return (
    FOLLOW_UP_BEFORE.test(before) ||
    PRIOR_STEP_BEFORE.test(before) ||
    labelled.has(found.index)
  );
}

/**
 * The date the manager gave for the EARLIER step — "got verbal warning on
 * september 21" -> the 21st — or null when they gave none. The latest one
 * when they named several. The same reading that keeps that date off the
 * form's own date (`PRIOR_STEP_BEFORE`), so the two can never disagree about
 * which date is which.
 */
export function priorStepDate(text: string, today: string): string | null {
  const prior = priorSteps(text, today)
    .map((found) => found.iso)
    .sort();
  return prior.length > 0 ? prior[prior.length - 1]! : null;
}

/**
 * EVERY earlier step the manager dated, in the order they wrote them, with the
 * words that named it — "got verbal warning on september 21" yields the 21st
 * and "got verbal warning on". The same reading as `priorStepDate`, which is
 * the latest of these; a list is what a form that records several needs.
 */
export function priorSteps(text: string, today: string): { iso: string; named: string; topic?: string }[] {
  const dates = datesInText(text, today);
  const steps = labelledSteps(text, dates);
  return dates.flatMap((found) => {
    const before = text.slice(0, found.index);
    // "previous coaching was jba policy manual 1-1-26": what it was about, as the manager wrote it.
    const labelled = steps.get(found.index);
    if (labelled) {
      return [{ iso: found.iso, named: labelled.named, ...(labelled.topic ? { topic: labelled.topic } : {}) }];
    }
    const match = PRIOR_STEP_BEFORE.exec(before);
    return match ? [{ iso: found.iso, named: match[0] }] : [];
  });
}

/** A real `YYYY-MM-DD` on the calendar — no February 30th. */
export function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  return calendarIso(Number(match[1]), Number(match[2]), Number(match[3])) === value;
}

function calendarIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** A calendar date found in text, with where it sits. */
export interface DateInText {
  /** `YYYY-MM-DD`. */
  iso: string;
  /** Offset of the first character of the match. */
  index: number;
  /** Offset just past the match. */
  end: number;
}

/**
 * EVERY real calendar date in the text, in order, in the shapes listed at the
 * top of this file.
 *
 * The one reader of those shapes. `extractFormDate` takes the first that is not
 * a follow-up; the exit form's reader (`exit-facts.ts`) decides which of them is
 * the last day worked and which the notice dates. Two copies of this pattern is
 * how "9/11" would come to mean September on one form and nothing on another.
 *
 * `today` is the business day (`YYYY-MM-DD`) and supplies the year when the
 * manager gave none. Anything that is not a real day ("13/40", "Feb 30") is
 * skipped rather than reported.
 */
export function datesInText(text: string, today: string): DateInText[] {
  const currentYear = Number(/^(\d{4})-/.exec(today)?.[1]);
  if (!Number.isFinite(currentYear)) return [];

  const found: DateInText[] = [];
  DATE_IN_TEXT.lastIndex = 0;
  for (const match of (text ?? "").matchAll(DATE_IN_TEXT)) {
    const [, isoY, isoM, isoD, slashM, slashD, slashY, dashM, dashD, dashY, name, nameD, nameY] =
      match;
    // The slashed and the dashed U.S. shapes read the same way.
    const numM = slashM ?? dashM;
    const numD = slashD ?? dashD;
    const numY = slashY ?? dashY;
    let iso: string | null = null;

    if (isoY !== undefined) {
      iso = calendarIso(Number(isoY), Number(isoM), Number(isoD));
    } else if (numM !== undefined) {
      const year =
        numY === undefined ? currentYear : numY.length === 2 ? 2000 + Number(numY) : Number(numY);
      iso = calendarIso(year, Number(numM), Number(numD));
    } else if (name !== undefined) {
      const month = MONTHS[name.toLowerCase()];
      if (month !== undefined) {
        iso = calendarIso(nameY === undefined ? currentYear : Number(nameY), month, Number(nameD));
      }
    }

    if (iso !== null) {
      const index = match.index ?? 0;
      found.push({ iso, index, end: index + match[0].length });
    }
  }
  return found;
}

/**
 * The first incident date in the manager's words, as `YYYY-MM-DD`, or null.
 *
 * `today` is the business day (`YYYY-MM-DD`) and supplies the year when the
 * manager gave none. A date marked as a follow-up or as an earlier step (see
 * `PRIOR_STEP_BEFORE`) is skipped, and so is anything that is not a real day
 * ("13/40", "Feb 30").
 */
export function extractFormDate(text: string, today: string): string | null {
  return listFormDates(text, today)[0]?.iso ?? null;
}

/**
 * The dates that are not follow-ups, with where each was found — for a caller
 * that tells dates apart by the words in front of them ("effective oct 5"
 * versus the form's own date). `extractFormDate` is this list's first entry.
 */
export function listFormDates(text: string, today: string): { iso: string; index: number }[] {
  const dates = datesInText(text, today);
  const labelled = labelledSteps(text, dates);
  return dates
    .filter((found) => !isOtherDate(text, found, labelled))
    .map(({ iso, index }) => ({ iso, index }));
}

/*
 * ============================================================================
 * "CHANGE THE DATE TO 10-19-26" — A CORRECTION TO THE FORM'S OWN DATE
 * ============================================================================
 *
 * QA audit, 22 Oct 2026: a Corrective Action Form's date could not be
 * corrected from the conversation in any wording, while the answer told the
 * manager to "say it in plain words". Read only where the DATE is named as
 * what is being corrected — "change the date to …", "the date was wrong … on
 * …", "the date should be …" — or one day is set against another ("it was
 * 10-19-26, not 10-20-26"). A new incident's date ("she was late again on
 * 10-19-26") is never a correction, and neither is a question.
 */
/*
 * THE FORM'S OWN DATE, named as such: "the date", "the form date", "the date
 * of the incident", "the date on the form". Never a follow-up, due, review or
 * effective date — those are other lines, read elsewhere.
 */
const THE_DATE = String.raw`\b(?:the\s+|this\s+|her\s+|his\s+|their\s+)?(?:form(?:'s)?\s+|incident\s+|offen[cs]e\s+)?date\b(?:\s+(?:of|on|for)\s+(?:the\s+|this\s+)?(?:incident|offen[cs]e|form))?`;
/*
 * "the date" and then straight to the new value — or ", it should be" after
 * it. Nothing else between: "change the date on the action plan to …", "move
 * the date of the meeting to …" and "change the date she was hired to …" name
 * another date (review, 22 Oct 2026).
 */
const NAMES_THE_DATE_TO = new RegExp(
  String.raw`\b(?:change|update|correct|fix|set|make|move)\s+${THE_DATE}(?:\s*,\s*it)?\s*(?:\b(?:to|is|as|should\s+be)\b|[=:])\s*`,
  "i",
);
const THE_DATE_SHOULD_BE = new RegExp(
  String.raw`${THE_DATE}\s+(?:should\s+(?:be|have\s+been|say|read)|needs\s+to\s+be|is\s+actually|was\s+actually)\s+`,
  "i",
);
const THE_DATE_WAS_WRONG = new RegExp(String.raw`${THE_DATE}\s+(?:is|was)\s+(?:wrong|incorrect|off|a\s+mistake)\b`, "i");
/**
 * "follow-up date", "due date", "the previous coaching date", "the date of
 * her verbal warning": another line's date — or an earlier step's — whatever
 * verb is in front of it.
 */
const EARLIER_STEP = String.raw`(?:previous|prior|last|earlier|past|first|verbal|written|final|coaching|warning|ca|c\/a|corrective|follow[\s-]?up)`;
const ANOTHER_DATE = new RegExp(
  [
    String.raw`\b(?:follow[\s-]?up|due|review|effective|start|end|last|check[\s-]?in|next|hire|signed|signature|coaching|warning|ca)\s+date\b`,
    String.raw`\bdate\s+(?:of|for|on)\s+(?:the\s+|her\s+|his\s+|their\s+|that\s+)?${EARLIER_STEP}\b`,
  ].join("|"),
  "i",
);
const IT_WAS = /\b(?:it|this|that)\s+(?:was|happened|occurred|actually\s+happened)\s+(?:on\s+)?$/i;
const NOT_THAT_DAY = /^\s*,?\s*(?:and\s+)?not\s+(?:on\s+)?$/i;

/** The ISO date a manager corrects the form's date to, or null. */
export function formDateChange(text: string, today: string): string | null {
  const said = (text ?? "").trim();
  if (said === "" || said.endsWith("?") || ANOTHER_DATE.test(said)) return null;
  const dates = datesInText(said, today);
  if (dates.length === 0) return null;

  const pointer = NAMES_THE_DATE_TO.exec(said) ?? THE_DATE_SHOULD_BE.exec(said);
  if (pointer) {
    // Two different days offered ("10-2 or 10-3") is not a date: it is asked about.
    const offered = new Set(dates.filter((found) => found.index >= pointer.index + pointer[0].length).map((found) => found.iso));
    return offered.size === 1 ? [...offered][0]! : null;
  }

  const wrong = THE_DATE_WAS_WRONG.exec(said);
  if (wrong) {
    const after = dates.filter((found) => found.index > wrong.index);
    if (new Set(after.map((found) => found.iso)).size === 1) return after[0]!.iso;
  }

  for (let at = 0; at + 1 < dates.length; at += 1) {
    const [day, other] = [dates[at]!, dates[at + 1]!];
    if (IT_WAS.test(said.slice(0, day.index)) && NOT_THAT_DAY.test(said.slice(day.end, other.index))) return day.iso;
  }
  return null;
}

/** "change the date", "the date is wrong" — the date named as what is wrong, with no single day given. */
const THE_DATE_IS_WRONG_ALONE = new RegExp(
  String.raw`\b(?:change|update|correct|fix)\s+${THE_DATE}\s*(?:[.!]|$)|${THE_DATE}\s+(?:is|was)\s+(?:wrong|incorrect|off)\b`,
  "i",
);

/**
 * A correction to the form's date that does not settle which day — none given
 * ("change the date"), or several ("10-2 or 10-3"). Nothing is changed; the
 * manager is asked, offered the days they named. Null for anything else,
 * including a correction `formDateChange` reads.
 */
export function formDateChangeUnclear(text: string, today: string): { offered: string[] } | null {
  const said = (text ?? "").trim();
  if (said === "" || said.endsWith("?") || ANOTHER_DATE.test(said)) return null;
  if (formDateChange(said, today) !== null) return null;
  if (!THE_DATE_IS_WRONG_ALONE.test(said) && !NAMES_THE_DATE_TO.test(said) && !THE_DATE_SHOULD_BE.test(said)) return null;
  return { offered: [...new Set(datesInText(said, today).map((found) => found.iso))] };
}

/** Ask Sunny' own question about the form's date — see `formDateChangeUnclear`. */
const ASKED_WHICH_DATE = /\b(?:Which|What) date should the\b/;
/** The words a bare answer may carry beside the date: "it's october 3", "use 10/3". */
const ANSWER_FILLER = /^(?:[\s,.!]|it'?s|it is|that'?s|use|make it|the|on|date|please|one)*$/i;

/**
 * The day a manager answers Ask Sunny' "which date?" question with — "October
 * 3", "10/3/26", "it's october 3" — read only straight after that question,
 * and only when the reply is that one date and nothing else (review, 22 Oct 2026).
 */
export function formDateReply(text: string, lastAssistant: string, today: string): string | null {
  if (!ASKED_WHICH_DATE.test(lastAssistant ?? "")) return null;
  const said = (text ?? "").trim();
  const dates = datesInText(said, today);
  if (dates.length !== 1) return null;
  const rest = said.slice(0, dates[0]!.index) + " " + said.slice(dates[0]!.end);
  return ANSWER_FILLER.test(rest) ? dates[0]!.iso : null;
}
