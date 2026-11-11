import { reopenByAnyOpenVerbEnabled, reopenVerbGuardEnabled } from "@/lib/config/chat-quality-flags";

import { EDIT_VERB, FIND_WORDS, OPEN_WORDS, SHOW_VERB } from "./reopen-cue";
import { asksAboutForms, detectTemplateIntent, leadingFormRequest, type TemplateIntent } from "./template-intent";

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
  /**
   * REOPEN_BY_ANY_OPEN_VERB_ENABLED: asked for with "bring up", "pull up" or
   * "open". Opened to edit as "edit" opens it — a finalized form as a new
   * draft of it — with no change read from the sentence.
   */
  opensToEdit?: boolean;
  /**
   * REOPEN_BY_ANY_OPEN_VERB_ENABLED: asked for with one of the verbs the flag
   * adds ("find" shows, the others open). Only for a person named.
   */
  byAddedVerb?: boolean;
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
const REQUEST_OPENING = String.raw`^\s*(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:i\s+(?:need|want)\s+to\s+|let'?s\s+)?`;
const REQUEST_VERBS = String.raw`edit|change|update|correct|fix|revise|redo|re-do|amend|modify|redraft|re-draft|reopen|re-open|unlock|duplicate|copy|show|see|view|display`;
const REQUEST_OBJECT = String.raw`(?:\s+me)?(?:\s+(?:the|a|an|her|his|their|my))?(?:\s+(?:draft|copy|version))?(?:\s+of)?(?:\s+(?:the|her|his|their))?\s+`;
const LEADING_REQUEST = new RegExp(`${REQUEST_OPENING}(?:${REQUEST_VERBS})${REQUEST_OBJECT}`, "i");
/*
 * REOPEN_BY_ANY_OPEN_VERB_ENABLED: the same leading request, with the open
 * verbs of `reopen-cue.ts`. An open verb counts only here, as the request
 * itself: "write her up, she didn't open the salon" is no reopen.
 */
const LEADING_REQUEST_ANY_OPEN = new RegExp(`${REQUEST_OPENING}(?:${REQUEST_VERBS}|${OPEN_WORDS}|${FIND_WORDS})${REQUEST_OBJECT}`, "i");
const LEADS_WITH_AN_OPEN_VERB = new RegExp(`${REQUEST_OPENING}(?:${OPEN_WORDS})\\b`, "i");
const LEADS_WITH_FIND = new RegExp(`${REQUEST_OPENING}(?:${FIND_WORDS})\\b`, "i");
/*
 * QA decision (c), 6 Nov 2026: "open a CA for <name>" STARTS a new one. After
 * an added verb, an indefinite article before the form means a new form; a
 * definite or possessive one ("the", "her", "my", "<name>'s") a form on file.
 * An indefinite one followed by one of these words still points at a form on
 * file ("bring up an old coaching form", "a previously edited corrective
 * action"): the one small list of them.
 */
const EARLIER_WORDS = String.raw`old|older|previous|previously|last|earlier|existing`;
const ADDED_VERB_THEN_A_NEW_ONE = new RegExp(
  `${REQUEST_OPENING}(?:${OPEN_WORDS}|${FIND_WORDS})\\s+(?:me\\s+)?(?:a|an)\\s+(?!(?:${EARLIER_WORDS})\\b)`,
  "i",
);
/** Words that point at a form when none is named: "edit the form", "show the draft". */
const POINTS_AT_A_FORM = /\b(?:form|draft|paperwork)\b/i;

/**
 * REOPEN_NOT_OPEN_FORM_ENABLED (QA's Sunny round-4 gate, 8 Nov 2026): the reopen verb is the request itself, at the start
 * of the turn ("show me the draft", "open her CA", "edit the form"), never a word inside an edit instruction ("the
 * Must see behaviors … Make it in the format …").
 */
export function leadsWithReopenRequest(question: string): boolean {
  const text = (question ?? "").replace(/\s+/g, " ").trim();
  return LEADING_REQUEST_ANY_OPEN.test(text) || LEADING_REQUEST.test(text) || LEADS_WITH_AN_OPEN_VERB.test(text);
}

export function readReopenRequest(question: string): ReopenRequest | null {
  const text = (question ?? "").replace(/\s+/g, " ").trim();
  if (text === "" || text.length > 400) return null;
  if (QUESTION_OPENING.test(text)) return null;
  if (NEW_RECORD.test(text)) return null;
  const guarded = reopenVerbGuardEnabled();
  if (guarded && ASKS_FOR_A_DOCUMENT.test(text)) return null;
  const verbs = guarded ? text.replace(INCIDENT_WITH_A_VERB, " ") : text;

  const anyOpenVerb = reopenByAnyOpenVerbEnabled();
  const edit = EDIT_VERB.test(verbs);
  const finds = anyOpenVerb && !edit && !SHOW_VERB.test(verbs) && LEADS_WITH_FIND.test(text);
  const show = !edit && (SHOW_VERB.test(verbs) || finds);
  const opens = anyOpenVerb && !edit && !show && LEADS_WITH_AN_OPEN_VERB.test(text);
  if (!edit && !show && !opens) return null;
  if ((opens || finds) && ADDED_VERB_THEN_A_NEW_ONE.test(text)) return null;
  const leading = anyOpenVerb ? LEADING_REQUEST_ANY_OPEN : LEADING_REQUEST;
  if (asksAboutForms(text) && !leading.test(text)) return null;

  const templateKey = templateNamed(text, anyOpenVerb);
  if (!templateKey && !POINTS_AT_A_FORM.test(text)) return null;

  return {
    mode: edit ? "edit" : "show",
    templateKey,
    asksChange: edit && asksForAChange(text),
    ...(opens ? { opensToEdit: true } : {}),
    ...(opens || finds ? { byAddedVerb: true } : {}),
  };
}

/**
 * The template a sentence names, read as the proposal flow reads one.
 *
 * `anyKind` (REOPEN_BY_ANY_OPEN_VERB_ENABLED): "Change <name> CA", "bring up
 * <name>'s corrective action" name the Corrective Action Form too, though the
 * intent reader calls them the progression (it cannot tell a form on file from
 * the process); and "coach <name>" names the Coaching Form it would ask about.
 */
function templateNamed(text: string, anyKind = false): string | null {
  const direct = detectTemplateIntent(text);
  if (direct.kind === "explicit") return direct.templateKey;
  const rest = text.replace(anyKind ? LEADING_REQUEST_ANY_OPEN : LEADING_REQUEST, "");
  const stripped = rest !== text ? detectTemplateIntent(rest) : null;
  if (stripped) {
    if (stripped.kind === "explicit") return stripped.templateKey;
    const leading = leadingFormRequest(rest);
    if (leading) return leading.templateKey;
  }
  if (!anyKind) return null;
  return templateOf(direct) ?? (stripped ? templateOf(stripped) : null);
}

/** The template a non-explicit reading still names: the Corrective Action Form for the progression, as the intake reads it. */
function templateOf(intent: TemplateIntent): string | null {
  if (intent.kind === "corrective_action") return "dpoa";
  if (intent.kind === "clarify") return intent.templateKey;
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
