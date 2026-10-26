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

/** Whether a sentence would hand out a default password or SSN digits. */
export function isSensitiveSentence(sentence: string): boolean {
  return (SSN.test(sentence) && DIGIT_FORMAT.test(sentence)) || DEFAULT_PASSWORD.test(sentence) || SSN_DIGITS.test(sentence);
}

/**
 * Said in place of what was taken out of a knowledge excerpt, and of a reply
 * (QA P0 follow-up, 26 Oct 2026). Neither says what was taken out: naming
 * Social Security digits or a default format hints at the very thing hidden.
 */
export const EXCERPT_NOTE =
  "(Sign-in details are not shared in chat. Use Forgot your password? on the log-in screen, or ask a manager to reset it.)";
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
export function redactSensitiveDefaults(text: string, note: string = EXCERPT_NOTE): string {
  if (!sensitiveDefaultsRedactEnabled() || !text) return text;
  const parts = text.split(/(?<=[.!?])(\s+)|(\n)/);
  let changed = false;
  let noteSaid = false;
  const out: string[] = [];
  for (const part of parts) {
    if (part === undefined) continue;
    if (/^\s*$/.test(part)) {
      out.push(part);
      continue;
    }
    if (isSensitiveSentence(part) && !isNoInformation(part)) {
      changed = true;
      // The note once per text, wherever the sentences were.
      if (!noteSaid) out.push(note);
      noteSaid = true;
      continue;
    }
    out.push(part);
  }
  if (!changed) return text;
  // The model's own "ask your manager to reset it" would repeat the note.
  const kept = out.filter((part) => part === note || !RESET_ADVICE.test(part));
  return kept.join("").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

/** A response with the same redaction on its reply and on every cited excerpt. Off, the response as given. */
export function withoutSensitiveDefaults<T extends { content: string; citations?: readonly { excerpt: string }[] }>(response: T): T {
  if (!sensitiveDefaultsRedactEnabled()) return response;
  const content = redactSensitiveDefaults(response.content, REPLY_NOTE);
  const citations = response.citations?.map((citation) => {
    const excerpt = redactSensitiveDefaults(citation.excerpt);
    return excerpt === citation.excerpt ? citation : { ...citation, excerpt };
  });
  const citationsChanged = citations?.some((citation, index) => citation !== response.citations![index]) ?? false;
  if (content === response.content && !citationsChanged) return response;
  return { ...response, content, ...(citations ? { citations } : {}) };
}
