import { priorActionsParseEnabled, priorSentenceFixEnabled } from "@/lib/config/chat-quality-flags";

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
    // "10.20.26": month-day-year with dots, the year required (QA, 22 Oct 2026, round 3). "$3.25" has two parts.
    String.raw`(?<![\d.$])(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?![\d.]*\d)`,
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
 * Production: "create ca for rosalyn co she was late today, got verbal warning
 * on september 21" dated the new Corrective Action Form September 21, the day
 * of the PRIOR warning. Read within the date's own clause, and only with a
 * past-tense or "previous/prior/already" marker, so "give her a written
 * warning on 10/2" — an instruction about this form — is not affected.
 */
const PRIOR_STEP_BEFORE =
  /\b(?:got|gotten|received|was given|were given|been given|given|had|issued|gave|was|were|previous(?:ly)?|prior|already|last time)\b[^.;\n]{0,40}\b(?:warn(?:ing|ings|ed)|write[- ]?ups?|written up|coach(?:ed|ing)?|corrective actions?|cas?|c\/a|disciplin\w*|(?:a|an)\s+(?:final\s+)?(?:verbal|written)(?!\s+up))\b(?:[^.;,\n]{0,20}|\s+(?:on|about|for|over|regarding)\s+(?:the\s+|her\s+|his\s+|their\s+)?(?:[a-z]+\s+){0,3}?(?:back\s+)?(?:on|in)\s+)$/i;

/**
 * A step that is hers already, with no past-tense verb: "despite / after /
 * since / following her written warning on 9/15", "her verbal warning on
 * 9/21". The warning-level reader reads these as history, and the history
 * line agrees — but ONLY for a date before today (`priorSteps`): "her
 * written warning should be dated 10/9" or "…will be delivered 10/12" is
 * this form's warning, and must never become a step nobody took. The cue
 * must sit right before the warning, and "give her a written warning on
 * 10/2" (an article, or an issuing verb) is this form.
 */
const OWNED_STEP_BEFORE = new RegExp(
  [
    String.raw`\b(?:despite|after|since|following)\s+(?:(?:her|his|their|the|a|an)\s+)?(?:(?:last|previous|prior|recent|verbal|written|final|formal)\s+){0,2}(?:warn(?:ing|ings)|write[- ]?ups?|coaching|corrective actions?)\b[^.;\n]{0,20}$`,
    String.raw`(?<!\b(?:give|gives|giving|issue|issues|issuing|write|writes|writing|needs?|get|gets|getting|make|deserves?)\s+)\b(?:her|his|their)\s+(?!a\b|an\b)(?:[a-z]+\s+){0,2}?(?:warn(?:ing|ings)|write[- ]?ups?|coaching|corrective actions?)\b[^.;\n]{0,20}$`,
  ].join("|"),
  "i",
);

/**
 * "I verbally coached her on 10/5", "talked to him on 9/1": an earlier step told
 * as something the manager DID, which carries no "had / got / previous" marker.
 * Requires an object pronoun, so "coaching form on 10/2" is unaffected.
 * Admin feedback, 16 Oct 2026: with "late on 10/15 … I coached her on 10/5" the
 * coaching date counted as a second incident date.
 */
const DID_STEP_BEFORE =
  /\b(?:verbal(?:ly)?\s+)?(?:coached|counsel(?:ed|led)|warned|talked to|spoke (?:to|with)|discussed (?:it |this )?with|addressed (?:it|this) with)\s+(?:her|him|them|the employee)\b[^.;\n]{0,30}$/i;

/**
 * THE SAME EARLIER STEP, TOLD THE OTHER WAYS MANAGERS TELL IT. QA, 22 Oct
 * 2026: "we had a talk with her about tardiness on 10/1" and "we discussed
 * attendance with her on 10/1" dated the Corrective Action 10/1 — the day of
 * the conversation, not of anything she did — and "I talked to pat about being
 * late on 10/1" did the same with a name for the pronoun. A conversation held
 * WITH her, or a topic gone over WITH her, is an earlier step wherever the
 * topic sits; so is "talked to / spoke with / coached <name> about …". As with
 * `DID_STEP_BEFORE`, the step must come before its date in the same clause, so
 * "she was late on 10/15 after I talked to her" leaves 10/15 the incident.
 */
const TALKED_STEP_BEFORE = new RegExp(
  [
    String.raw`\b(?:had|have had|has had|held)\s+(?:a\s+|an\s+)?(?:(?:verbal|formal|quick|serious|long)\s+)?(?:talk|conversation|chat|sit[- ]?down|discussion|one[- ]on[- ]one|meeting|coaching(?:\s+(?:conversation|session|talk))?)\s+with\s+(?:her|him|them|the employee)\b[^.;\n]{0,40}$`,
    String.raw`\b(?:discussed|went over|reviewed|addressed)\s+(?:[\w'’-]+\s+){1,4}?with\s+(?:her|him|them|the employee)\b[^.;\n]{0,30}$`,
    String.raw`\b(?:coached|counsel(?:ed|led)|warned|talked to|talked with|spoke to|spoke with|sat down with)\s+(?!(?:her|him|them|the employee)\b)[a-z][\w'’-]*(?:\s+[a-z][\w'’-]*)?\s+(?:about|regarding|over|on|for)\b[^.;\n]{0,30}$`,
  ].join("|"),
  "i",
);

/**
 * "…about BEING LATE on 10/1": the date is what she did, not when they talked.
 * After the conversation's topic word, an account of the behaviour keeps the
 * date an incident date; a topic named as a noun ("about tardiness on 10/1")
 * leaves it the conversation's.
 */
const ACCOUNT_IN_TOPIC =
  /\b(?:being|was|were|is|she|he|they|show(?:s|ed|ing)?\s+up|c(?:ame|oming)\s+in|call(?:s|ed|ing)?|miss(?:es|ed|ing)?|leav(?:es|ing)|left|arriv(?:es|ed|ing)|late|absent|no[- ]show)\b/i;

function talkedStep(before: string): boolean {
  const match = TALKED_STEP_BEFORE.exec(before);
  if (!match) return false;
  const cut = match[0].search(/\b(?:about|regarding|over|for)\b|\bwith\s+(?:her|him|them|the employee)\b/i);
  const topic = (cut >= 0 ? match[0].slice(cut) : match[0]).replace(/^\S+\s*/, "");
  return !ACCOUNT_IN_TOPIC.test(topic);
}

/*
 * ============================================================================
 * "DATED 10/20" IS THE FORM'S DATE, NOT ANOTHER INCIDENT
 * ============================================================================
 *
 * QA, 22 Oct 2026: "create verbal ca for pat rivera dated 10/20. she was late
 * on 10/5 and 10/15" was asked which of 10/5, 10/15 and 10/20 goes on the
 * form — the manager had just said. A date the manager explicitly gives the
 * FORM ("dated 10/20", "date the form 10/20", "form date: 10/20") is the
 * form's Date. It is never offered as an incident date, and it outranks one.
 * A date that is an earlier step or a follow-up is never read this way, so
 * "her written warning dated 9/21" stays history.
 */
const EXPLICIT_FORM_DATE_BEFORE =
  /\b(?:dated|date\s+(?:the\s+form|it|this(?:\s+(?:form|one))?)(?:\s+(?:as|for|to))?|(?:the\s+)?form(?:['’]s)?\s+date(?:\s+(?:is|should\s+be|of|as))?\s*[:=-]?|(?:the\s+)?form\s+(?:should\s+be\s+|is\s+)?dated(?:\s+(?:as|for))?)\s*(?:on\s+)?$/i;

/*
 * ============================================================================
 * ON A COACHING FORM, THE COACHING IS THE FORM'S DATE
 * ============================================================================
 *
 * QA, 22 Oct 2026: "coaching form for pat rivera, she was late on 10/5 and
 * 10/15, I coached her on 10/16" dated the Coaching Form 10/5 — the coaching
 * it documents was read as an EARLIER step and skipped. On a Corrective Action
 * that reading is right (the coaching is history the form escalates from); on
 * a Coaching Form the conversation the manager held IS the event. Only a
 * coaching the manager says they held ("I coached her on…", "we had a coaching
 * conversation with him on…", "I sat down with her on…"), never a labelled
 * earlier one ("previous coaching on 9/1"), and only when nothing she did is
 * dated after it — "I coached her on 9/1 and she was late again on 10/15" is a
 * new coaching about 10/15, with 9/1 its history. See `incident-dates.ts`.
 */
const HELD_COACHING_BEFORE =
  /\b(?:i|we)\s+(?:(?:verbally|formally|also|then|just)\s+)?(?:coached|counsel(?:ed|led)|(?:had|held)\s+(?:a\s+)?(?:coaching(?:\s+(?:conversation|session|talk))?|talk|conversation|sit[- ]?down)\s+with|sat down with|met with|talked (?:to|with)|spoke (?:to|with))\s+(?:her|him|them|the employee|[a-z][\w'’-]*(?:\s+[a-z][\w'’-]*)?)\b[^.;\n]{0,30}$/i;

const EARLIER_CUE = /\b(?:previous(?:ly)?|prior|earlier|already|before|last time)\b/i;

/*
 * ============================================================================
 * A DEADLINE IS NEITHER WHAT SHE DID NOR THE FORM'S DATE
 * ============================================================================
 *
 * District Manager feedback, 21 Oct 2026 (QA, 22 Oct 2026): "… violating
 * standards of conduct policy on 10-20-26. tess failed to acknowledge
 * policies in woven by the 10-15-26 deadline." — the deadline was read as a
 * second incident date, so the form's date became a question (or, before,
 * whichever came first). "by the 10-15-26 deadline", "the deadline was 10/15",
 * "due 10/15", "was supposed to finish it by 10/15" name when something was
 * DUE: it stays in the account, and is never an incident or the form's date.
 */
const DEADLINE_BEFORE = /\b(?:deadline|due\s+date)\s*(?:of|is|was|was\s+on|:)?\s*$|\bdue\s+(?:by\s+|on\s+)?$/i;
const BY_BEFORE = /\bby\s+(?:the\s+)?$/i;
const DEADLINE_AFTER = /^\s*(?:deadline|due\s+date)\b/i;
const OWED_IN_CLAUSE = /\b(?:supposed|due|needed|had|required|expected|asked)\s+to\b/i;

function isDeadline(text: string, found: DateInText): boolean {
  const before = text.slice(Math.max(0, found.index - 60), found.index);
  if (DEADLINE_BEFORE.test(before)) return true;
  if (DEADLINE_AFTER.test(text.slice(found.end, found.end + 20))) return true;
  const clause = before.slice(Math.max(before.search(/[^.;\n]*$/), 0));
  return BY_BEFORE.test(before) && OWED_IN_CLAUSE.test(clause);
}

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
 * None of them has the past-tense verb `PRIOR_STEP_BEFORE` waits for, and the
 * topic between the label and the date is longer than it allows — so the
 * coaching's date was offered as a date for the form ("You mentioned more than
 * one date (1/1, 10/10). Which date goes on the form?") and never reached the
 * prior-actions line. A step named "previous / prior / past / last …" is
 * history wherever its date sits: up to five words of topic after the label,
 * or the label right after the date. The topic words stop at anything that
 * starts an account ("previous coaching was about lateness and she was late
 * on 10/20" leaves 10/20 an incident date).
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
 * the prior actions and offered as a date for the form ("You mentioned more
 * than one date (9/1, 10/20)…"). The list runs from one dated item to the
 * next across a comma, "and", "&" or a new bulleted line, each item up to
 * five words before its date; it ends at the end of the sentence, or at
 * anything that starts an account ("…1-1-26, late again on 10/20").
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

/*
 * "PRIOR COACHING JBA POLICY MANUAL 1-1-26, VERBAL CA 9-1-26" — THE SAME
 * LIST WITHOUT THE COLON. QA, 22 Oct 2026: given as its own answer, the verbal
 * CA was dropped from the prior actions. Without a colon or a dash the label
 * does not open a list of anything; an item that names its own step ("verbal
 * ca", "written warning", "coaching") straight after a labelled step is still
 * history, and anything else is read as before.
 */
const NAMES_A_STEP = new RegExp(String.raw`\b${STEP_NOUN}\b`, "i");

/*
 * ============================================================================
 * PRIOR_ACTIONS_PARSE_ENABLED — PRIOR ACTIONS AS MANAGERS WRITE THEM
 * ============================================================================
 *
 * QA, 25 Oct 2026 (approved by Pau the same day). With the flag on:
 *
 *   "prior verbal 9-1-26", "previous verbal …", "prior written …" — the level
 *   alone names the step, as "had a verbal on 9-1-26" already did.
 *
 *   "Previous coaching was a Verbal CA 10-1-26", "Her prior coaching is her
 *   policy manual ackwnelegement on 9/01" — an article or a possessive starts
 *   the topic, and "on" may sit between the topic and the date.
 *
 *   "verbal warning received Open Ended Questions Coaching 9/8/2026, Focus
 *   Item Coaching 9/15/2026, New Product Coaching 9/25/2026" — the step
 *   `PRIOR_STEP_BEFORE` reads opens a list, and each following comma or "and"
 *   item that names a step is history too. Only 9/8 was kept, and 9/15 and
 *   9/25 were offered as the form's date (conv_mvmvlnel251xs4k).
 *
 *   "jba manual 11-1-25", "policy manual acknowledgement on 9/01", "coached on
 *   9/1": a date governed by the manual or its acknowledgement, or by a bare
 *   "coached on", never dates the form ("previous coaching jba manual 11-1-26
 *   … on 10-22-26" then "jba manual 11-1-25" dated the form 2025-11-01).
 *
 *   A later line that is only an earlier step's topic and a new date ("jba
 *   manual 11-1-25") moves that step to the new date.
 */
const LEVEL_STEP = String.raw`(?:final\s+)?(?:verbal|written)(?!\s+up\b)`;
const HISTORY_LABEL_PARSE = String.raw`(?:previous|prior|past|last|earlier)\s+(?:${STEP_NOUN}|${LEVEL_STEP})`;
const LABELLED_STEP_BEFORE_PARSE = new RegExp(
  String.raw`\b${HISTORY_LABEL_PARSE}\b\s*(?:(?:was|were|is|on|dated|signed)\s+|(?<marker>[:=\-–—])\s*(?:(?:[-*•]|\d+[.)])\s+)?)?(?<topic>(?:${TOPIC_WORD}\s+){0,5})(?<tail>(?:on|dated|signed)\s+)?$`,
  "i",
);
const LABELLED_STEP_AFTER_PARSE = new RegExp(
  String.raw`^\s*(?:for|as|was|were|is|[:=\-–—])?\s*(?:(?:the|her|his|their|a|an)\s+)?${HISTORY_LABEL_PARSE}\b`,
  "i",
);
const NAMES_A_STEP_PARSE = new RegExp(String.raw`\b(?:${STEP_NOUN}|${LEVEL_STEP}|ack\w*|acknowledg\w*)\b`, "i");
/** "a Verbal CA", "her policy manual …": the article or possessive is not part of what it was about. */
const TOPIC_ARTICLE = /^(?:a|an|the|her|his|their)\s+/i;
/** "jba manual 11-1-25", "policy manual ackwnelegement on 9/01", "policy acknowledgement 9/1". */
const MANUAL_STEP_BEFORE =
  /\b(?:(?:(?:jba|policy|employee)\s+(?:policy\s+)?)?(?:manual|handbook)(?:\s+(?:ack\w*|sign(?:ed|ature)?|review(?:ed)?))?|policy\s+ack\w*)\s*(?:[:=\-–—]\s*)?(?:(?:on|dated|signed)\s+)?$/i;
/** An account of something she failed to do with the manual: that date is the incident's. */
const MANUAL_FAILURE = /\b(?:fail\w*|didn['’]?t|did\s+not|never|not|missed|refused|forgot|overdue|late|due|deadline|by)\b/i;
/** "coached on 9/1" with nobody saying they held it: an earlier step. "I coached her on 10/16" is `HELD_COACHING_BEFORE`'s. */
const COACHED_ON_BEFORE = /\bcoached\s+on\s+$/i;

/*
 * "PREVIOUS COACHING. VERBAL (06/25/2026) AND WRITTEN (07/28/2026)" (QA, 25 Oct
 * 2026, Ask Sunny production). The label ends its own sentence and heads the
 * items after it, each a step with its date in brackets. No reader saw a step:
 * the full stop closed the label, and the brackets sat between each item and
 * its date. Both priors were missing from the card, and the chat asked which
 * of 6/25, 7/28 and 10/15 goes on the form (or dated it 6/25). With the flag
 * on, a label closed by a full stop heads the next item when that item names a
 * step ("verbal", "written ca", "coaching"), and the list continues only with
 * items that name a step; "previous coaching. she was late (10/20/2026)" opens
 * nothing. A bracket around a date is not between the item and its date.
 */
const HEADED_STEP_BEFORE = new RegExp(
  String.raw`\b${HISTORY_LABEL_PARSE}\s*\.\s+(?<topic>(?:${TOPIC_WORD}\s+){1,5})(?<tail>(?:on|dated|signed)\s+)?$`,
  "i",
);
/** "verbal (" → "verbal ", ") and written (" → " and written ": the brackets around a date. */
function withoutDateBrackets(text: string, leading: boolean): string {
  const trailing = text.replace(/\(\s*$/, "");
  return leading ? trailing.replace(/^\s*\)/, "") : trailing;
}

/*
 * "…for being late to open on 10-20, she was coached on 9-15 for being late,
 * no payroll" (conv_mvnoiw8n2kfbcvc, QA 25 Oct 2026). A dashed date needs a
 * year to be read at all (`DATE_IN_TEXT`), so the coaching was no prior action
 * and the intake's yearless reader took "on 9-15", the last one, as the
 * incident. With the flag on, the earlier-step reader also reads a yearless
 * "9-15" (never "10-12 hours"), and `blankYearlessStepDates` keeps such a step's
 * date off the form. A coaching the manager says they held ("I coached her on
 * 10-16") is `HELD_COACHING_BEFORE`'s and is left as it was.
 */
const YEARLESS_DASHED = /(?<![\d/.-])(\d{1,2})-(\d{1,2})(?![\d/-]|\.\d)/g;
const RANGE_AFTER = /^\s*(?:min|mins|minutes|hrs?|hours?|days?|weeks?|months?|years?|people|times|x\b|%|am\b|pm\b|dollars?)/i;

/** `dates` with every yearless dashed month-day in the text added, in order (flag on only). */
function withYearlessDates(text: string, dates: readonly DateInText[], today: string, keepHeld = false): DateInText[] {
  const year = Number(/^(\d{4})-/.exec(today)?.[1]);
  if (!Number.isFinite(year)) return [...dates];
  const extra: DateInText[] = [];
  for (const match of text.matchAll(YEARLESS_DASHED)) {
    const index = match.index ?? 0;
    const end = index + match[0].length;
    if (RANGE_AFTER.test(text.slice(end, end + 12))) continue;
    // "I coached her on 10-16": a coaching the manager held is read as it was before.
    // PRIOR_SENTENCE_FIX_ENABLED on a Corrective Action: that coaching is a prior step too (`heldStepSpans`).
    if (!keepHeld && HELD_COACHING_BEFORE.test(text.slice(0, index))) continue;
    if (dates.some((found) => index < found.end && end > found.index)) continue;
    const iso = calendarIso(year, Number(match[1]), Number(match[2]));
    if (iso) extra.push({ iso, index, end });
  }
  return extra.length === 0 ? [...dates] : [...dates, ...extra].sort((left, right) => left.index - right.index);
}

/** Every date in the text, a yearless dashed "9-15" included with the flag on; `datesInText` with it off. */
export function datesInTextWithYearless(text: string, today: string): DateInText[] {
  const dates = datesInText(text, today);
  return priorActionsParseEnabled() ? withYearlessDates(text ?? "", dates, today) : dates;
}

/**
 * The text with each yearless dashed date that names an earlier step ("she
 * was coached on 9-15") blanked to spaces, so a reader of yearless dates
 * never takes it for the incident. Unchanged with PRIOR_ACTIONS_PARSE_ENABLED
 * off, and a held coaching ("I coached her on 10-16") is never blanked
 * (`withYearlessDates` leaves it out, and `manualOrCoachedDate` needs nobody to
 * say they held it).
 */
export function blankYearlessStepDates(text: string, today: string): string {
  if (!priorActionsParseEnabled() || !text) return text;
  const read = new Set(datesInText(text, today).map((found) => found.index));
  const steps = new Set(stepSpans(text, today).map((span) => span.index));
  let out = text;
  for (const found of withYearlessDates(text, [], today, sentenceFixOn(text))) {
    if (read.has(found.index)) continue;
    if (!steps.has(found.index) && !manualOrCoachedDate(text.slice(0, found.index))) continue;
    out = out.slice(0, found.index) + " ".repeat(found.end - found.index) + out.slice(found.end);
  }
  return out;
}

function clauseBefore(before: string): string {
  return before.slice(Math.max(before.search(/[^.;\n]*$/), 0));
}

/** A date governed by the manual, its acknowledgement, or a bare "coached on" (flag on only). */
function manualOrCoachedDate(before: string): boolean {
  const clause = clauseBefore(before);
  if (MANUAL_STEP_BEFORE.test(clause) && !MANUAL_FAILURE.test(clause)) return true;
  return COACHED_ON_BEFORE.test(clause) && !/\b(?:i|we)\b/i.test(clause);
}

/**
 * Later lines that only restate an earlier labelled step's topic with a new
 * date: restated date's offset → the labelled step's offset. Up to five words,
 * every one of them in that step's topic, then the date and nothing else.
 */
function restatedSteps(text: string, dates: readonly DateInText[], labelled: ReadonlyMap<number, LabelledStep>): Map<number, number> {
  const restated = new Map<number, number>();
  for (const line of text.matchAll(/[^\n]+/g)) {
    const start = line.index ?? 0;
    const own = dates.filter((found) => found.index >= start && found.end <= start + line[0].length);
    if (own.length !== 1) continue;
    const date = own[0]!;
    if (labelled.has(date.index)) continue;
    if (text.slice(date.end, start + line[0].length).trim().replace(/[.]+$/, "") !== "") continue;
    const words = text.slice(start, date.index).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (words.length === 0 || words.length > 5) continue;
    let target: number | null = null;
    for (const [index, step] of labelled) {
      if (index >= start) continue;
      const topic = step.topic.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      if (topic.length > 0 && words.every((word) => topic.includes(word))) target = index;
    }
    if (target !== null) restated.set(date.index, target);
  }
  return restated;
}

/** Every date in `dates` that is a labelled earlier step, by its offset, with its label and topic. */
function labelledSteps(text: string, dates: readonly DateInText[], today?: string): Map<number, LabelledStep> {
  if (priorActionsParseEnabled()) return labelledStepsParsed(text, dates, today);
  const found = new Map<number, LabelledStep>();
  // The label of the list the previous date was an item of, while the list is still open.
  let list: string | null = null;
  // An unmarked label: only an item naming its own step continues it.
  let listNeedsStep = false;
  let previousEnd = 0;
  for (const date of dates) {
    const item = list === null ? null : LIST_ITEM_BEFORE.exec(text.slice(previousEnd, date.index));
    previousEnd = date.end;
    if (list !== null && item && (!listNeedsStep || NAMES_A_STEP.test(item[1] ?? ""))) {
      found.set(date.index, {
        named: listNeedsStep ? (item[1] ?? "") : `${list}${item[1] ?? ""}`,
        topic: listNeedsStep ? "" : (item[1] ?? "").trim(),
      });
      continue;
    }
    list = null;
    const before = text.slice(0, date.index);
    const ahead = LABELLED_STEP_BEFORE.exec(before);
    if (ahead) {
      const topic = ahead.groups?.topic ?? "";
      found.set(date.index, { named: ahead[0], topic: topic.trim() });
      list = ahead[0].slice(0, ahead[0].length - topic.length);
      listNeedsStep = !ahead.groups?.marker;
      continue;
    }
    const after = LABELLED_STEP_AFTER.exec(text.slice(date.end));
    if (after) found.set(date.index, { named: after[0].trim(), topic: (TOPIC_BEFORE_DATE.exec(before)?.[1] ?? "").trim() });
  }
  return found;
}

/**
 * `labelledSteps` with PRIOR_ACTIONS_PARSE_ENABLED on: the level alone names
 * a step, the topic drops its article, "on" may precede the date, and a step
 * `PRIOR_STEP_BEFORE` reads opens a list its following step items continue.
 */
function labelledStepsParsed(text: string, dates: readonly DateInText[], today?: string): Map<number, LabelledStep> {
  const found = new Map<number, LabelledStep>();
  let list: string | null = null;
  let listNeedsStep = false;
  let previousEnd = 0;
  for (const date of dates) {
    const item = list === null ? null : LIST_ITEM_BEFORE.exec(withoutDateBrackets(text.slice(previousEnd, date.index), true));
    previousEnd = date.end;
    if (list !== null && item && (!listNeedsStep || NAMES_A_STEP_PARSE.test(item[1] ?? ""))) {
      const words = (item[1] ?? "").replace(TOPIC_ARTICLE, "");
      found.set(date.index, {
        named: listNeedsStep ? (item[1] ?? "") : `${list}${item[1] ?? ""}`,
        topic: listNeedsStep ? "" : words.trim(),
      });
      continue;
    }
    list = null;
    const before = text.slice(0, date.index);
    const unbracketed = withoutDateBrackets(before, false);
    const ahead = LABELLED_STEP_BEFORE_PARSE.exec(unbracketed);
    if (ahead) {
      const topic = ahead.groups?.topic ?? "";
      const tail = ahead.groups?.tail ?? "";
      found.set(date.index, { named: ahead[0], topic: topic.replace(TOPIC_ARTICLE, "").trim() });
      list = ahead[0].slice(0, ahead[0].length - topic.length - tail.length);
      listNeedsStep = !ahead.groups?.marker;
      continue;
    }
    // "previous coaching. verbal (06/25/2026) and written (07/28/2026)": the label heads the items that name a step.
    const headed = HEADED_STEP_BEFORE.exec(unbracketed);
    if (headed && NAMES_A_STEP_PARSE.test(headed.groups?.topic ?? "")) {
      const topic = headed.groups?.topic ?? "";
      found.set(date.index, { named: headed[0], topic: topic.replace(TOPIC_ARTICLE, "").trim() });
      list = "";
      listNeedsStep = true;
      continue;
    }
    const after = LABELLED_STEP_AFTER_PARSE.exec(text.slice(date.end));
    if (after) {
      found.set(date.index, { named: after[0].trim(), topic: (TOPIC_BEFORE_DATE.exec(before)?.[1] ?? "").replace(TOPIC_ARTICLE, "").trim() });
      continue;
    }
    // "received … Coaching 9/8/2026, Focus Item Coaching 9/15/2026": the step read before the date opens a list.
    const prior = PRIOR_STEP_BEFORE.exec(before);
    const future = today !== undefined && date.iso > today && prior !== null && /^(?:was|were)\b/i.test(prior[0]);
    if (prior && !ISSUES_THIS_FORM.test(prior[0]) && !future) {
      list = "";
      listNeedsStep = true;
    }
  }
  return found;
}

function isOtherDate(
  text: string,
  found: DateInText,
  labelled: ReadonlyMap<number, LabelledStep>,
  restated?: ReadonlyMap<number, number>,
): boolean {
  const before = text.slice(0, found.index);
  if (priorActionsParseEnabled() && (manualOrCoachedDate(before) || restated?.has(found.index))) return true;
  return (
    FOLLOW_UP_BEFORE.test(before) ||
    PRIOR_STEP_BEFORE.test(before) ||
    OWNED_STEP_BEFORE.test(before) ||
    DID_STEP_BEFORE.test(before) ||
    talkedStep(before) ||
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
export function priorSteps(
  text: string,
  today: string,
): { iso: string; named: string; topic?: string; about?: string }[] {
  /*
   * A DATE THE MANAGER CORRECTED IS THE STEP'S DATE: "the verbal ca was on
   * 9-2-26 not 9-1-26" moves the verbal CA listed on 9/1 to 9/2, once.
   */
  const corrected = correctedDates(text, today);
  const seen = new Set<string>();
  return stepsAsWritten(text, today)
    .map((step) => (corrected.has(step.iso) ? { ...step, iso: corrected.get(step.iso)! } : step))
    .filter((step) => {
      const key = `${step.iso}|${step.named.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/*
 * ============================================================================
 * "ON 10-19, NOT 10-20" — A DATE THE MANAGER CORRECTED
 * ============================================================================
 *
 * QA, 22 Oct 2026: a correction typed before the form was created ("the
 * verbal ca was on 9-2-26 not 9-1-26") left the wrong date on the history
 * line and offered both as the form's date. A sentence with two dates, one of
 * them after "not" / "instead of" / "rather than", retracts that one and puts
 * the other in its place. Returns retracted → replacement.
 */
const RETRACTS_BEFORE = /\b(?:not|instead\s+of|rather\s+than|isn['’]?t|wasn['’]?t|was\s+not|is\s+not)\s*(?:on\s+)?$/i;

export function correctedDates(text: string, today: string): Map<string, string> {
  const corrected = new Map<string, string>();
  for (const sentence of (text ?? "").split(/(?<=[.!?;\n])\s*/)) {
    const dates = datesInText(sentence, today);
    if (dates.length !== 2) continue;
    const [first, second] = dates as [DateInText, DateInText];
    const firstOut = RETRACTS_BEFORE.test(sentence.slice(0, first.index));
    const secondOut = RETRACTS_BEFORE.test(sentence.slice(0, second.index));
    if (secondOut && !firstOut && first.iso !== second.iso) corrected.set(second.iso, first.iso);
    else if (firstOut && !secondOut && first.iso !== second.iso) corrected.set(first.iso, second.iso);
  }
  return corrected;
}

type WrittenStep = { iso: string; named: string; topic?: string; about?: string };

function stepsAsWritten(text: string, today: string): WrittenStep[] {
  return stepSpans(text, today).map((span) => span.step);
}

/** Each earlier step with the offset of its date. A yearless "9-15" is read too with the flag on. */
function stepSpans(text: string, today: string, context?: string): { step: WrittenStep; index: number }[] {
  const sentenceFix = sentenceFixOn(context ?? text);
  const dates = priorActionsParseEnabled()
    ? withYearlessDates(text, datesInText(text, today), today, sentenceFix)
    : datesInText(text, today);
  const steps = labelledSteps(text, dates, today);
  // "jba manual 11-1-25" after "previous coaching jba manual 11-1-26": the later date is that step's (flag on only).
  const movedTo = new Map<number, DateInText>();
  if (priorActionsParseEnabled()) {
    for (const [from, to] of restatedSteps(text, dates, steps)) {
      const date = dates.find((found) => found.index === from);
      if (date) movedTo.set(to, date);
    }
  }
  const spans = dates.flatMap((found): { step: WrittenStep; index: number }[] => {
    const at = (step: WrittenStep) => [{ step, index: found.index }];
    const before = text.slice(0, found.index);
    const about = reasonAfter(text.slice(found.end));
    const withAbout = about ? { about } : {};
    // "previous coaching was jba policy manual 1-1-26": what it was about, as the manager wrote it.
    const labelled = steps.get(found.index);
    if (labelled) {
      const moved = movedTo.get(found.index);
      return at({
        iso: moved ? earlierYearIfAhead(moved, text, today) : earlierYearIfAhead(found, text, today),
        named: labelled.named,
        ...(labelled.topic ? { topic: labelled.topic } : withAbout),
      });
    }
    const match = PRIOR_STEP_BEFORE.exec(before);
    // "she was late, give her a written warning on 10/2": the cue was the incident's, the warning is this form's.
    if (match && !ISSUES_THIS_FORM.test(match[0])) {
      // A date ahead of today is last year's only after a verb of receiving one ("got … on 12/20" in
      // January); after a bare "was/were" it is a date still to come, and not an earlier step.
      if (found.iso > today && /^(?:was|were)\b/i.test(match[0])) return [];
      return at({ iso: earlierYearIfAhead(found, text, today), named: match[0], ...withAbout });
    }
    // A step that is hers already counts only on a day before today — never rolled back a year.
    const owned = OWNED_STEP_BEFORE.exec(before);
    if (owned && !ISSUES_THIS_FORM.test(owned[0]) && found.iso < today) {
      return at({ iso: found.iso, named: owned[0], ...withAbout });
    }
    return [];
  });
  if (!sentenceFix) return spans;
  const held = heldStepSpans(text, dates, today, new Set(spans.map((span) => span.index)));
  return held.length === 0 ? spans : [...spans, ...held].sort((left, right) => left.index - right.index);
}

/*
 * ============================================================================
 * PRIOR_SENTENCE_FIX_ENABLED — "I COACHED HER ON 10-16" ON A CORRECTIVE ACTION
 * ============================================================================
 *
 * QA, 26 Oct 2026 (Ask Sunny production, 8365e21f): "create a ca for … she was
 * late on 10-5 and 10-15. i coached her on 10-16 about being late" had no
 * Prior actions row, and "ca for …, coached her 10-16, written warning on
 * 10-20" was dated 10/20, the written warning's day. On a Corrective Action
 * the coaching a manager says they held is the history the form escalates
 * from (on a Coaching Form it is the form's own event: `HELD_COACHING_BEFORE`,
 * left as it was). With the flag on, and only where the conversation names a
 * Corrective Action and no Coaching Form:
 *
 *   "(i) (verbally) coached / counseled / warned her|him|them <date>" is a
 *   prior step, unless the clause negates it ("i never coached her …"), names
 *   someone else ("i coached Corvin Mallow on 10-16"), or holds anything but
 *   "on", "dated" or what it was about between the pronoun and the date
 *   ("coached her when she was late on 10/1"; QA-7, 26 Oct 2026: "i coached
 *   her coworker, not her, on 10-16" and "i coached her on 10-16 and <another
 *   name> on 10-17" are not hers).
 *
 *   Each comma or "and" item straight after it that names a step, holds only
 *   step words, and has its own date ("…, written warning on 10-20") is one
 *   too; anything else (", she was late again on 10-20", "and <a name> on
 *   10-17") ends the list.
 */
const NAMES_CORRECTIVE_ACTION = /\b(?:cas?|c\/a|corrective\s+actions?|dpoa)\b/i;
const NAMES_COACHING_FORM = /\bcoaching\s+(?:form|document|doc)\b/i;
const HELD_STEP_BEFORE =
  /\b(?:(?:i|we)\s+(?:(?:verbally|formally|also|then|just|already)\s+)?)?(?:verbally\s+)?(?:coached|counsel(?:ed|led)|warned)\s+(?:her|him|them|the\s+employee)\b([^.;\n]{0,30})$/i;
const HELD_STEP_VERB = /\b(?:coached|counsel(?:ed|led)|warned)\s+(?:her|him|them|the\s+employee)\b/gi;
/** Between "coached her" and the date: nothing, "on", "dated", or what it was about, then "on". */
const HELD_STEP_GAP = /^\s*(?:(?:again\s+|back\s+)?(?:on|dated)\s*|(?:about|regarding|for|over)\s+[a-z' -]{1,30}?\s+on\s*)?$/i;
/** The only words a list item after a held step may hold: the step, a level, an article, and "on". */
const STEP_ITEM_WORDS =
  /^(?:a|an|the|another|also|then|her|his|their|final|verbal|written|warnings?|coachings?|coached|ca|cas|c\/a|corrective|actions?|write-?ups?|written\s+up|disciplin\w*|ack\w*|acknowledg\w*|policy|manual|jba|on|dated|signed)$/i;
const NEGATED_STEP = /\b(?:never|not|didn['’]?t|haven['’]?t|hasn['’]?t|wasn['’]?t)\b[^.;,\n]*$/i;

/** The flag is on and the conversation is a Corrective Action's, not a Coaching Form's. */
function sentenceFixOn(text: string): boolean {
  return priorSentenceFixEnabled() && NAMES_CORRECTIVE_ACTION.test(text ?? "") && !NAMES_COACHING_FORM.test(text ?? "");
}

/** The held coachings and the step items after them, for dates no other reading took (`taken`). */
function heldStepSpans(
  text: string,
  dates: readonly DateInText[],
  today: string,
  taken: ReadonlySet<number>,
): { step: WrittenStep; index: number }[] {
  const found: { step: WrittenStep; index: number }[] = [];
  let open = false;
  let previousEnd = 0;
  for (const date of dates) {
    const gap = text.slice(previousEnd, date.index);
    previousEnd = date.end;
    if (taken.has(date.index)) {
      open = false;
      continue;
    }
    const about = reasonAfter(text.slice(date.end));
    const withAbout = about ? { about } : {};
    const clause = clauseBefore(text.slice(0, date.index));
    // The held step nearest the date: "i coached her on 10-1 and i coached her on 10-16".
    const verbs = [...clause.matchAll(HELD_STEP_VERB)];
    const from = verbs.at(-1)?.index ?? 0;
    const near = HELD_STEP_BEFORE.exec(clause.slice(Math.max(0, clause.lastIndexOf(" ", Math.max(0, from - 2)) - 20)));
    const held = near ? Object.assign(near, { index: clause.length - near[0].length }) : null;
    const heldGap = held?.[1] ?? "";
    if (held && HELD_STEP_GAP.test(heldGap) && !ACCOUNT_IN_TOPIC.test(heldGap) && !NEGATED_STEP.test(clause.slice(0, held.index))) {
      found.push({ index: date.index, step: { iso: earlierYearIfAhead(date, text, today), named: held[0], ...withAbout } });
      open = true;
      continue;
    }
    const item = open ? LIST_ITEM_BEFORE.exec(gap) : null;
    const words = item?.[1] ?? "";
    const onlyStepWords = words.trim().split(/\s+/).every((word) => STEP_ITEM_WORDS.test(word));
    if (item && onlyStepWords && NAMES_A_STEP_PARSE.test(words) && !ISSUES_THIS_FORM.test(words) && date.iso <= today) {
      found.push({ index: date.index, step: { iso: date.iso, named: words.trim(), ...withAbout } });
      continue;
    }
    open = false;
  }
  return found;
}

/**
 * PRIOR_SENTENCE_FIX_ENABLED: every date the manager gave, a yearless dashed
 * "10-15" and a held coaching's "10-16" included, for the draft's date check
 * (`form-date-grounding.ts`). `datesInText` with the flag off.
 */
export function managerDatesForDraft(text: string, today: string): DateInText[] {
  const dates = datesInText(text, today);
  return priorSentenceFixEnabled() && text ? withYearlessDates(text, dates, today, true) : dates;
}

/*
 * PRIOR_SENTENCE_FIX_ENABLED — THE MANAGER'S INCIDENT DATES (coordinator's
 * ruling, 26 Oct 2026, both apps): every date the manager gave for what
 * happened, yearless ("10-5") or written out, in order. Never an earlier
 * step's (`stepSpans`, a held coaching on a Corrective Action included), a
 * follow-up's, a deadline's, one the manager corrected away, or a day still
 * to come; and a range ("from 10-5 to 10-9") is one incident, its first day.
 * Two or more of these are asked about; one dates the form. `context` (the
 * whole conversation) says whether this is a Corrective Action. Empty with
 * the flag off.
 */
const RANGE_GAP = /^\s*(?:to|through|thru|until|till|[-–—])\s*$/i;

/**
 * "i coached her on 10-16 and <another name> on 10-17": a date later in the
 * clause of a coaching, counseling or warning, with no account of what she
 * did in between, is that step's (anyone's), never an incident date.
 */
const STEP_VERB = /\b(?:coached|counsel(?:ed|led)|warned|talked\s+to|spoke\s+(?:to|with))\b/gi;

function afterHeldStep(text: string, date: DateInText): boolean {
  const clause = clauseBefore(text.slice(0, date.index));
  const verbs = [...clause.matchAll(STEP_VERB)];
  const last = verbs.at(-1);
  return last !== undefined && !ACCOUNT_IN_TOPIC.test(clause.slice((last.index ?? 0) + last[0].length));
}

export function statedIncidentDates(text: string, today: string, context?: string): DateInText[] {
  if (!priorSentenceFixEnabled() || !text) return [];
  const dates = withYearlessDates(text, datesInText(text, today), today, true);
  const labelled = labelledSteps(text, dates, today);
  const steps = new Set(stepSpans(text, today, context).map((span) => span.index));
  const corrected = correctedDates(text, today);
  const found: DateInText[] = [];
  let previous: DateInText | null = null;
  for (const date of dates) {
    const rangeEnd = previous !== null && RANGE_GAP.test(text.slice(previous.end, date.index));
    previous = date;
    if (rangeEnd || steps.has(date.index) || date.iso > today || corrected.has(date.iso)) continue;
    if (isOtherDate(text, date, labelled) || isDeadline(text, date) || afterHeldStep(text, date)) continue;
    found.push(date);
  }
  return found;
}

/*
 * PRIOR_SENTENCE_FIX_ENABLED (QA, 26 Oct 2026): the text without each clause
 * whose dates are all earlier steps' (`priorStepDateOffsets`) — "i coached
 * her on 10-16 about being late", ", written warning on 10-20" — so the
 * incident clause beside it is what an Observation reader sees. A clause that
 * also dates something else stays whole. `dropped` says whether anything was
 * taken out. Unchanged with the flag off.
 */
const CLAUSE_END = /\.(?=\s|$)|(?<!\d)\.(?!\d)|[;!?\n]|,(?!\s*\d{4})/g;

export function withoutPriorStepClauses(text: string, today: string, context: string): { text: string; dropped: boolean } {
  const steps = priorStepDateOffsets(text, today, context);
  if (steps.length === 0) return { text, dropped: false };
  const stepSet = new Set(steps);
  const ends = [...text.matchAll(CLAUSE_END)].map((match) => match.index ?? 0);
  const dates = withYearlessDates(text, datesInText(text, today), today, true);
  const cuts: [number, number][] = [];
  for (const index of steps) {
    const opening = ends.filter((at) => at < index).at(-1) ?? -1;
    const closing = ends.find((at) => at > index) ?? text.length;
    // (Another person's step in the same clause — "and <a name> on 10-17" — is no incident date either.)
    if (dates.some((found) => found.index > opening && found.index < closing && !stepSet.has(found.index) && !afterHeldStep(text, found))) continue;
    const comma = opening >= 0 && text[opening] === ",";
    const from = comma ? opening : opening + 1;
    const to = !comma && text[closing] === "," ? closing + 1 : closing;
    if (!cuts.some(([start, end]) => start === from && end === to)) cuts.push([from, to]);
  }
  if (cuts.length === 0) return { text, dropped: false };
  let out = text;
  for (const [from, to] of [...cuts].sort((left, right) => right[0] - left[0])) out = out.slice(0, from) + out.slice(to);
  return { text: out, dropped: true };
}

/** PRIOR_SENTENCE_FIX_ENABLED: the text with each earlier step's date blanked to spaces (offsets kept). Unchanged with it off. */
export function blankPriorStepDates(text: string, today: string, context?: string): string {
  const steps = new Set(priorStepDateOffsets(text, today, context ?? text));
  if (steps.size === 0) return text;
  let out = text;
  for (const found of withYearlessDates(text, datesInText(text, today), today, true)) {
    if (steps.has(found.index)) out = out.slice(0, found.index) + " ".repeat(found.end - found.index) + out.slice(found.end);
  }
  return out;
}

/** Each yearless "10-15" written out as "10/15/2026", so the written-date readers see it (PRIOR_SENTENCE_FIX_ENABLED callers). */
export function yearlessWrittenOut(text: string, today: string): string {
  let out = "";
  let at = 0;
  for (const found of withYearlessDates(text, [], today, true)) {
    const [year, month, day] = found.iso.split("-");
    out += text.slice(at, found.index) + `${Number(month)}/${Number(day)}/${year}`;
    at = found.end;
  }
  return out + text.slice(at);
}

/**
 * PRIOR_SENTENCE_FIX_ENABLED: the offsets of the earlier steps' dates in
 * `text`, every reading's (`stepSpans`). `context` (the whole conversation)
 * says whether this is a Corrective Action. Empty with the flag off.
 */
export function priorStepDateOffsets(text: string, today: string, context: string): number[] {
  if (!priorSentenceFixEnabled() || !text) return [];
  return stepSpans(text, today, context).map((span) => span.index);
}

/**
 * WHAT AN EARLIER STEP WAS FOR, SAID AFTER ITS DATE: "previous coaching was
 * 9/15 for cell phone use" → "for cell phone use" (HR feedback, 21 Oct 2026,
 * ported from Ask Bubbles: the line read "Coaching — signed 09/15/2026" and
 * lost what it was for). The manager's own words, opening with for / about /
 * regarding / over, to the end of the clause — and not past "and she …",
 * which is the account again. Nothing when the words after the date are
 * anything else.
 */
function reasonAfter(after: string): string | null {
  const match =
    /^\s*,?\s*((?:for|about|regarding|over)\s+[^.;,!?\n]{2,60}?)(?=\s*(?:$|[.;,!?\n]|\s+(?:and|but|then|so)\s+(?:she|he|they|now|today|again|this|it)\b|\s+(?:and|but)\s+(?:was|is|has)\b))/i.exec(
      after,
    );
  return match ? match[1]!.trim() : null;
}

/** An issuing verb between the cue and the warning: the warning is the one being issued now. */
const ISSUES_THIS_FORM =
  /\b(?:give|gives|giving|issue|issues|issuing|needs?|deserves?|requires?|make\s+(?:it|this)|document(?:ing)?|write\s+(?:her|him|them)\s+(?:up|a)|do\s+a|should|will|is\s+dated|dated|effective|deliver\w*|present\w*|sign(?:ing|s)?|schedul\w*|meet(?:ing)?|set\s+for|receive|receives|receiving|this\s+is)\b/i;

/**
 * AN EARLIER STEP CANNOT BE IN THE FUTURE. A month and day with no year take
 * the current one, so "got a verbal warning on 12/20", read on January 5,
 * came out as next December. Where the manager gave no year and the date is
 * after today, it is last year's. A year they typed is kept as typed.
 */
function earlierYearIfAhead(found: DateInText, text: string, today: string): string {
  if (found.iso <= today) return found.iso;
  const typed = text.slice(found.index, found.end);
  const hasYear = /\d{4}/.test(typed) || (typed.match(/[/-]/g)?.length ?? 0) >= 2;
  if (hasYear) return found.iso;
  const year = Number(found.iso.slice(0, 4)) - 1;
  const earlier = `${String(year).padStart(4, "0")}${found.iso.slice(4)}`;
  return isIsoCalendarDate(earlier) ? earlier : found.iso;
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
    const [, isoY, isoM, isoD, slashM, slashD, slashY, dashM, dashD, dashY, name, nameD, nameY, dotM, dotD, dotY] =
      match;
    // The slashed, dashed and dotted U.S. shapes read the same way.
    const numM = slashM ?? dashM ?? dotM;
    const numD = slashD ?? dashD ?? dotD;
    const numY = slashY ?? dashY ?? dotY;
    let iso: string | null = null;

    if (isoY !== undefined) {
      iso = calendarIso(Number(isoY), Number(isoM), Number(isoD));
    } else if (numM !== undefined) {
      const year =
        numY === undefined ? currentYear : numY.length === 2 ? twoDigitYear(Number(numY), currentYear) : Number(numY);
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
 * PRIOR_ACTIONS_PARSE_ENABLED (QA, 25 Oct 2026; ported from the sibling app's
 * conv_mvnt9m172krh73y): a two-digit year never lands in the future. "jba
 * manual 1-1-95" is 1995, not 2095: a year more than one past this one reads
 * as 19YY, any other as 20YY. Off, every two-digit year is 20YY, as before.
 */
function twoDigitYear(yy: number, currentYear: number): number {
  if (!priorActionsParseEnabled()) return 2000 + yy;
  return yy > (currentYear % 100) + 1 ? 1900 + yy : 2000 + yy;
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
  return listIncidentDates(text, today)[0]?.iso ?? null;
}

/**
 * The dates that are not follow-ups, with where each was found — for a caller
 * that tells dates apart by the words in front of them ("effective oct 5"
 * versus the form's own date). `extractFormDate` is this list's first entry.
 */
export function listFormDates(text: string, today: string): { iso: string; index: number }[] {
  const dates = datesInText(text, today);
  const labelled = labelledSteps(text, dates, today);
  const restatedAt = priorActionsParseEnabled() ? restatedSteps(text, dates, labelled) : undefined;
  /*
   * A RETRACTED DATE IS NOBODY'S, and the date that corrects an earlier
   * step's is that step's: neither is offered as the form's date.
   */
  const corrected = correctedDates(text, today);
  const stepDates = new Set(stepsAsWritten(text, today).map((step) => step.iso));
  const correctsAStep = new Set([...corrected].filter(([from]) => stepDates.has(from)).map(([, to]) => to));
  // PRIOR_SENTENCE_FIX_ENABLED: "i coached her on 10/16", "written warning on 10/20" on a Corrective Action date a prior step.
  const held = sentenceFixOn(text) ? new Set(heldStepSpans(text, dates, today, new Set()).map((span) => span.index)) : null;
  const kept = dates
    .filter((found) => !isOtherDate(text, found, labelled, restatedAt))
    .filter((found) => !held?.has(found.index))
    .filter((found) => !corrected.has(found.iso) && !correctsAStep.has(found.iso));
  // A date given to the FORM leads — the last one typed first, so a later "date it 10/21" corrects an earlier one.
  const explicit = kept.filter((found) => isExplicitFormDate(text, found)).reverse();
  return [...explicit, ...kept.filter((found) => !explicit.includes(found))].map(({ iso, index }) => ({ iso, index }));
}

/**
 * The dates that can date the form: `listFormDates` without a deadline ("by
 * the 10-15-26 deadline" names when something was due, see `isDeadline`). A
 * date given to the form leads. The deadline stays in `listFormDates`, which
 * is also the list of the manager's own dates the draft is told to keep.
 */
export function listIncidentDates(text: string, today: string): { iso: string; index: number }[] {
  const dates = datesInText(text, today);
  const deadlines = new Set(dates.filter((found) => isDeadline(text, found)).map((found) => found.index));
  return listFormDates(text, today).filter((found) => !deadlines.has(found.index));
}

function isExplicitFormDate(text: string, found: DateInText): boolean {
  return EXPLICIT_FORM_DATE_BEFORE.test(text.slice(Math.max(0, found.index - 40), found.index));
}

/**
 * The date the manager explicitly gave the FORM ("dated 10/20", "date the
 * form 10/20", "form date: 10/20"), or null. The last one typed wins. Never an
 * earlier step's or a follow-up's date. See `EXPLICIT_FORM_DATE_BEFORE`.
 */
export function explicitFormDate(text: string, today: string): string | null {
  const dates = datesInText(text, today);
  const labelled = labelledSteps(text, dates, today);
  const restated = priorActionsParseEnabled() ? restatedSteps(text, dates, labelled) : undefined;
  const explicit = dates.filter((found) => !isOtherDate(text, found, labelled, restated) && isExplicitFormDate(text, found));
  return explicit.length > 0 ? explicit[explicit.length - 1]!.iso : null;
}

/**
 * The days the manager says they HELD a coaching conversation ("I coached her
 * on 10/16"), oldest first, none in the future — the dates a Coaching Form
 * documents. A labelled earlier one ("previous coaching 9/1", "I already
 * coached her on 9/1") is history and not listed. See `HELD_COACHING_BEFORE`.
 */
export function heldCoachingDates(text: string, today: string): string[] {
  const dates = datesInText(text, today);
  const labelled = labelledSteps(text, dates, today);
  const held = dates.filter((found) => {
    if (found.iso > today || labelled.has(found.index)) return false;
    const before = text.slice(0, found.index);
    const clause = before.slice(Math.max(before.search(/[^.;\n]*$/), 0));
    return HELD_COACHING_BEFORE.test(before) && !EARLIER_CUE.test(clause);
  });
  return [...new Set(held.map((found) => found.iso))].sort();
}

/*
 * ============================================================================
 * A LATER TURN THAT CORRECTS THE DATE DATES THE FORM
 * ============================================================================
 *
 * QA, 22 Oct 2026: "the meeting was actually on 10-19-26" after an account
 * dated 10-20 left the form dated 10-20 — the first date in the conversation.
 * The latest turn after the first that says it corrects ("actually",
 * "sorry", "should be", "wrong", "not …") and gives one incident date, and
 * does not add another incident, is the form's date. Null when none does.
 */
/*
 * QA, 22 Oct 2026, round 3: "wait, the meeting was 10/19/26" after "… for
 * missing the 10/20/26 meeting" was dated 10/20.
 */
const CORRECTS_DATE =
  /\b(?:actually|instead|wrong|correction|i\s+meant|i\s+mean|meant\s+to\s+say|should\s+(?:be|have\s+been|say|read)|sorry|oops|typo|my\s+(?:mistake|bad)|wait|scratch\s+that|change\s+the\s+date|happened\s+on|not\s+(?:on\s+)?\d|(?:it|that|the\s+(?:meeting|incident|date|shift|day))\s+(?:was|is)\s+(?:on\s+)?(?=\d))/i;
const ADDS_AN_INCIDENT = /\b(?:also|too|again|another|as\s+well|plus|and\s+then)\b/i;

export function correctedFormDate(turns: readonly string[], today: string): string | null {
  // Read against the whole conversation, so a corrected earlier step's date is never the form's.
  const incidents = new Set(listFormDates(turns.join("\n\n"), today).map((found) => found.iso));
  let date: string | null = null;
  for (const turn of turns.slice(1)) {
    // "wait, was it 10/19/26?" asks; it corrects nothing (QA, 22 Oct 2026, round 3).
    if (!CORRECTS_DATE.test(turn) || ADDS_AN_INCIDENT.test(turn) || /\?\s*$/.test(turn.trim())) continue;
    const own = [...new Set(listFormDates(turn, today).map((found) => found.iso))].filter(
      (iso) => iso <= today && incidents.has(iso),
    );
    if (own.length === 1) date = own[0]!;
  }
  return date;
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
