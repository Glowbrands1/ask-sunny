import { reopenRequestVerbOnlyEnabled, reopenVerbGuardEnabled } from "@/lib/config/chat-quality-flags";

import { EDIT_VERB, SHOW_VERB } from "./reopen-cue";
import { asksAboutForms, detectTemplateIntent, leadingFormRequest } from "./template-intent";

/**
 * ============================================================================
 * "CHANGE EXIT FOR LACEY MORROW" — ASKING FOR A FORM THAT ALREADY EXISTS
 * ============================================================================
 *
 * The reading `chat-reopen.ts` acts on. PURE: no I/O, no identity — what it
 * returns is an intent, and the form it names still has to be found among the
 * forms the actor may see and re-authorized before anything is opened.
 *
 *   EDIT   "change exit for lacey morrow", "duplicate exit for lacey morrow
 *          and change date notice given to 9-27-26", "edit the coaching form
 *          for Dana Moss", "reopen her exit form" — open it to change.
 *   SHOW   "show draft of exit", "show me the exit form for Lacey Morrow" —
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

/*
 * Asking for a new record. Narrow on purpose: "change her new location" and
 * "change the start date" are corrections, not new forms.
 */
const NEW_RECORD =
  /\b(?:create|make\s+(?:a|an|one|another)|start\s+(?:a|an|another)|another|fresh|blank|pull\s+up\s+(?:a|an))\b|\b(?:a|an)\s+new\s+(?:\S+\s+)?(?:form|paperwork|exit|coaching|transfer|demotion|resignation|epp|plan)\b/i;
/*
 * REOPEN_VERB_GUARD_ENABLED (QA B22, 25 Oct 2026): "Write up Test Employee …
 * for no call no show on 10/22" in a new chat read "show" as the verb and put
 * another chat's corrective action back in the thread. An incident that
 * contains a reopen verb is not one, and a turn that opens by asking for a
 * document is a new one.
 */
const INCIDENT_WITH_A_VERB =
  /\bno[\s,/-]*call(?:[\s,/-]*(?:and|or))?[\s,/-]*no[\s-]*shows?\b|\bno[\s-]shows?\b|\b(?:did(?:n['’]?t|\s+not)|never|doesn['’]?t|won['’]?t|failed\s+to)\s+show(?:\s+up)?\b|\bshow(?:s|ed|ing)?\s+up\b/gi;
/*
 * Only as the request itself: at the start of the turn, or after "please",
 * "can you", "I need you to", "let's", "I want to". "Show me the write up for
 * …" and "bring back the write-up" name a form on file, and stay reopens.
 */
/* A form word, so "I need a copy of …" and "do an edit of …" stay reopens (QA review of #229). */
const DOCUMENT_WORD = String.raw`(?:corrective\s+action|ca\b|c\/a\b|coaching|write[\s-]?up|warning|form|document|exit|transfer|demotion)`;
const ASKS_FOR_A_DOCUMENT = new RegExp(
  String.raw`^\s*(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|i\s+need\s+you\s+to\s+|let'?s\s+|i\s+want\s+to\s+)?` +
    String.raw`(?:i\s+(?:need|want)\s+(?:to\s+(?:draft|write|do)\s+)?(?:a|an)\s+(?:new\s+|verbal\s+|written\s+|final\s+)?${DOCUMENT_WORD}` +
    String.raw`|draft\s+(?:a|an|up)\b|write\s+(?:up|a|an)\b|do\s+(?:a|an)\s+(?:new\s+|verbal\s+|written\s+|final\s+)?${DOCUMENT_WORD})`,
  "i",
);

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
  const guarded = reopenVerbGuardEnabled();
  if (guarded && ASKS_FOR_A_DOCUMENT.test(text)) return null;
  const verbs = guarded ? text.replace(INCIDENT_WITH_A_VERB, " ") : text;
  // REOPEN_REQUEST_VERB_ONLY_ENABLED: "follow up coaching form for <name> must see …" asks for a new form.
  if (reopenRequestVerbOnlyEnabled() && opensWithFormForSomeone(text)) return null;

  const edit = EDIT_VERB.test(verbs);
  const show = !edit && SHOW_VERB.test(verbs);
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

/**
 * REOPEN_REQUEST_VERB_ONLY_ENABLED (Sunny tester, 26 Oct 2026,
 * conv_mvokdg0w2i6d1hu): "follow up coaching form for devon harlan must see
 * behavior red light promo check-ins" read "see" in the account as "show me"
 * and answered "I couldn't find a Follow-Up Coaching Form … on file". A turn
 * that opens with a form's name, says who it is for, and carries no edit or
 * show verb in front of the name asks for that form: the proposal flow makes
 * it. "show me the coaching form for …", "edit the …", "reopen …" still
 * open one on file.
 */
function opensWithFormForSomeone(text: string): boolean {
  if (LEADING_REQUEST.test(text)) return false;
  const leading = leadingFormRequest(text);
  if (!leading || leading.subject.length === 0) return false;
  const before = text.slice(0, Math.max(0, text.toLowerCase().indexOf(leading.subject[0]!.toLowerCase())));
  return !EDIT_VERB.test(before) && !SHOW_VERB.test(before);
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
