/**
 * ============================================================================
 * COACHING IS NOT ALWAYS ABOUT A PROBLEM
 * ============================================================================
 *
 * Feedback: Sunny framed every coaching form as a "concern". Coaching is also
 * proactive alignment, training, expectation-setting, reinforcement of good
 * work and development — and a training session written up as a performance
 * concern is a finding on somebody's file that nobody made.
 *
 * Two halves, the same shape as every other drafting rule here:
 *
 *   THE PROMPT says which register to write in, and that the manager's own
 *   words decide it.
 *
 *   THE GUARD holds where the prompt is only a request. When the manager's
 *   notes carry NO sign of a shortfall — nothing late, missed, wrong, repeated
 *   or complained about — the Coaching Form's "Underperformance" box is not
 *   ticked, and a drafted sentence that labels the conversation a concern,
 *   issue, problem or failure is removed. When the notes DO describe a
 *   shortfall, nothing here changes anything.
 *
 * SCOPED BY KEY to the Coaching Form (`coaching_type`, `coaching_details`,
 * `other_topic`), which is the one template whose type of coaching is a
 * choice between correction and training. The corrective forms, the EPPs and
 * the follow-up form are untouched.
 */

/*
 * ============================================================================
 * SIGNS IN THE MANAGER'S OWN WORDS THAT SOMETHING FELL SHORT — IN CONTEXT
 * ============================================================================
 *
 * PRODUCTION QA OF PR #81: "Quick reminder going over the bed sanitizing steps
 * again before the new checklist starts" switched this guard off, because
 * "again" was on the list on its own — as were "still" and "missing". Those
 * words describe a refresher ("again as a refresher"), a rollout ("still being
 * rolled out") or a precaution ("make sure she's not missing any steps") at
 * least as often as a shortfall, and one of them was enough to let a
 * training session be ticked Underperformance.
 *
 * THREE KINDS OF EVIDENCE NOW, and only the first is a word on its own:
 *
 *   UNAMBIGUOUS     late, skipped, forgot, refused, rude, violation, written
 *                   up… — unless the manager negated it ("hasn't missed a
 *                   shift", "no complaints").
 *   A DUTY NOT DONE "didn't / doesn't / wasn't …" followed by something a
 *                   person does at work ("didn't wipe", "isn't following").
 *                   "The new checklist isn't out yet" is not one.
 *   CONTEXT WORDS   "still", "again", "keeps" and "missing" count only beside
 *                   a shortfall: "still missing", "still late", "keeps
 *                   forgetting", "missing from yesterday's checklist".
 */
const UNAMBIGUOUS_SHORTFALL =
  /\b(?:late|tardy|tardiness|missed|forgot|forgets|forgetting|failed|failing|fails?\s+to|refus\w*|rude|complain\w*|complaints?|mistakes?|errors?|wrong|poor(?:ly)?|struggl\w*|skipp\w*|skips|ignor\w*|careless|unprofessional|unsanitized|uncleaned|no[- ]call|no[- ]show|absent|left\s+early|incorrect\w*|improper\w*|unsanitary|dirty|underperform\w*|slipping|declin\w*|violat\w*|warnings?|written\s+up|write[- ]up|behind|issues?|concerns?|problems?|below\s+(?:standard|expectations?|goal|target)|low\s+(?:sales|numbers|scores?|conversion|performance))\b/gi;

/** "no complaints", "hasn't missed a shift", "never late", "without any issues". */
const NEGATED_BEFORE =
  /(?:\b(?:no|not|never|without|zero|nothing|didnt|doesnt|dont|hasnt|havent|hadnt|wasnt|werent|isnt|arent|wont|cant)|n['’]t)\s+(?:\w+\s+)?$/i;

const DUTY_NOT_DONE =
  /\b(?:didn'?t|did\s+not|doesn'?t|does\s+not|don'?t|do\s+not|wasn'?t|was\s+not|weren'?t|were\s+not|isn'?t|is\s+not|aren'?t|are\s+not|haven'?t|hasn'?t|has\s+not|won'?t|not)\s+(?:\w+\s+)?(?:follow\w*|do(?:ing)?|complet\w*|meet\w*|clean\w*|sanitiz\w*|sanitis\w*|wip\w*|us(?:e|ing)|offer\w*|ask\w*|greet\w*|show(?:ing)?\s+up|clock\w*|call\w*|wear\w*|finish\w*|turn\w*\s+in|initial\w*|sign\w*|record\w*|log\w*|check\w*|tell\w*|answer\w*|respond\w*|arriv\w*|come|coming|stay\w*|return\w*|on\s+time|in\s+uniform|in\s+dress\s+code|listen\w*|mention\w*|engag\w*)\b/i;

const IN_CONTEXT_SHORTFALL: readonly RegExp[] = [
  /\bstill\s+(?:late|missing|not\b|isn'?t|doesn'?t|hasn'?t|won'?t|forget\w*|skip\w*|struggl\w*|leav\w*|com\w*\s+in\s+late|needs?\s+(?:reminders?|to\s+be\s+reminded|help\s+with)|making\s+(?:the\s+same\s+)?mistakes?|us\w*\s+(?:her|his|their)\s+phone)\b/i,
  /\b(?:keeps?|kept)\s+(?:on\s+)?(?:forget\w*|skip\w*|miss\w*|com\w*\s+in\s+late|being\s+late|leav\w*|not\b|ignor\w*)/i,
  /(?<!\b(?:not|never|without)\s)(?<!n't\s)\bmissing\s+from\b/i,
  /\b(?:is|are|was|were|been|still|keeps?|kept|often|always|left|went)\s+missing\b/i,
];

/** Whether the manager's notes describe a shortfall, read in context. */
function describesShortfall(notes: string): boolean {
  const text = notes ?? "";
  for (const match of text.matchAll(UNAMBIGUOUS_SHORTFALL)) {
    const before = text.slice(Math.max(0, (match.index ?? 0) - 24), match.index ?? 0);
    if (!NEGATED_BEFORE.test(before)) return true;
  }
  if (DUTY_NOT_DONE.test(text)) return true;
  return IN_CONTEXT_SHORTFALL.some((pattern) => pattern.test(text));
}

/** Labels that turn a conversation into a finding. */
const DEFICIT_FRAMING =
  /\b(?:concerns?|concerning|issues?|problems?|problematic|deficien\w*|shortcomings?|underperform\w*|under-perform\w*|fell short|falls? short|failed to|fails? to|failure to|failing to|poor|unacceptable|not meeting|did not meet|does not meet|below (?:expectations|standard))\b/i;

export const COACHING_TYPE_KEY = "coaching_type";
const UNDERPERFORMANCE = "underperformance";
const FRAMED_TEXT_KEYS: ReadonlySet<string> = new Set(["coaching_details", "other_topic"]);

export function notesDescribeShortfall(notes: string): boolean {
  return describesShortfall(notes);
}

function splitSentences(line: string): string[] {
  return line.split(/(?<=[.!?])\s+(?=\S)/).filter((part) => part.trim() !== "");
}

/** Removes sentences that label the conversation a concern. Labels on their own line stay. */
function stripDeficitFraming(text: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const lines = text.split("\n").map((line) => {
    if (line.trim() === "" || /^[A-Z][A-Za-z ]+:$/.test(line.trim())) return line;
    const kept = splitSentences(line).filter((sentence) => {
      if (DEFICIT_FRAMING.test(sentence)) {
        removed.push(sentence.trim());
        return false;
      }
      return true;
    });
    return kept.join(" ");
  });
  // A label left with nothing under it goes too.
  const rebuilt: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const isLabel = /^[A-Z][A-Za-z ]+:$/.test(line.trim());
    if (isLabel) {
      const rest = lines.slice(index + 1);
      const nextLabel = rest.findIndex((entry) => /^[A-Z][A-Za-z ]+:$/.test(entry.trim()));
      const body = (nextLabel < 0 ? rest : rest.slice(0, nextLabel)).join("").trim();
      if (body === "") continue;
    }
    rebuilt.push(line);
  }
  return {
    text: rebuilt.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    removed,
  };
}

export interface FramingGuardResult {
  readonly values: Record<string, string>;
  readonly checked: Record<string, string[]>;
  /** Text fields a concern label was removed from. */
  readonly adjusted: string[];
  /** Whether the Underperformance tick was refused. */
  readonly underperformanceRefused: boolean;
}

/**
 * The guard. A no-op when the notes describe a shortfall, and on every draft
 * that has none of the Coaching Form's keys.
 */
export function guardCoachingFraming(
  draft: { values: Record<string, string>; checked: Record<string, string[]> },
  notes: string,
): FramingGuardResult {
  if (notesDescribeShortfall(notes)) {
    return { values: draft.values, checked: draft.checked, adjusted: [], underperformanceRefused: false };
  }

  const values: Record<string, string> = {};
  const adjusted: string[] = [];
  for (const [key, value] of Object.entries(draft.values)) {
    if (!FRAMED_TEXT_KEYS.has(key) || typeof value !== "string" || !DEFICIT_FRAMING.test(value)) {
      values[key] = value;
      continue;
    }
    const stripped = stripDeficitFraming(value);
    adjusted.push(key);
    if (stripped.text !== "") values[key] = stripped.text;
  }

  const checked: Record<string, string[]> = { ...draft.checked };
  const types = checked[COACHING_TYPE_KEY];
  const underperformanceRefused = Array.isArray(types) && types.includes(UNDERPERFORMANCE);
  if (underperformanceRefused) {
    const rest = types!.filter((option) => option !== UNDERPERFORMANCE);
    if (rest.length > 0) checked[COACHING_TYPE_KEY] = rest;
    else delete checked[COACHING_TYPE_KEY];
  }

  return { values, checked, adjusted, underperformanceRefused };
}

/**
 * THE REGISTER. Sent with the Coaching Form and the Follow-Up Coaching Form —
 * the two coaching documents — and nowhere else.
 */
export const COACHING_CONTEXT_RULES: readonly string[] = [
  "COACHING IS NOT ALWAYS ABOUT A PROBLEM. Read what kind of coaching the manager described — proactive alignment, training, expectation-setting, reinforcement of good work, performance development, or correction of a shortfall — and write in that register.",
  "Only call something a concern, an issue, a problem, a shortfall or underperformance when the manager described one. A training session, a new expectation for the team, or praise with a development point is written as exactly that, with no implication that anybody did something wrong.",
  'For training or expectation-setting, "Observed:" is what was covered, demonstrated or discussed, and "Expectation:" is the standard going forward. Tick Underperformance only when the manager described underperformance; tick Training Plan of Action or Retraining when that is what this is.',
];

/**
 * THE MANAGER'S NOTES ARE ROUGH; THE FORM IS NOT. Sent with every coaching
 * draft and revision so a manager never has to ask for it separately.
 */
export const LANGUAGE_CLEANUP_RULES: readonly string[] = [
  "CLEAN UP THE LANGUAGE AS YOU WRITE. The manager's notes may be rough: fix spelling, grammar, punctuation, capitalization and sentence clarity in everything you write, without being asked.",
  "Cleaning up is not rewording the facts. Keep every fact exactly as the manager gave it — who, what, when, where, how many, how long. Do not add a detail, and do not make anything sound more serious, more certain, milder or less certain than the manager said it.",
  "Spell names exactly as the form's EMPLOYEE line spells them. Keep numbers, times and dates the manager gave as values, written conventionally (\"20 min\" becomes \"20 minutes\").",
  "The form is formal workplace documentation: neutral, professional and specific. No conversational tone, no exclamation marks, no emoji, and no opinions about the employee's character or attitude.",
];
