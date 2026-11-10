import { appInstructionsNotAccountEnabled } from "@/lib/config/chat-quality-flags";
import { readsAsTeamSubject } from "@/lib/forms/team-subject";

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
 *
 * QA's live finding on Sunny round 17 (10 Nov 2026), the team card: "make me a coaching form for the team at Pine Lake
 * on selling lotion bottles" → Observation "the whole team: make me a coaching form for the team on selling lotion
 * bottles"; then "the employee needs to be left blank" → "the team on selling lotion bottles the employee needs to be
 * left blank". On a team card's turn (the intake's "Coaching Form for the whole team …:" marker) the marker and the
 * request lead ("make me a coaching form for") are no account either, and neither is a sentence that only says the
 * Employee field is to be left blank.
 */

const WORDING =
  /^\s*(?:please\s+|can\s+you\s+|could\s+you\s+)?(?:word|write|phrase|reword|make|keep)\s+(?:it|this|that|them|the\s+(?:form|document|wording|details|observation))\b[^.!?]{0,40}\b(?:professional(?:ly)?|formal(?:ly)?|polite(?:ly)?|clear(?:ly)?|nice(?:ly)?|neutral(?:ly)?)\b(?:\s+(?:way|tone|manner))?/i;
const POLICY_ON_FORM =
  /^\s*(?:please\s+|can\s+you\s+|could\s+you\s+|and\s+)?(?:(?:i|we)\s+(?:need|want|would\s+like)|(?:attach|include|add|put))\s+(?:the|a|our)\s+(?:\w+\s+){0,2}?polic(?:y|ies)\b(?:\s+(?:attached|included|on\s+(?:it|the\s+form)|cited|quoted|in))?(?:\s+as\s+well|\s+too|\s+also)?\s*[.!]?\s*$/i;

/** "The employee needs to be left blank for now" (the same reading as TEAM_CARD_NOT_PRODUCT's, `forms/team-card-not-product.ts`). */
const BLANK_EMPLOYEE =
  /\b(?:employee(?:'s)?(?:\s+name)?|name)\b[^.!?\n]{0,30}\b(?:left\s+blank|leave\s+(?:it\s+)?blank|blank|empty|no\s+one|nobody)\b|\bleave\s+(?:the\s+)?(?:employee|name)(?:\s+name)?\s+(?:field\s+)?blank\b/i;

/** Whether a sentence only tells the app how to word the form or to put the policy on it. */
export function isAppInstruction(sentence: string): boolean {
  const said = sentence.trim();
  if (said === "" || said.split(/\s+/).length > 16) return false;
  return WORDING.test(said) || POLICY_ON_FORM.test(said) || BLANK_EMPLOYEE.test(said);
}

/** The intake's team-card marker (`forms/whole-team-coaching.ts` wholeTeamRequest), with its salon. */
const TEAM_MARKER = /^\s*Coaching Form for the whole team(?:\s+at\s+[^:\n]+)?:\s*/i;
/** "make me a coaching form for", "can you create a coaching form for", "I need to make a coaching form for". */
const REQUEST_LEAD =
  /^\s*(?:(?:hi|hey|please)\s*,?\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:make|create|write|do|start|draft|put\s+together|(?:i|we)\s+(?:need|want|would\s+like)(?:\s+to\s+(?:make|create|do|write))?)\s+(?:me\s+|us\s+)?(?:a\s+|an\s+)?(?:new\s+)?c(?:oa|ao|oah)ch(?:ing)?\s+(?:form|document|doc|card)\b\s*(?:for\s+)?/i;

/** A team card's turn without the intake's marker and the request lead: "the team at Pine Lake on selling lotion bottles". */
function teamTurnAccount(text: string): string {
  // The marker on the turn the card is made; the manager's own turn, read back on later turns.
  if (!TEAM_MARKER.test(text) && !(REQUEST_LEAD.test(text) && readsAsTeamSubject(text))) return text;
  const words = text.replace(TEAM_MARKER, "").replace(REQUEST_LEAD, "").trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : "";
}

/** The text without its instructions to the app; line breaks kept. Off: as it is. */
export function withoutAppInstructions(text: string): string {
  if (!appInstructionsNotAccountEnabled()) return text;
  return text
    .split("\n")
    .map((line) =>
      teamTurnAccount(line)
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => !isAppInstruction(sentence))
        .join(" "),
    )
    .join("\n");
}
