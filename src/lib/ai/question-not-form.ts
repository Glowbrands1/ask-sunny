/**
 * ============================================================================
 * A QUESTION IS ANSWERED. IT IS NEVER A FORM TURN.
 * ============================================================================
 *
 * Live replay on production, 25 Oct 2026. After an answer that ended "ask me
 * to create a coaching form or a policy review for them", the next questions
 * came back as form turns:
 *
 *   "how many hours is a part-time tanning consultant?"      → "Which form did
 *   "what's policy on bereavement", "whats policy about        you mean? 1.
 *    smoke breaks", "whats policy about brining pets …"         Coaching Form …"
 *   "smoking policy", "difference between ca and coaching
 *    form", "hey what policies can you write someone up for
 *    …", "footwear for employees"                            → "Who is this
 *   "employee has been late twice. should i do a coaching or     Corrective
 *    corrective action"                                          Action Form for?"
 *
 * The slot reader grounds the form from the whole conversation, the
 * assistant's own offer included, so every turn after that offer named one
 * form (a card) or several (the "Which form did you mean?" menu). The proposal
 * then read the question as the card's What happened.
 *
 * This is the one reading every form path asks first. A turn is a question
 * when it asks something — a policy, how-to or advice question, or a short
 * policy lookup ("smoking policy") — and asks nothing to be created or changed.
 * A question is answered: it skips the slot reader, the form chooser, the
 * proposal ("Who is this … for?"), the full remap and the open-form
 * correction and revision paths, so nothing is written into a form field.
 *
 * Only a question is held back. A create or edit request still makes or edits
 * its card however it is phrased ("can you create a CA for …?", "change the
 * date to 10-22", "create a coaching document for … regarding …"), and a
 * statement ("Her name is …", "she opened late on 10-20") stays a form turn,
 * exactly as before. Reading a request as a question would lose a card, so
 * anything in doubt is left on the path it already had.
 */

type Turn = { readonly role: string; readonly content: string };

/** A verb that asks for something to be made or changed, at the head of a clause. */
const ACTION =
  String.raw`(?:create|creating|make|making|write|writing|draft|drafting|redraft|start|starting|prepare|preparing|fill|filling|generate|redo|open|reopen|add|change|update|edit|set|fix|correct|remove|delete|replace|reference|cite|use|put|include|swap|switch|move|clean|carry|finalize|save|submit|attach|mark|enter|type|format|rewrite|reword|amend|send|print|email|issue|document|log|record|file|assist|pull|bring|insert|give\s+(?:her|him|them)|get\s+(?:me\s+)?(?:a|an|the)|do(?:ing)?\s+(?:a|an|another|the|it|this|that|one|her|his|their|my|our|up)\b)`;

/** Words ahead of the clause that carry nothing: "hey what policies …", "ok so should I …". */
const FILLER = /^(?:(?:hey|hi|hello|ok(?:ay)?|so|and|also|um+|uh+|quick\s+question|question|yes|yeah|no|thanks|thank\s+you|sorry)\b[\s,:;!.-]*)+/i;

const IMPERATIVE = new RegExp(String.raw`^(?:please\s+|pls\s+|now\s+|just\s+|then\s+)*${ACTION}\b`, "i");

/** "can you create …", "could you please help me draft …", "would u add …". */
const ASKED_TO_ACT = new RegExp(
  String.raw`^(?:can|could|would|will)\s+(?:you|u|ya)\s+(?:please\s+|pls\s+|just\s+|also\s+)*(?:help\s+(?:me\s+)?(?:to\s+)?|go\s+ahead\s+and\s+)?(?:${ACTION}|do)\b`,
  "i",
);

/** "can I get a CA for …", "may we start a coaching form …". */
const ASKS_TO_GET = /^(?:can|could|may)\s+(?:i|we)\s+(?:please\s+)?(?:get|have|start|create|make|do|write|draft|open|file|add|change|update)\b/i;

/** "I need a CA for …", "we'd like a coaching form", "i want you to add …" — not "I need to know …". */
const WANTS = /^(?:i|we)\s*(?:really\s+)?(?:need|want|would\s+like|'d\s+like|wanna|gotta)\b(?!\s+to\s+(?:know|understand|find\s+out|check|ask|see|learn|figure|confirm|be\s+sure|make\s+sure\s+i\s+understand))/i;

/** "let's start over", "help me create …", "assist with creating …", "how about a verbal instead", "why not …". */
const SUGGESTS = new RegExp(
  String.raw`^(?:let'?s|lets|help\s+me\s+(?:with\s+)?${ACTION}|how\s+about|what\s+about|what\s+if|why\s+not|why\s+don'?t\s+you|go\s+ahead)\b`,
  "i",
);

/**
 * A create request anywhere in the clause: "is it possible to create …",
 * "would you mind writing …", "I'd like you to add …". Not "what policies can
 * you write someone up for", which asks which policies.
 */
const ANY_CREATE =
  /\b(?:possible|able)\s+to\s+(?:create|make|write|draft|start|do|open|fill)\b|\byou\s+mind\s+(?:creating|making|writing|drafting|starting|filling|adding|changing|updating|editing)\b|\b(?:want|need|like)\s+(?:you|u)\s+to\b/i;

/** A clause that asks: an interrogative word or an auxiliary at its head. */
const WH = /^(?:what|what'?s|whats|which|why|how|who|whom|whose)\b/i;
/** "when / where" open a statement as often as a question ("when she came in …"): they ask only with a question mark. */
const WH_NEEDS_MARK = /^(?:when|where)\b/i;
const AUX =
  /^(?:should|shall|is|isn'?t|are|aren'?t|was|were|can|could|would|will|may|might|must|have|has|am|any|anything)\b/i;
/**
 * "do we have …", "does that need …": "do" asks only with a subject after it.
 * "do verbal for team member …" and "do a ca …" are requests.
 */
const DO_SUBJECT = String.raw`(?:i|we|you|u|they|he|she|it|that|this|these|those|there|employees?|staff|managers?|people|our|my|the|team|tcs?|someone|anyone|everyone|all)`;
const DO_ASKS = new RegExp(String.raw`^(?:do|does|did|don'?t|doesn'?t|didn'?t)\s+${DO_SUBJECT}\b`, "i");
const DO_REQUEST = new RegExp(String.raw`^(?:please\s+)?do\s+(?!${DO_SUBJECT}\b)\S`, "i");
/** "what happened was …", "what she did …": an account of the incident, not a question. */
const ACCOUNT = /^what\s+(?:happened|she|he|they|i|we)\b/i;

/** A policy looked up by topic: "smoking policy", "policy specific to uggs?", "difference between ca and coaching form". */
const POLICY_WORD = /\bpolic(?:y|ies)\b/i;
const DIFFERENCE = /^(?:the\s+)?differences?\s+between\b|\b(?:vs\.?|versus)\b/i;
/** "footwear for employees": a standard for everyone, not one person's form. */
const FOR_EVERYONE = /\bfor\s+(?:all\s+)?(?:employees|staff|team\s+members|the\s+team|everyone|managers|associates)\s*\??$/i;
/** A clause that tells what someone did is an account of the incident, not a lookup. */
const ACCOUNT_VERB =
  /\b(?:violated|violates|violating|broke|breaks|broken|was|were|did|didn'?t|has|had|hasn'?t|failed|fails|opened|left|came|called|said|told|refused|missed|got|is|isn'?t|keeps|kept)\b/i;

function clauses(text: string): string[] {
  return text
    .split(/(?<=[?!.])\s+|\n+/)
    .map((part) => part.trim().replace(FILLER, "").trim())
    .filter((part) => part !== "");
}

/** A clause that asks for something to be created, changed or filled. */
function isRequest(clause: string): boolean {
  return (
    IMPERATIVE.test(clause) ||
    DO_REQUEST.test(clause) ||
    ASKED_TO_ACT.test(clause) ||
    ASKS_TO_GET.test(clause) ||
    WANTS.test(clause) ||
    SUGGESTS.test(clause) ||
    ANY_CREATE.test(clause)
  );
}

function asks(clause: string): boolean {
  if (ACCOUNT.test(clause) && !/\?\s*$/.test(clause)) return false;
  if (WH.test(clause) || AUX.test(clause) || DO_ASKS.test(clause)) return true;
  return WH_NEEDS_MARK.test(clause) && /\?\s*$/.test(clause);
}

function words(clause: string): number {
  return clause.split(/\s+/).filter(Boolean).length;
}

/** "I explained the attendance policy", "we reviewed …": somebody did something, so it is an account. */
const SOMEONE_DID = /^(?:i|we|she|he|they|you|it|her|his|my|our|their|this|that)\b|\b[a-z]{3,}ed\b|\b(?:covers|says|explains|reviews|discusses|goes|went)\b/i;

/** A short topic lookup — a noun phrase — with no account of an incident in it. */
function looksUp(clause: string): boolean {
  if (DIFFERENCE.test(clause)) return true;
  if (words(clause) > 6 || ACCOUNT_VERB.test(clause) || SOMEONE_DID.test(clause)) return false;
  return POLICY_WORD.test(clause) || FOR_EVERYONE.test(clause);
}

/**
 * The assistant's last turn asked the manager something ("**Which policy
 * applies?** 1. Cell Phone … 2. Social Media …"), so a bare topic may be the
 * answer to it.
 */
function answeringAQuestion(history: readonly Turn[]): boolean {
  const last = [...history].reverse().find((turn) => turn.role === "assistant");
  return Boolean(last && last.content.includes("?"));
}

/**
 * True when this turn is a question to answer, never a form turn.
 *
 * A turn with any request clause is not one ("employee was late. can you
 * create a CA for her?"). A turn with a clause that asks is one ("employee has
 * been late twice. should i do a coaching or corrective action"). A turn that
 * is only a short policy lookup is one, unless the assistant's last turn asked
 * the manager something, when it may be the answer.
 */
export function isQuestionNotForm(question: string, history: readonly Turn[] = []): boolean {
  const parts = clauses(question);
  if (parts.length === 0) return false;
  if (parts.some(isRequest)) return false;
  if (parts.some(asks)) return true;
  return parts.length === 1 && looksUp(parts[0]!) && !answeringAQuestion(history);
}
