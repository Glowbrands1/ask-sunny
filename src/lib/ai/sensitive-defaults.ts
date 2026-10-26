import { sensitiveDefaultsRedactEnabled } from "@/lib/config/chat-quality-flags";

/**
 * ============================================================================
 * A DEFAULT PASSWORD FORMAT OR SSN DIGITS NEVER REACH A CHAT ANSWER
 * (SENSITIVE_DEFAULTS_REDACT_ENABLED)
 * ============================================================================
 *
 * QA P0, 25 Oct 2026 (conv_mvohwwbi2z2lavh): "I forgot my Ask Sunny password
 * and I cannot log in, how do I reset it?" was answered with the default
 * password pattern that a manager-side reset page in the knowledge base gives,
 * a pattern built from part of an employee's Social Security number, and the
 * page was cited. Any chat user could read it.
 *
 * The knowledge rows are not changed. At answer time, every sentence that
 * states a default, temporary or starting password, a password's value, or
 * digits of a Social Security number is taken out — of the excerpts the model
 * is given, and again of the reply and its cited excerpts — and replaced by
 * one plain line: ask your manager or HR to reset it. The rest of the source
 * stays usable. Off, the text is returned as given.
 */

/** A sentence that names a Social Security number. */
const SSN = /\b(?:ssn|ss#|social\s+security)\b/i;
/**
 * …together with which of its digits, or a default built from them. A list
 * that only names SSNs and passwords as confidential (the manual's
 * Confidential Information Policy) is kept.
 */
const DIGIT_FORMAT = /\b(?:last|first)\s+(?:\d|four|five|two|three)\b|\bdigits?\b|\bfollowed\s+by\b|\bplus\b|\+|\bdefault\b/i;
/** A default, temporary or starting password, or a password's value. */
const DEFAULT_PASSWORD =
  /\b(?:default|temporary|temp|initial|generic|standard|starting|first[- ]time|universal|master)\s+(?:pass\s?words?|passcodes?|pw|pins?|log-?\s?ins?|credentials?)\b|\b(?:pass\s?word|passcode|pw)\s*(?:is|will\s+be|=|:)\s*(?!\s*(?:reset|sent|changed|required|case|expired|not\b|incorrect|wrong|being|updated|forgotten|lost|locked))\S/i;
/** Written-out SSN digits. */
const SSN_DIGITS = /\b\d{3}-\d{2}-\d{4}\b|\b(?:x{3}|\*{3})-(?:x{2}|\*{2})-\d{4}\b/i;

/**
 * "Do not use default passwords, i.e., password123." is the manual's own
 * password guidance, not a default to hand out (QA live, 26 Oct 2026: every
 * "whats our password policy" answer lost it and got the note instead).
 *
 * ONLY A PURE FORBID IS KEPT (QA-3, QA-5): the sentence forbids default
 * passwords and says nothing else about one. Before the forbid there is no
 * value; after it there is only the end of the sentence, the manual's own
 * "i.e., password###" example, "are not allowed", or a plain "for/on/in …"
 * phrase. A value anywhere ("…, which is Welcome2024.", "… password
 * Welcome2024.", "(it is Welcome1)"), a second default-password mention ("…
 * but the first-time password is Temp123.") or SSN wording, and the sentence
 * is removed as before.
 */
const FORBIDS_DEFAULTS =
  /\b(?:do\s+not|don'?t|never|avoid(?:ing)?|no)\s+(?:use\s+|using\s+)?(?:a\s+|the\s+|any\s+)?(?:default|generic|standard)\s+pass\s?words?\b/i;
/** What may follow a pure forbid, up to the end of the sentence. The example is the placeholder only ("password###"); a digit run is a value. */
const FORBID_TAIL_OK =
  /^\s*(?:,?\s*(?:i\.e\.|e\.g\.|like|such\s+as)\s*,?\s*["“']?password(?:#+|x+|\*+)?["”']?|(?:are|is)\s+(?:not\s+)?(?:allowed|permitted|acceptable)|(?:for|on|at|in|with|anywhere|ever|again|when)\b[^.!?;:,"“”'()\d]*)?\s*[.!?]?\s*$/i;
/** What may come before it: a plain lead-in, no value. */
const FORBID_LEAD_OK = /^[^\d:;"“”()]*$/;
const VALUE_WORD = /\b(?:is|are|was|were|=)\s+\S/i;

function isPureForbid(sentence: string): boolean {
  const match = FORBIDS_DEFAULTS.exec(sentence);
  if (!match) return false;
  const lead = sentence.slice(0, match.index);
  const tail = sentence.slice(match.index + match[0].length);
  if (!FORBID_LEAD_OK.test(lead) || VALUE_WORD.test(lead) || DEFAULT_PASSWORD.test(lead)) return false;
  return FORBID_TAIL_OK.test(tail);
}

/** Whether a sentence would hand out a default password or SSN digits. */
export function isSensitiveSentence(sentence: string): boolean {
  if (SSN.test(sentence) && DIGIT_FORMAT.test(sentence)) return true;
  if (SSN_DIGITS.test(sentence)) return true;
  return DEFAULT_PASSWORD.test(sentence) && !isPureForbid(sentence);
}

/** "what is the default password", "temp password for a new hire", "defualt login". */
const ASKS_DEFAULT =
  /\b(?:default|defualt|deafult|defalt|defult|dafault|temporary|temp|initial|starting|first[- ]time|generic|universal|master)\s+(?:pass\s?words?|passwrds?|paswords?|passcodes?|pw|pins?|log-?\s?ins?|credentials?)\b/i;

/** Whether the question asks for a default, temporary or starting password. */
export function asksForDefaultPassword(question: string | null | undefined): boolean {
  return ASKS_DEFAULT.test(question ?? "");
}

/**
 * Said in place of what was taken out of a knowledge excerpt, and of a reply
 * (QA P0 follow-up, 26 Oct 2026). Neither says what was taken out: naming
 * Social Security digits or a default format hints at the very thing hidden.
 * The excerpt's note names no system, so an answer about another system's
 * password never picks up this app's reset link from it.
 */
export const EXCERPT_NOTE = "(This line is not shared in chat.)";
export const REPLY_NOTE =
  "I can't share anyone's password from here. If you're locked out, use **Forgot your password?** on the log-in screen, or ask your manager to reset it.";

/** A reply sentence that already tells the person to get a reset: the note says it, so it is not said twice. */
const RESET_ADVICE = /\b(?:ask|contact|reach\s+out\s+to|talk\s+to|check\s+with|see)\b[^.!?\n]*\b(?:manager|hr|administrator|admin)\b[^.!?\n]*\breset\b|\bforgot\s+your\s+password\b/i;

/**
 * "I don't have anything about MyGlow's default password." says nothing
 * sensitive and is the honest answer when the knowledge base has nothing:
 * kept, unless it also has a digit, a Social Security mention or goes on
 * ("but", "however", ";") to say more.
 */
const NO_INFORMATION =
  /\b(?:don'?t|do\s+not|doesn'?t|does\s+not|can'?t|cannot|couldn'?t|no)\b[^.!?\n]{0,40}\b(?:have|find|know|see|information|anything|details?|record|mention)\b/i;
const SAYS_MORE = /\d|\b(?:but|however|though|although|instead)\b|;/i;

function isNoInformation(sentence: string): boolean {
  return NO_INFORMATION.test(sentence) && !SAYS_MORE.test(sentence) && !SSN.test(sentence) && !SSN_DIGITS.test(sentence);
}

/**
 * The text with its sensitive sentences taken out and `note` said once, where
 * the first one was; a sentence that only says nothing is known is kept, and
 * one that already sends the person to a reset is dropped so the advice is not
 * given twice. Sentences end at . ! ? or a line break; everything else is kept
 * as written. Off, the text as given.
 */
/** A sentence ends at . ! ? and a line break, never at "e.g.", "i.e.", "etc." or "vs.". */
const SENTENCE_BREAK = /(?<=[.!?])(?<!\b(?:e\.g|i\.e|etc|vs)\.)(\s+)|(\n)/i;

/**
 * A value on its own right after a default-password sentence: "It is
 * Welcome2024.", "The password is X.", "Use X.", a bare "Winter2024" line or
 * bullet (QA-3/QA-5, 26 Oct 2026). It is removed with the sentence before it.
 */
const VALUE_AFTER =
  /^\s*(?:[-*•]\s*)?((?:it\s+is|it'?s|that\s+is|the\s+(?:default\s+|temporary\s+|temp\s+|starting\s+|initial\s+)?pass\s?word\s+is|use|try|enter)\s+)?(["“'(]?)([^\s"”')]+)["”')]?\s*[.!?]?\s*$/i;

/** Whether a piece is only a value: a token with a digit, a quoted token, or a capitalised one after "is/use". */
function isValueAfter(piece: string): boolean {
  const match = VALUE_AFTER.exec(piece);
  if (!match) return false;
  const [, lead, quote, token] = match;
  if (/\d/.test(token!) || quote) return true;
  return Boolean(lead) && /^[A-Z]/.test(token!);
}
const NAMES_DEFAULT = /\b(?:default|defualt|temporary|temp|initial|starting|first[- ]time)\s+(?:pass\s?words?|passcodes?|pw|pins?|log-?\s?ins?)\b/i;

/**
 * DENY BY DEFAULT AFTER A DEFAULT-PASSWORD SENTENCE (QA-3, QA-5, coordinator,
 * 26 Oct 2026). Once a sentence names a default password — kept as a pure
 * forbid or removed — every sentence and line after it, up to a blank line, is
 * suspect: "Do not use default passwords. Instead use Welcome2024." kept the
 * second sentence because it was judged alone and never says "password". In
 * that window a piece is removed when it has
 *   - a token mixing letters and digits, or a run of four or more digits;
 *   - a value tail: "(instead) use / try / enter / it is / it's / the default
 *     is / the starting one is <one word>", with an optional "instead";
 *   - a leading value: "<one token> is the one / works / will work".
 * Plain advice is kept: "The password should be 8-10 characters long.",
 * "Include numbers.", "Choose a strong password.", "See the IT section.", a
 * heading like "Security". Citation markers ("[S1]", "[p.14]") never count.
 */
const MARKERS = /\[[^\]\n]*\]/g;
const DIGIT_TOKEN = /(?<![\w-])(?=[\w@#$%&*!.-]*[a-z])(?=[\w@#$%&*!.-]*\d)(?!\d+(?:st|nd|rd|th|am|pm)\b)(?!p\.\d)[\w@#$%&*!.-]*\w|\d{4,}/i;
const NOT_A_VALUE =
  /^(?:caution|care|judgment|judgement|discretion|required|optional|allowed|permitted|prohibited|recommended|mandatory|important|necessary|confidential|private|case-sensitive|unique|it|them|this|that|one|these|those|instead)$/i;
const VALUE_TAIL =
  /\b(?:instead\s+use|use|try|enter|type|it\s+is|it'?s|that\s+is|(?:the\s+)?(?:default|starting|initial|temporary|temp|first(?:[- ]time)?|new)(?:\s+(?:one|password|pass\s?word|pw|code))?\s*(?:is|:))\s+["“'(]?([^\s"”')]+?)["”')]?(?:\s+(?:instead|then|now))?\s*[.!?]?\s*$/i;
const LEADING_VALUE =
  /^\s*(?:[-*•▪]\s*)?["“'(]?([^\s"”')]+)["”')]?\s+(?:is\s+(?:the\s+(?:one|password|default|code)|it)|works|will\s+work)\b[^.!?\n]*[.!?]?\s*$/i;

/** Whether a piece in the window after a default-password sentence may carry a value. */
function isSuspectAfterDefault(piece: string): boolean {
  if (isValueAfter(piece)) return true;
  const text = piece.replace(MARKERS, " ");
  if (DIGIT_TOKEN.test(text)) return true;
  const tail = VALUE_TAIL.exec(text);
  if (tail && !NOT_A_VALUE.test(tail[1]!)) return true;
  const lead = LEADING_VALUE.exec(text);
  return Boolean(lead && !NOT_A_VALUE.test(lead[1]!));
}

export function redactSensitiveDefaults(text: string, note: string | null = EXCERPT_NOTE): string {
  if (!sensitiveDefaultsRedactEnabled() || !text) return text;
  const parts = text.split(SENTENCE_BREAK);
  let changed = false;
  let noteSaid = false;
  // The window after a default-password sentence; a blank line closes it.
  let afterDefault = false;
  let gap = "";
  const out: string[] = [];
  for (const part of parts) {
    if (part === undefined) continue;
    if (/^\s*$/.test(part)) {
      gap += part;
      out.push(part);
      continue;
    }
    if (/\n[ \t]*\n/.test(gap)) afterDefault = false;
    gap = "";
    const valueAfter = afterDefault && isSuspectAfterDefault(part);
    if (valueAfter || (isSensitiveSentence(part) && !isNoInformation(part))) {
      changed = true;
      // The note once per text, wherever the sentences were; none when null.
      if (!noteSaid && note !== null) out.push(note);
      noteSaid = true;
      afterDefault = true;
      continue;
    }
    if (NAMES_DEFAULT.test(part)) afterDefault = true;
    out.push(part);
  }
  if (!changed) return text;
  // The model's own "ask your manager to reset it" would repeat the note.
  const kept = note === null ? out : out.filter((part) => part === note || !RESET_ADVICE.test(part));
  const joined = kept.join("").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
  // Nothing left but whitespace: the note after all, never an empty text.
  return joined.length > 0 ? joined : (note ?? REPLY_NOTE);
}

/**
 * A response with the same redaction on its reply and on every cited excerpt.
 * The reply says the note only when the question asked for a default or
 * starting password (QA live, 26 Oct 2026): a Paycor, Revel, myGLOW or
 * password-policy answer that loses a sentence just loses that sentence.
 * Off, the response as given.
 */
export function withoutSensitiveDefaults<T extends { content: string; citations?: readonly { excerpt: string }[] }>(
  response: T,
  question?: string | null,
): T {
  if (!sensitiveDefaultsRedactEnabled()) return response;
  const content = redactSensitiveDefaults(response.content, asksForDefaultPassword(question) ? REPLY_NOTE : null);
  const citations = response.citations?.map((citation) => {
    const excerpt = redactSensitiveDefaults(citation.excerpt);
    return excerpt === citation.excerpt ? citation : { ...citation, excerpt };
  });
  const citationsChanged = citations?.some((citation, index) => citation !== response.citations![index]) ?? false;
  if (content === response.content && !citationsChanged) return response;
  return { ...response, content, ...(citations ? { citations } : {}) };
}
