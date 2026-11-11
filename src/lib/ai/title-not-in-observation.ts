/*
 * ============================================================================
 * A CLAUSE THAT ONLY STATES THE EMPLOYEE'S JOB TITLE IS NOT THE ACCOUNT (TITLE_NOT_IN_OBSERVATION_ENABLED)
 * ============================================================================
 *
 * QA's October triage of #207 (10 Nov 2026; the person invented): "create a coaching form for <employee> at Kearney,
 * she is an HR assistant, for being late on 10-20-26" gave a card whose Observation of Offense was "she is an HR
 * assistant, being late on 10-20-26". Who the employee is belongs on the Job title line, never in what happened.
 *
 * With the flag on, a clause of the request that only says what the employee is ("she is an HR assistant", "he's a
 * shift lead", "<name> is a tanning consultant", "her position is assistant manager") is left out of the Observation.
 * It must end in a word that names a role, so "she is a no-show", "she is a great worker" and "she is late" stay. Pure.
 */

/** The last word of a job title. */
const ROLE_HEAD =
  /^(?:assistants?|associates?|managers?|leads?|leaders?|supervisors?|members?|consultants?|directors?|generalists?|coordinators?|specialists?|trainers?|cashiers?|clerks?|representatives?|reps?|operators?|administrators?|admins?|technicians?|techs?|keyholders?|stylists?|attendants?|analysts?|recruiters?|officers?|trainees?|hires?)$/i;
/** Words that make the phrase a judgement, not a title ("a great consultant", "my manager"). */
const NOT_A_TITLE_WORD =
  /^(?:great|good|bad|nice|hard|poor|excellent|terrible|strong|weak|reliable|real|very|really|my|our|your|their|her|his|this|that|former|ex|no|not|to|at|with|for|in|on|of|from|by|about|the|rude|mean|late)$/i;

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when the clause only states the employee's job title. */
export function onlyStatesJobTitle(clause: string, employeeName: string | null): boolean {
  const text = clause.trim().replace(/[.!?]+$/, "").trim();
  const names = (employeeName ?? "").trim().split(/\s+/).filter((word) => word.length > 1).map(escape);
  const who = [String.raw`she|he|they`, ...(names.length > 0 ? [names.join(String.raw`\s+`), ...names] : [])].join("|");
  const copular = new RegExp(
    String.raw`^(?:and\s+)?(?:${who})(?:\s+(?:is|works\s+as|is\s+working\s+as)|['’]s)\s+(?:an?\s+)?([\p{L}'’/-]+(?:\s+[\p{L}'’/-]+){0,3})$`,
    "iu",
  );
  const labelled = /^(?:and\s+)?(?:her|his|their|the\s+employee['’]?s?)\s+(?:job\s+)?(?:title|position|role)\s+is\s+(?:an?\s+)?([\p{L}'’/-]+(?:\s+[\p{L}'’/-]+){0,3})$/iu;
  const words = (copular.exec(text)?.[1] ?? labelled.exec(text)?.[1])?.split(/\s+/);
  if (!words) return false;
  return ROLE_HEAD.test(words.at(-1)!) && !words.some((word) => NOT_A_TITLE_WORD.test(word));
}
