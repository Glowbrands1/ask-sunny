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

/** Signs in the manager's own words that something fell short. */
const SHORTFALL_IN_NOTES =
  /\b(?:late|tardy|tardiness|missed|missing|forgot|forgets|forgetting|didn'?t|did not|doesn'?t|does not|wasn'?t|was not|weren'?t|isn'?t|is not|aren'?t|haven'?t|hasn'?t|has not|not (?:following|doing|completing|meeting|cleaning|sanitiz\w*|wiping|using|offering|asking|greeting)|failed|failing|fails? to|refus\w*|rude|complain\w*|complaint|mistakes?|errors?|wrong|below|low|poor\w*|struggl\w*|again|keeps|still|issues?|concerns?|problems?|behind|skipp\w*|skips?|ignor\w*|careless|unprofessional|no[- ]call|no[- ]show|absent|left early|incorrect\w*|improper\w*|unsanitary|dirty|underperform\w*|slipping|declin\w*|dropped|violat\w*|warning|written up|write[- ]up)\b/i;

/** Labels that turn a conversation into a finding. */
const DEFICIT_FRAMING =
  /\b(?:concerns?|concerning|issues?|problems?|problematic|deficien\w*|shortcomings?|underperform\w*|under-perform\w*|fell short|falls? short|failed to|fails? to|failure to|failing to|poor|unacceptable|not meeting|did not meet|does not meet|below (?:expectations|standard))\b/i;

export const COACHING_TYPE_KEY = "coaching_type";
const UNDERPERFORMANCE = "underperformance";
const FRAMED_TEXT_KEYS: ReadonlySet<string> = new Set(["coaching_details", "other_topic"]);

export function notesDescribeShortfall(notes: string): boolean {
  return SHORTFALL_IN_NOTES.test(notes ?? "");
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
