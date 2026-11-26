/*
 * ============================================================================
 * A COACHING HOW-TO ANSWER ALWAYS HANDS THE MANAGER SOMETHING TO SAY (26 Nov 2026)
 * ============================================================================
 *
 * "How do I coach someone who keeps showing up late", "give me a script for talking to an employee about their
 * attitude", "tips for a hard conversation with a leader about follow-ups": the rules book said such advice is answered
 * "in full (steps, a checklist, a sample script or role-play)". "A" and "or" let an answer be four generic tips, and
 * answers varied. Now every coaching / hard-conversation / HR how-to answer carries:
 *
 *   1. a short OUTLINE of the conversation: opening, the facts and the expectation, listening, agreement on next steps,
 *      a follow-up date;
 *   2. a SAMPLE SCRIPT in quotation marks, tailored to what the manager described, that they can read aloud;
 *   3. a short CHECKLIST.
 *
 * It cites the JBA Policy Manual when a policy applies (never renaming the manual), proposes no form, and may offer one
 * in a closing line. Coaching is framed as developing the person; a concern is named only when the manager described one
 * (`src/lib/forms/coaching-framing.ts`).
 *
 * Both chat paths read the rule from here: the agent loop's rules book (`agent-loop/rules-book.ts`) and the older chat
 * prompt (`prompts.ts`, `withCoachingHowTo`). The loop also checks its reply (`coachingAnswerShape`) and hands a reply
 * with no outline or no quoted script back once (`agent-loop/run.ts`). Pure: reads text only.
 */

/** The rule, as both prompts give it. `place` is the app's word for a location ("salon", "store"). */
export function coachingHowToRule(place: string): string {
  return (
    "Every answer to advice or a how-to about coaching, a hard conversation, corrective action, follow-ups or any HR topic (\"how do I coach someone who keeps showing up late\", \"give me a script for talking to an employee about their attitude\", \"tips for a hard conversation with a leader about follow-ups\") gives the manager something usable, always all three: " +
    "(1) a short outline of the conversation, as a numbered list: the opening, the facts and the expectation, listening to their side, agreement on next steps, and a follow-up date; " +
    "(2) a sample script in quotation marks that the manager can read aloud word for word, tailored to the situation they described (the behavior, the person's role, the " + place + "), framed as developing the person, naming a concern only when the manager described one; " +
    "(3) a short checklist. Cite the JBA Policy Manual by its title and the section's heading when a policy applies, and never invent one. Advice asks for no form: never propose a form and never ask who a form is for; a closing line may offer one."
  );
}

/** A numbered or bulleted list item at the start of a line. */
const LIST_ITEM = /^\s*(?:\d{1,2}[.)]|[-*•]|#{1,4}\s+\d{1,2}[.)]?)\s+\S/;

/** A quoted passage the manager can say: straight, curly or guillemet quotes around at least eight words. */
const QUOTED = /["“«]([^"“”«»\n]{20,})["”»]/g;

/** A blockquote line ("> I want to talk about …") of at least eight words. */
const BLOCKQUOTE = /^\s*>\s*(?:\S+\s+){7,}\S/m;

/** Whether a reply carries the outline (three list items or more) and a quoted script (eight words or more). */
export function coachingAnswerShape(reply: string): { outline: boolean; script: boolean } {
  const text = String(reply ?? "");
  const items = text.split("\n").filter((line) => LIST_ITEM.test(line)).length;
  const quoted = [...text.matchAll(QUOTED)].some((match) => match[1]!.trim().split(/\s+/).length >= 8);
  return { outline: items >= 3, script: quoted || BLOCKQUOTE.test(text) };
}

/** Words that make an advice request about coaching or a hard conversation (not a policy lookup such as PTO). */
const COACHING_TOPIC =
  /\b(?:coach\w*|conversations?|talk(?:ing)?\s+(?:to|with)|speak(?:ing)?\s+(?:to|with)|say\s+to|what\s+(?:do|should|can)\s+i\s+say|script|feedback|follow-?\s?ups?|corrective\s+action|discipline|attitude|counsel\w*|confront\w*|role-?\s?play|tough|hard|difficult|(?:showing|show|shows|coming|comes|come|being|running|clocking)\s+(?:up\s+|in\s+)?late|tard(?:y|iness)|no[- ]calls?|no[- ]shows?|motivat\w*|underperform\w*)\b/i;

/**
 * Whether the manager's words ask how to coach or how to run a hard conversation. `adviceNotForm` (the loop's reading
 * that a turn asks for advice and for no form) is the caller's: this only adds that the advice is about coaching.
 */
export function asksCoachingHowTo(question: string): boolean {
  return COACHING_TOPIC.test(String(question ?? ""));
}

/** The loop's hand-back note when an advice reply has no outline or no quoted script. */
export function coachingHowToNote(shape: { outline: boolean; script: boolean }): string {
  const missing = [!shape.outline ? "a short numbered outline of the conversation (opening, the facts and the expectation, listening, agreement on next steps, a follow-up date)" : null, !shape.script ? "a sample script in quotation marks the manager can read aloud, tailored to what they described" : null].filter(Boolean);
  return `[app check] The manager asked how to coach or run a hard conversation, and your reply is missing ${missing.join(" and ")}. Write your answer again with all three: the numbered outline, the quoted script and a short checklist, citing the JBA Policy Manual where a policy applies. Propose no form and never ask who a form is for; you may offer one in a closing line.`;
}

/** The older chat path's rule line, inserted after the signature-lines rule (both prompt branches carry that line). */
export const SIGNATURE_RULE = "- Signature lines, corrective-action decisions and anything with legal weight stay with the manager. Point them at the policy language; do not decide for them.";

/** The older chat prompt with the coaching how-to rule after the signature-lines rule; unchanged when that line is absent. */
export function withCoachingHowTo(prompt: string, place: string): string {
  if (!prompt.includes(SIGNATURE_RULE)) return prompt;
  return prompt.split(SIGNATURE_RULE).join(`${SIGNATURE_RULE}\n- ${coachingHowToRule(place)}`);
}
