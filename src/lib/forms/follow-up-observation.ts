/**
 * ============================================================================
 * WHAT THE MANAGER SAW AT THE FOLLOW-UP IS THE MANAGER'S TO RECORD
 * ============================================================================
 *
 * The Follow-Up Coaching Form (Performance Management Framework §9.2) asks for
 * things that only exist once the manager has actually followed up:
 *
 *   follow_up_observation   what they observed after the original coaching
 *   specific_evidence       what they saw, heard or measured
 *   additional_coaching     any further coaching they gave at that point
 *   progress_level          their judgement: improved / partially / none
 *   next_step               their decision about what happens next
 *
 * Feedback confirmed the right behaviour — these stay BLANK until the follow-up
 * has happened — and asked that it be kept. Until now it held only because the
 * model usually declined to fill them. A drafted "She has improved and arrives
 * on time" before anybody has looked is an invented finding on an employee's
 * file, and the redraft path makes the model see more of the conversation, not
 * less. So it is a guard on the OUTPUT, not just a line in the prompt.
 *
 * ============================================================================
 * THE RULE
 * ============================================================================
 *
 * These keys survive a draft only when the manager's OWN words describe a
 * follow-up that has taken place — "since our coaching she has…", "I followed
 * up today", "no improvement this week". A progress level additionally needs
 * the manager to have said something about progress. Otherwise every one of
 * them is emptied, whatever the model wrote.
 *
 * KEYED ON THE FIELD'S MEANING, NOT ON A TEMPLATE NAME OR A VERSION MARKER, so
 * every instance pinned to any published version of the Follow-Up Coaching Form
 * is covered and no other template — none of which uses these keys — is
 * touched.
 */

export const MANAGER_FOLLOW_UP_TEXT_KEYS: ReadonlySet<string> = new Set([
  "follow_up_observation",
  "specific_evidence",
  "additional_coaching",
]);

export const MANAGER_FOLLOW_UP_GROUP_KEYS: ReadonlySet<string> = new Set([
  "progress_level",
  "next_step",
]);

/**
 * Words that say a follow-up has HAPPENED and the manager is reporting on it.
 * Forward-looking talk — "we'll follow up in two weeks" — is not on this list:
 * it is the timeframe, and it names nothing that was observed.
 */
const FOLLOW_UP_HAPPENED: readonly RegExp[] = [
  /\b(?:since|after)\s+(?:the|our|my|her|his|their|that|last|this)\s+(?:\w+\s+)?(?:coaching|conversation|talk|meeting|session|discussion|check[- ]?in|training)\b/i,
  /\bsince\s+then\b/i,
  /\b(?:i|we)\s+(?:have\s+)?(?:followed|checked)\s+(?:up|in|back)\b/i,
  /\b(?:at|during|in)\s+(?:the|our|my|today'?s)\s+follow[- ]?up\b/i,
  /\bfollow[- ]?up\s+(?:observation|today|this week|went|showed)\b/i,
  // Not after a modal: "she should have improved by then" is a target, not a report.
  /(?<!\b(?:should|would|could|might|must|will|may|to)\s)\b(?:has|have|had|she'?s|he'?s|they'?ve|they'?re|is|are|was|were)\s+(?:\w+\s+)?(?:improved|not improved|gotten better|got better|gotten worse|got worse|been on time|been arriving|been consistent|kept it up|stopped)\b/i,
  /\b(?:no|some|partial|clear|great|real|little|any)\s+improvement\b/i,
  /\b(?:improved|improvement)\s+(?:since|over|this|in the last)\b/i,
  /*
   * PRODUCTION QA OF PR #81. A manager reports a follow-up the way they would
   * say it out loud, and these were all missed:
   *
   *   "Kaitlyn improved and followed the procedure correctly during today's
   *    observation"                 a person, then "improved" — no "has"
   *   "during today's observation"  what the follow-up WAS, named as such
   *   "She is making progress but still needs reminders"
   *
   * The forward-looking guard is in `reportsPastImprovement`, not here: "she
   * should have improved by then" and "I hope she improves" say nothing about
   * a follow-up that happened.
   */
  // Anchored to WHEN — "during the observation" can as easily be the original coaching.
  /\b(?:during|at|in|from)\s+(?:today'?s|todays|this\s+week'?s|yesterday'?s|this\s+morning'?s)\s+(?:observation|check[- ]?in|walk[- ]?through|visit|shift\s+check)\b/i,
  /\b(?:is|are|was|were|she'?s|he'?s|they'?re|has\s+been|have\s+been)\s+(?:\w+\s+)?(?:making|showing)\s+(?:\w+\s+)?progress\b/i,
  /\b(?:no|some|real|good|steady|little|any)\s+progress\s+(?:yet|so\s+far|since|this)\b/i,
  /\b(?:no|some|partial|clear|great|real|little|any)\s+improvement\s+(?:yet|so\s+far)\b/i,
];

/** Words that make "she improved" a hope or a target rather than a report. */
const FORWARD_LOOKING = /\b(?:will|would|should|could|might|may|must|hope|hopefully|expect\w*|want|need|if|unless|until|by\s+the\s+time)\s+(?:\w+\s+){0,2}$/i;

/** "Kaitlyn improved", "she regressed" — a person, then a past-tense report of progress. */
function reportsPastImprovement(text: string): boolean {
  for (const match of text.matchAll(/\b([A-Za-z][A-Za-z'’-]*)\s+(improved|regressed|progressed|got\s+better|got\s+worse)\b/gi)) {
    const subject = match[1]!.toLowerCase();
    if (["have", "has", "had", "to", "be", "been", "not", "never"].includes(subject)) continue;
    const before = text.slice(Math.max(0, (match.index ?? 0) - 40), match.index ?? 0);
    if (!FORWARD_LOOKING.test(`${before} `)) return true;
  }
  return false;
}

/** Words about PROGRESS itself — what a progress level is a reading of. */
const PROGRESS_WORDS =
  /\b(?:improv\w*|better|worse|no change|unchanged|same as before|partial\w*|progress\w*|regress\w*|still\s+(?:late|not|hasn'?t|doesn'?t|isn'?t|needs?|skip\w*|miss\w*|forget\w*))\b/i;

export function notesDescribeFollowUp(notes: string): boolean {
  // "today’s" is typed with a curly apostrophe as often as a straight one.
  const text = (notes ?? "").replace(/[’‘]/g, "'");
  return FOLLOW_UP_HAPPENED.some((pattern) => pattern.test(text)) || reportsPastImprovement(text);
}

/**
 * ============================================================================
 * IS THIS TURN A FOLLOW-UP RESULT?
 * ============================================================================
 *
 * "Kaitlyn improved and followed the sanitizing procedure correctly during
 * today's observation" went to the knowledge base with a Follow-Up Coaching
 * Form open beside it, because no edit verb was in it. A manager reporting
 * what they found at the follow-up is giving the form its findings, and
 * should not need to know a field's name, or say "add this to the form".
 *
 * ONE TURN, NOT THE CONVERSATION: the CURRENT message must be the report, so
 * an ordinary question asked after a follow-up was described is still a
 * question. A message that asks something ("did she improve?") is not a
 * report.
 */
export function reportsFollowUpResult(turn: string): boolean {
  const text = (turn ?? "").trim();
  if (text === "") return false;
  if (/^\s*(?:what|why|how|when|where|who|which|should|is|are|does|do|did|was|were|will|would|can|could)\b[^.!]*\?\s*$/i.test(text)) {
    return false;
  }
  return notesDescribeFollowUp(text);
}

/*
 * ============================================================================
 * WHAT A FOLLOW-UP REPORT ENTITLES EACH FINDING TO
 * ============================================================================
 *
 * A report is the manager's own words, and each finding needs its own words
 * in it — the observation and the evidence come from what they saw, but a
 * progress level, a next step and "additional coaching" are DECISIONS or
 * ACTIONS the report has to state. "She improved" is a progress reading; it
 * is not a decision to continue, and it does not say any coaching was given.
 */
const NEXT_STEP_WORDS =
  /\b(?:next\s+step|continue\w*|keep\s+(?:going|it\s+up|monitoring|working)|role[- ]?play\w*|leadership|escalat\w*|move\s+(?:on\s+)?to|another\s+follow[- ]?up|follow\s+up\s+again|check\s+(?:back|again)|close\s+(?:it|this)\s+out|no\s+further)\b/i;
const ADDITIONAL_COACHING_WORDS =
  /\b(?:coached|re-?coached|retrain\w*|re-?trained|trained|reviewed|went\s+over|walked\s+(?:her|him|them)\s+through|showed|demonstrat\w*|role[- ]?played|explained|reminded|practiced|practised|modeled|modelled)\b/i;

/** The manager-only findings this report's words can support. */
export function findingsSupportedBy(report: string): Set<string> {
  const text = (report ?? "").replace(/[’‘]/g, "'");
  const supported = new Set<string>();
  if (!notesDescribeFollowUp(text)) return supported;
  supported.add("follow_up_observation");
  supported.add("specific_evidence");
  if (PROGRESS_WORDS.test(text)) supported.add("progress_level");
  if (NEXT_STEP_WORDS.test(text)) supported.add("next_step");
  if (ADDITIONAL_COACHING_WORDS.test(text)) supported.add("additional_coaching");
  return supported;
}

export interface FollowUpGuardResult {
  readonly values: Record<string, string>;
  readonly checked: Record<string, string[]>;
  /** Keys emptied because the manager has not described a follow-up. */
  readonly emptied: string[];
}

/**
 * Empties the manager-only follow-up keys the notes cannot support. Pure, and
 * a no-op on any draft that carries none of these keys.
 */
export function guardManagerFollowUp(
  draft: { values: Record<string, string>; checked: Record<string, string[]> },
  notes: string,
): FollowUpGuardResult {
  const happened = notesDescribeFollowUp(notes);
  const progressSaid = happened && PROGRESS_WORDS.test(notes ?? "");
  const emptied: string[] = [];

  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(draft.values)) {
    if (MANAGER_FOLLOW_UP_TEXT_KEYS.has(key) && !happened && value.trim() !== "") {
      emptied.push(key);
      continue;
    }
    values[key] = value;
  }

  const checked: Record<string, string[]> = {};
  for (const [key, options] of Object.entries(draft.checked)) {
    const allowed = key === "progress_level" ? progressSaid : happened;
    if (MANAGER_FOLLOW_UP_GROUP_KEYS.has(key) && !allowed && options.length > 0) {
      emptied.push(key);
      continue;
    }
    checked[key] = options;
  }

  return { values, checked, emptied };
}

/** Whether a draft's field list includes any of the manager-only keys. */
export function hasManagerFollowUpKeys(keys: Iterable<string>): boolean {
  for (const key of keys) {
    if (MANAGER_FOLLOW_UP_TEXT_KEYS.has(key) || MANAGER_FOLLOW_UP_GROUP_KEYS.has(key)) return true;
  }
  return false;
}

/** The prompt half of the rule, for the forms that have these keys. */
export const MANAGER_FOLLOW_UP_RULES: readonly string[] = [
  "FOLLOW-UP OBSERVATION, SPECIFIC EVIDENCE, ADDITIONAL COACHING COMPLETED, PROGRESS LEVEL AND NEXT STEP RECORD WHAT THE MANAGER FOUND WHEN THEY ACTUALLY FOLLOWED UP.",
  "Fill them only from the manager's own account of a follow-up that has already happened. If the manager has not described one, leave every one of them empty: never predict progress, never write what the manager will observe, and never choose a progress level or next step for them.",
];
