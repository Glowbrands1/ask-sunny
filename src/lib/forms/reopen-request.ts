import { asksAboutForms, detectTemplateIntent, leadingFormRequest } from "./template-intent";

/**
 * ============================================================================
 * "CHANGE EXIT FOR ASHLEY ROGERS" — ASKING FOR A FORM THAT ALREADY EXISTS
 * ============================================================================
 *
 * The reading `chat-reopen.ts` acts on. PURE: no I/O, no identity — what it
 * returns is an intent, and the form it names still has to be found among the
 * forms the actor may see and re-authorized before anything is opened.
 *
 *   EDIT   "change exit for ashley rogers", "duplicate exit for ashley rogers
 *          and change date notice given to 9-27-26", "edit the coaching form
 *          for Dana Moss", "reopen her exit form" — open it to change.
 *   SHOW   "show draft of exit", "show me the exit form for Ashley Rogers" —
 *          put it back in the thread as it is.
 *
 * NEVER A NEW FORM. "Create", "make", "start", "new", "another", "pull up a
 * transfer form for jane doe" all ask for a new record and are left to the
 * proposal flow; so is a question ABOUT forms ("how do I change an exit
 * form?"), which the knowledge base answers.
 */
export interface ReopenRequest {
  mode: "edit" | "show";
  /** The template named, or null when the sentence named none ("edit the form"). */
  templateKey: string | null;
  /**
   * Whether the sentence asks for a particular change as well ("… and change
   * the notice date"), rather than only to open the form.
   */
  asksChange: boolean;
}

const EDIT_VERB =
  /\b(?:edit|change|update|correct|fix|revise|redo|re-do|amend|modify|redraft|re-draft|reopen|re-open|unlock|unfinali[sz]e|un-finali[sz]e|duplicate|copy)\b/i;
const SHOW_VERB = /\b(?:show|see|view|display|bring\s+back|open\s+up)\b/i;
/*
 * Asking for a new record. Narrow on purpose: "change her new location" and
 * "change the start date" are corrections, not new forms.
 */
const NEW_RECORD =
  /\b(?:create|make\s+(?:a|an|one|another)|start\s+(?:a|an|another)|another|fresh|blank|pull\s+up\s+(?:a|an))\b|\b(?:a|an)\s+new\s+(?:\S+\s+)?(?:form|paperwork|exit|coaching|transfer|demotion|resignation|epp|plan)\b/i;
/** A question somebody is asking, not a request to act. "Can you …" is a request. */
const QUESTION_OPENING =
  /^\s*(?:how|what|why|when|where|which|who|is|are|does|do|did|should|would|will|can\s+(?:i|we|managers?|a\s+manager)|could\s+(?:i|we))\b/i;
/** The leading request words, so the form's name is what the sentence then opens with. */
const LEADING_REQUEST = new RegExp(
  String.raw`^\s*(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:i\s+(?:need|want)\s+to\s+|let'?s\s+)?` +
    String.raw`(?:edit|change|update|correct|fix|revise|redo|re-do|amend|modify|redraft|re-draft|reopen|re-open|unlock|duplicate|copy|show|see|view|display)` +
    String.raw`(?:\s+me)?(?:\s+(?:the|a|an|her|his|their|my))?(?:\s+(?:draft|copy|version))?(?:\s+of)?(?:\s+(?:the|her|his|their))?\s+`,
  "i",
);
/** Words that point at a form when none is named: "edit the form", "show the draft". */
const POINTS_AT_A_FORM = /\b(?:form|draft|paperwork)\b/i;

export function readReopenRequest(question: string): ReopenRequest | null {
  const text = (question ?? "").replace(/\s+/g, " ").trim();
  if (text === "" || text.length > 400) return null;
  if (QUESTION_OPENING.test(text)) return null;
  if (NEW_RECORD.test(text)) return null;

  const edit = EDIT_VERB.test(text);
  const show = !edit && SHOW_VERB.test(text);
  if (!edit && !show) return null;
  if (asksAboutForms(text) && !LEADING_REQUEST.test(text)) return null;

  const templateKey = templateNamed(text);
  if (!templateKey && !POINTS_AT_A_FORM.test(text)) return null;

  return {
    mode: edit ? "edit" : "show",
    templateKey,
    asksChange: edit && asksForAChange(text),
  };
}

/** The template a sentence names, read as the proposal flow reads one. */
function templateNamed(text: string): string | null {
  const direct = detectTemplateIntent(text);
  if (direct.kind === "explicit") return direct.templateKey;
  const rest = text.replace(LEADING_REQUEST, "");
  if (rest !== text) {
    const stripped = detectTemplateIntent(rest);
    if (stripped.kind === "explicit") return stripped.templateKey;
    const leading = leadingFormRequest(rest);
    if (leading) return leading.templateKey;
  }
  return null;
}

/**
 * "… and change the notice date to 9/27", "… to say she gave notice by text":
 * something to change, beyond opening the form. "Change exit for ashley
 * rogers" asks for none.
 */
function asksForAChange(text: string): boolean {
  const opened = text.replace(LEADING_REQUEST, "");
  return /\b(?:and|then|with|so\s+that|but)\b|\bto\s+(?!be\b)\S/i.test(opened);
}
