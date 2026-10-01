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
  /\b(?:has|have|had|she'?s|he'?s|they'?ve|they'?re|is|are|was|were)\s+(?:\w+\s+)?(?:improved|not improved|gotten better|got better|gotten worse|got worse|been on time|been arriving|been consistent|kept it up|stopped)\b/i,
  /\b(?:no|some|partial|clear|great|real|little|any)\s+improvement\b/i,
  /\b(?:improved|improvement)\s+(?:since|over|this|in the last)\b/i,
];

/** Words about PROGRESS itself — what a progress level is a reading of. */
const PROGRESS_WORDS =
  /\b(?:improv\w*|better|worse|no change|unchanged|same as before|partial\w*|progress\w*|still\s+(?:late|not|hasn'?t|doesn'?t|isn'?t))\b/i;

export function notesDescribeFollowUp(notes: string): boolean {
  return FOLLOW_UP_HAPPENED.some((pattern) => pattern.test(notes ?? ""));
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
