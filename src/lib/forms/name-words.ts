/**
 * ============================================================================
 * THE WORDS THAT ARE NEVER SOMEBODY'S NAME
 * ============================================================================
 *
 * Shared by the employee-name reader (`proposal.ts`) and the form-request
 * reader (`template-intent.ts`), which both have to decide whether the words
 * after a form's name are a person. One list, so the two can never disagree
 * about whether "coaching tips" or "exit process" names somebody. Pure and
 * browser-safe; it imports nothing.
 */

export const NOT_A_NAME = new Set([
  "a", "an", "the", "my", "our", "this", "that", "them", "him", "her", "it",
  "me", "us", "someone", "somebody", "everyone", "everybody", "today",
  "tomorrow", "yesterday", "monday", "tuesday", "wednesday", "thursday",
  "friday", "saturday", "sunday",
  /*
   * THE SUBJECT PRONOUNS. They could not reach a candidate before: a full name
   * needs two capitalised parts and the preposed pattern needs "for"/"about",
   * so a sentence-initial "She" matched nothing. `NAMED_ROLE` below reads
   * "<Name> is an SDIT", and "She is an SDIT" is that shape exactly — so the
   * pronouns have to be named here or the employee on a performance plan
   * becomes "She".
   */
  "she", "he", "they", "we", "you",
  /*
   * THE TWO LONE CAPITALS THAT ARE NEVER A SURNAME INITIAL. A trailing initial
   * is now accepted — see `INITIAL` — and "Sarah I saw her today" would
   * otherwise yield an employee called "Sarah I". "A" is already above and
   * does the same job for "Sarah A lot of things happened".
   */
  "i",
]);

/*
 * ============================================================================
 * WORDS THAT END A NAME TYPED WITHOUT CAPITALS
 * ============================================================================
 *
 * The capital letter used to be the ONLY evidence that a word was a name, so
 * "Corrective Action form for paulyne", "paulyne co" typed as the answer to
 * "who is this for?", and "test test" all produced no employee — and the form
 * could not be created. Managers type names in lower case (and in capitals) all
 * the time; the casing is not what makes something a name.
 *
 * Without capitals the POSITION is the evidence — see `readTypedName` — and
 * this list is what stops that position from swallowing the rest of the
 * sentence: "form for paulyne because she was late" is the name "paulyne",
 * not "paulyne because". It is also what keeps an ordinary reply ("thanks",
 * "ok") or an incident topic ("a form about attendance") from being read as a
 * person. It is never consulted for a capitalised name the existing patterns
 * found, so none of those change.
 */
export const NOT_A_TYPED_NAME = new Set([
  // Clause and sentence glue.
  "and", "or", "but", "because", "since", "as", "so", "then", "when", "while",
  "who", "whom", "whose", "which", "what", "where", "why", "how", "these",
  "those", "is", "was", "were", "are", "be", "been", "being", "has", "have",
  "had", "did", "does", "do", "not", "no", "to", "of", "at", "in", "on", "by",
  "from", "for", "about", "with", "regarding", "re", "after", "before", "again",
  "can", "could", "would", "should", "will", "just", "also", "too", "very",
  "all", "any", "some", "one", "his", "their", "its", "it's", "she's", "he's",
  "they're", "i'm", "im", "now", "later", "tonight", "morning", "afternoon",
  "evening", "week", "month", "last", "next", "time",
  // Replies that are not an answer to "who is this for?".
  "please", "thanks", "thank", "ok", "okay", "yes", "yeah", "yep", "nope",
  "sure", "hi", "hello", "hey", "help", "cancel", "stop", "wait", "never",
  "mind", "nevermind", "done", "nothing", "none", "unknown",
  /*
   * Openers that lead a comma-separated reply ("hmm, not sure yet") and so sit
   * where `INTAKE_LIST` below reads a name. None of them is anybody's name.
   */
  "hmm", "well", "actually", "great", "perfect", "cool", "right", "alright",
  "sorry", "oh", "um", "uh", "yup", "good", "fine", "nice", "anyway",
  "honestly", "update", "question",
  // What a form is ABOUT, which is never who it is about.
  "late", "early", "lateness", "tardiness", "tardy", "attendance", "absence",
  "absent", "conduct", "behavior", "behaviour", "dress", "code", "uniform",
  "attitude", "violation", "sales", "service", "customer", "customers",
  "cleaning", "safety", "theft", "harassment", "issue", "issues", "concern",
  "incident", "absences", "violations", "violating", "cell", "phones",
  "performance", "went", "going", "goes",
  /*
   * What people ask ABOUT a form rather than who it is for: "coaching tips",
   * "exit process", "transfer policy", "demotion requirements". And the words
   * that begin a form's other details — "…jane smith effective october 5".
   */
  "policy", "policies", "process", "procedure", "procedures", "rules", "rule",
  "tips", "steps", "requirements", "requirement", "information", "info",
  "guidelines", "work", "works", "working", "repeated", "session", "sessions",
  "meeting", "meetings", "questions", "effective", "starting", "template",
  "templates", "example", "examples", "sample",
  /*
   * PRODUCTION QA, 30 SEPTEMBER 2026. Words that reached a name position in
   * the way managers actually type — "coaching for avery testperson pls",
   * "the employee is always late", "coaching guidance for new hires", "I
   * talked to hr" — and are never anybody's name. Courtesy shorthand, the
   * adverbs that follow a copula, the nouns for the conversation itself, and
   * the people and places that are not one employee.
   */
  "pls", "plz", "thx", "asap", "u", "ur",
  "always", "still", "often", "usually", "constantly", "really", "currently", "being",
  "conversation", "conversations", "guidance", "advice", "ideas", "idea", "style",
  "skills", "techniques", "approach", "program", "checklist", "tour", "tours", "opening", "closing",
  "topic", "subject", "reason", "details", "detail", "date", "notes", "reminders",
  "new", "hire", "hires", "trainee", "trainees", "staff", "team", "person",
  "people", "guest", "guests", "client", "clients", "member", "members", "worker",
  "workers", "associate", "manager", "managers", "director", "hr", "corporate",
  "office", "leadership", "nobody", "anybody", "anyone", "noone",
  "said", "already", "meant", "instead", "name", "named",
  // The Coaching Form's own topics, which follow "coaching on …".
  "product", "products", "basics", "knowledge", "engaging", "engagement", "relevant",
  "recommendations", "recommendation", "overcoming", "objections", "objection", "completing",
  "strategies", "strategy", "upselling", "upsell", "tasks", "task", "documents", "lotion",
  "lotions", "membership", "memberships", "retail", "punctuality", "cleanliness", "greeting",
  "greetings",
]);

/** A word a lower-case or all-caps name can be made of: letters, ' and -. */
export const TYPED_NAME_WORD = /^[A-Za-z][A-Za-z'’-]*$/;
