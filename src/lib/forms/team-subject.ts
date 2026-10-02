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

/**
 * ============================================================================
 * THE WORDS THAT DESCRIBE THE TEAM ARE NEVER AN EMPLOYEE'S NAME
 * ============================================================================
 *
 * PRODUCTION QA OF PR #81: "Create a coaching form for general training for
 * staff on bed sanitizing" produced a form for an employee called "general" —
 * and "for group training" one for "group", "for team-wide coaching" one for
 * "team-wide". The name reader reads the word after "coaching form for" as a
 * person, and a named person (rightly) beats the team, so the team reading
 * never got a turn.
 *
 * So the phrases that describe the team are taken out of the sentence BEFORE
 * any name is read (`readEmployeeMentions` calls this first). They are
 * replaced with "the team", which every name reader already rejects, so the
 * sentence keeps its shape and nothing else in it moves.
 *
 * A REAL NAME IS UNTOUCHED. "Create a coaching form for Kaitlyn about how the
 * whole team should sanitize beds" loses only "whole team" and still names
 * Kaitlyn — so the form is hers, not the team's.
 */
const TEAM_DESCRIPTOR_SPANS: readonly RegExp[] = [
  /\b(?:team|salon|store|company|location)[-\s]wide\b/gi,
  /\b(?:whole|entire|full)\s+(?:salon\s+|store\s+)?(?:team|staff|crew)\b/gi,
  /\ball\s+(?:of\s+)?(?:the\s+|my\s+|our\s+)?(?:team\s+members?|staff|employees|team\s?mates|associates|team)\b/gi,
  /\b(?:everyone|everybody)(?:\s+(?:at|in|on)\s+(?:the\s+|my\s+|our\s+)?(?:salon|store|team|location))?\b/gi,
  /\b(?:group|team|general|staff)\s+(?:training|coaching|huddle|meeting|refresher|reminder)s?\b/gi,
];

/** The sentence with every team descriptor replaced by "the team". Pure. */
export function maskTeamSubjectPhrases(text: string): string {
  let masked = text ?? "";
  for (const pattern of TEAM_DESCRIPTOR_SPANS) masked = masked.replace(pattern, "the team");
  return masked;
}

/**
 * ============================================================================
 * "I NEED TEAM-WIDE COACHING ABOUT BED SANITIZING" ASKS FOR THE FORM
 * ============================================================================
 *
 * Also from that QA: three natural team requests reached no form at all —
 * "I need team-wide coaching about bed sanitizing", "Coaching for everyone at
 * the salon about bed sanitizing", and "General training for staff about bed
 * sanitizing — can you write up a coaching form?" (the closing question mark
 * read it as a question ABOUT forms).
 *
 * A REQUEST NEEDS ALL THREE, and each removes a class of false positive:
 *
 *   THE TEAM as the subject   `readsAsTeamSubject`, unchanged
 *   COACHING OR TRAINING      what the Coaching Form records
 *   A REQUEST                 a verb asking for it ("need", "create", "write
 *                             up", "document"…) or the message opening with
 *                             "coaching for …"
 *
 * AND IT IS NEVER ADVICE. "Tips for team-wide coaching", "how should we run
 * group training?" and a message that opens as a question stay with the
 * knowledge base, exactly as "how do I coach someone on tardiness?" does.
 */
const TEAM_COACHING_NOUN = /\b(?:coach(?:ing)?|training|huddle)\b/i;
const TEAM_REQUEST_CUE =
  /\b(?:need|needs|want|wants|create|make|start|draft|document|log|record|write(?:\s+up)?|put\s+together|prepare|set\s+up|do|file|open)\b/i;
const OPENS_AS_TEAM_COACHING = /^(?:please\s+)?(?:a\s+)?(?:coaching|training)\s+(?:for|with)\b/i;
const TEAM_ADVICE =
  /\b(?:tips?|advice|guidance|ideas?|suggestions?|how\s+(?:do|should|can|would|could)\s+(?:i|we)|what\s+should\s+(?:i|we)|help\s+me\s+(?:plan|prepare|think|figure))\b/i;
const OPENS_AS_QUESTION =
  /^(?:so\s+|and\s+)?(?:what|what's|whats|how|when|why|which|who|should|is|are|does|do\s+(?:we|i|you)\s+have)\b/i;
const DECLINES = /\b(?:don'?t|do\s+not|doesn'?t|does\s+not|no\s+need)\b/i;

/** Whether the manager is asking for a coaching form whose subject is the team. */
export function asksForTeamCoaching(text: string): boolean {
  const trimmed = (text ?? "").trim();
  if (!readsAsTeamSubject(trimmed) || !TEAM_COACHING_NOUN.test(trimmed)) return false;
  if (TEAM_ADVICE.test(trimmed) || OPENS_AS_QUESTION.test(trimmed) || DECLINES.test(trimmed)) return false;
  return TEAM_REQUEST_CUE.test(trimmed) || OPENS_AS_TEAM_COACHING.test(trimmed);
}

export function isTeamSubject(employeeName: string | null | undefined): boolean {
  return (employeeName ?? "").trim().toLowerCase() === TEAM_SUBJECT_LABEL.toLowerCase();
}

/** The drafting rule for a team-wide coaching form. */
export const TEAM_SUBJECT_RULES: readonly string[] = [
  "THIS COACHING IS FOR THE WHOLE TEAM, NOT ONE EMPLOYEE. Write it about the team and the expectation being set or the training being given.",
  "Never name, single out or imply one employee, and never suggest the team did something wrong unless the manager said so.",
];
