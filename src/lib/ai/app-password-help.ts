import { STC_BRAND } from "@/lib/brand";
import { appPasswordHelpEnabled } from "@/lib/config/chat-quality-flags";

/**
 * ============================================================================
 * "I FORGOT MY PASSWORD" IS ANSWERED ABOUT THIS APP FIRST
 * (APP_PASSWORD_HELP_ENABLED)
 * ============================================================================
 *
 * QA, 25 Oct 2026: "how do i chnge my passwrd", "forgot password" then "just
 * reset it", and "I forgot my Ask Sunny password and I cannot log in, how do
 * I reset it?" were answered about other systems' passwords, or asked which
 * login twice, and never said how to reset this app's own. Pau: "if they
 * forgot sunny or bubble password they can click the link in the log in
 * screen forgot password".
 *
 * A question about one's own password or sign-in, that names no other system,
 * is answered here, in plain words, with the sign-in page's own link label
 * ("Forgot your password?", `features/auth/sign-in-form.tsx`). Another system
 * is mentioned only when the manager names it, and then the question goes to
 * the knowledge base as before. Off, null: the turn is answered as before.
 */

/** The link the sign-in page shows. */
export const FORGOT_LINK_LABEL = "Forgot your password?";

const PASSWORD = /\bp[a@]s{1,2}w[o0]?r?d?s?\b|\bpasswrd\b|\bpaswrd\b|\bpasword\b|\bpassowrd\b|\bpw\b|\blog\s?-?in\b|\bsign\s?-?in\b|\blog\s+(?:on|into|in to)\b|\bsign\s+(?:on|into|in to)\b/i;
const ACTION =
  /\b(?:reset|rest|forgot|forget|forgotten|forgetting|change|chnge|chng|chang|changing|update|new|lost|locked(?:\s+out)?|lockout|can'?t|cant|cannot|can not|unable|won'?t|wont|doesn'?t|isn'?t|not\s+working|expired|recover|help)\b/i;
/** A system or a person that is not this app's own sign-in. */
const OTHER_SYSTEM =
  /\b(?:my\s?glow|mygl[o0]w|revel|paycor|woven|appointedd|e-?mail|outlook|gmail|office|microsoft|wi-?fi|router|network|alarm|register|pos|point\s+of\s+sale|computer|laptop|ipad|tablet|kiosk|voicemail|teams|zoom|google|instagram|facebook|employee'?s|an\s+employee|team\s+member'?s|their|his|her|default)\b/i;
/** A question about a password policy, not a reset. */
const ASKS_POLICY = /\bpassword\s+polic(?:y|ies)\b|\bpolic(?:y|ies)\s+(?:on|about|for)\s+passwords?\b/i;
/** A short go-ahead after a password question: "just reset it". */
const GO_AHEAD = /^\s*(?:(?:ok(?:ay)?|please|pls|just|can\s+you|could\s+you|then)\s+)*(?:reset|do|fix|change|send)\s+(?:it|that|this|mine|my\s+password)(?:\s+(?:now|please|pls|for\s+me))*\s*[.!?]*\s*$/i;

/** Whether a turn asks how to reset or change one's own sign-in password for this app. */
export function isAppPasswordQuestion(question: string): boolean {
  const text = (question ?? "").trim();
  if (text === "" || text.split(/\s+/).length > 30) return false;
  if (ASKS_POLICY.test(text) || OTHER_SYSTEM.test(text)) return false;
  return PASSWORD.test(text) && ACTION.test(text);
}

/** The answer, in the app's own name. */
export function appPasswordAnswer(productName: string = STC_BRAND.productName): string {
  return [
    `To reset your ${productName} password, click **${FORGOT_LINK_LABEL}** on the log-in screen. Enter your work email address and we'll send you a link to set a new password. The link works once.`,
    "",
    "If the email doesn't arrive in a few minutes, check your spam folder, then ask your manager or an administrator to send you a reset. Nobody needs your old password, and I can't reset it from the chat.",
    "",
    "If you meant the password for a different system, tell me which one.",
  ].join("\n");
}

/**
 * The fixed answer for this turn, or null. A go-ahead ("just reset it") right
 * after a password question gets the same answer, never a second question.
 */
export function appPasswordHelpFor(
  question: string,
  history: readonly { role: string; content: string }[],
): string | null {
  if (!appPasswordHelpEnabled()) return null;
  if (isAppPasswordQuestion(question)) return appPasswordAnswer();
  if (!GO_AHEAD.test(question ?? "")) return null;
  const previous = [...history].reverse().find((turn) => turn.role === "user" && typeof turn.content === "string");
  return previous && isAppPasswordQuestion(previous.content) ? appPasswordAnswer() : null;
}
