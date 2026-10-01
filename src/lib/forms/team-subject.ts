/**
 * ============================================================================
 * COACHING THAT IS FOR THE WHOLE TEAM, NOT ONE PERSON
 * ============================================================================
 *
 * "Create a coaching form for the whole team about bed sanitizing." Every form
 * used to need one employee, so a salon-wide expectation, a training session or
 * a team reminder had nowhere to go but onto somebody's name — or nowhere.
 *
 * THE SUBJECT IS A LABEL, NOT A PERSON. `form_instances.employee_name` is the
 * record's subject line and has always been free text; a team-wide coaching
 * form carries `TEAM_SUBJECT_LABEL` there, so Form Monitoring, the editor and
 * the printed Name line all read "All team members" rather than a name nobody
 * gave. No column is added and no migration is needed.
 *
 * ONLY THE COACHING FORM. Corrective action, an EPP, a follow-up on one
 * person's coaching, an exit or a transfer is by nature about one employee, so
 * a team phrase on any of those is still a question about who.
 *
 * A NAMED PERSON ALWAYS WINS. "Coaching for Dana — she spoke over the whole
 * team" is about Dana. This is read only when the conversation names nobody.
 */

export const TEAM_SUBJECT_LABEL = "All team members";

/** The templates whose subject may be the team. */
const TEAM_SUBJECT_TEMPLATES: ReadonlySet<string> = new Set(["coaching"]);

export function allowsTeamSubject(templateKey: string): boolean {
  return TEAM_SUBJECT_TEMPLATES.has(templateKey);
}

/**
 * Phrases that put the TEAM, rather than one person, as the subject. Kept as a
 * readable list: this is the whole content of the rule.
 *
 * TWO KINDS, and the split was found by a test. "Tuesday was a difficult shift
 * for the team" DESCRIBES the team; it does not say the coaching is FOR it. So
 * a bare "for the team" counts only as the object of the form or coaching
 * request, while the unambiguous qualifiers — "team-wide", "all staff",
 * "general training" — count wherever they appear.
 */
const TEAM_PHRASES: readonly RegExp[] = [
  // Unambiguous wherever they appear.
  /\b(?:team|salon|store|company)[-\s]wide\b/i,
  /\b(?:group|team|general|staff)\s+(?:training|coaching|huddle|meeting)\b/i,
  /\ball\s+(?:of\s+)?(?:the\s+|my\s+|our\s+)?(?:team\s+members|staff|employees|team\s?mates|associates)\b/i,
  /\ball\s+of\s+(?:the|my|our)\s+team\b/i,
  /\b(?:everyone|everybody)\s+(?:at|in|on)\s+(?:the\s+|my\s+|our\s+)?(?:salon|store|team|location)\b/i,
  // The object of the request: "<coaching|form> … for the (whole) team".
  /\b(?:coaching|form|training)\s+(?:\w+\s+){0,3}?(?:for|with|to)\s+(?:the\s+|my\s+|our\s+)?(?:whole\s+|entire\s+|full\s+)?(?:salon\s+|store\s+)?(?:team|staff|crew)\b/i,
  /\b(?:coaching|form|training)\s+(?:\w+\s+){0,3}?for\s+(?:everyone|everybody|all)\b/i,
];

/** Whether the manager's words make this coaching about the team. */
export function readsAsTeamSubject(text: string): boolean {
  return TEAM_PHRASES.some((pattern) => pattern.test(text ?? ""));
}

export function isTeamSubject(employeeName: string | null | undefined): boolean {
  return (employeeName ?? "").trim().toLowerCase() === TEAM_SUBJECT_LABEL.toLowerCase();
}

/** The drafting rule for a team-wide coaching form. */
export const TEAM_SUBJECT_RULES: readonly string[] = [
  "THIS COACHING IS FOR THE WHOLE TEAM, NOT ONE EMPLOYEE. Write it about the team and the expectation being set or the training being given.",
  "Never name, single out or imply one employee, and never suggest the team did something wrong unless the manager said so.",
];
