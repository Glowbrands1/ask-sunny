import { appInstructionsNotAccountEnabled } from "@/lib/config/chat-quality-flags";

/*
 * ============================================================================
 * "PLEASE WORD IT IN A PROFESSIONAL WAY. I NEED THE POLICY ATTACHED AS WELL." IS NO ACCOUNT
 * (APP_INSTRUCTIONS_NOT_ACCOUNT_ENABLED)
 * ============================================================================
 *
 * QA's P12 part 2 (Sunny production, 6 Nov 2026): "Can you create me a coaching document for <A> for not hitting her
 * numbers for the month of October. Please word it in a professional way. I need the policy attached as well." — every
 * card's Observation read "not hitting her numbers for the month of October. Please word it in a professional way. I
 * need the policy attached as well." The last two sentences tell the app how to write the form and what to put on it;
 * they say nothing that happened. GRAMMAR_ASK_NOT_ACCOUNT reads only grammar requests and instructions asked as a
 * question. With this flag on, a sentence that only asks for the wording ("word it professionally", "make it sound
 * professional") or for the policy on the form ("I need the policy attached", "please include the policy") is left out
 * of the card's Observation and the draft's account. Pure.
 */

const WORDING =
  /^\s*(?:please\s+|can\s+you\s+|could\s+you\s+)?(?:word|write|phrase|reword|make|keep)\s+(?:it|this|that|them|the\s+(?:form|document|wording|details|observation))\b[^.!?]{0,40}\b(?:professional(?:ly)?|formal(?:ly)?|polite(?:ly)?|clear(?:ly)?|nice(?:ly)?|neutral(?:ly)?)\b(?:\s+(?:way|tone|manner))?/i;
const POLICY_ON_FORM =
  /^\s*(?:please\s+|can\s+you\s+|could\s+you\s+|and\s+)?(?:(?:i|we)\s+(?:need|want|would\s+like)|(?:attach|include|add|put))\s+(?:the|a|our)\s+(?:\w+\s+){0,2}?polic(?:y|ies)\b(?:\s+(?:attached|included|on\s+(?:it|the\s+form)|cited|quoted|in))?(?:\s+as\s+well|\s+too|\s+also)?\s*[.!]?\s*$/i;

/** Whether a sentence only tells the app how to word the form or to put the policy on it. */
export function isAppInstruction(sentence: string): boolean {
  const said = sentence.trim();
  if (said === "" || said.split(/\s+/).length > 16) return false;
  return WORDING.test(said) || POLICY_ON_FORM.test(said);
}

/** The text without its instructions to the app; line breaks kept. Off: as it is. */
export function withoutAppInstructions(text: string): string {
  if (!appInstructionsNotAccountEnabled()) return text;
  return text
    .split("\n")
    .map((line) =>
      line
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => !isAppInstruction(sentence))
        .join(" "),
    )
    .join("\n");
}
