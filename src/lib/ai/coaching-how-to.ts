/*
 * ============================================================================
 * A COACHING HOW-TO ANSWER IS A PREP PACKAGE THE MANAGER CAN USE (26 Nov 2026)
 * ============================================================================
 *
 * "How do I coach someone who keeps showing up late", "give me a script for talking to an employee about their
 * attitude", "tips for a hard conversation with a leader about follow-ups": the rules book said such advice is answered
 * "in full (steps, a checklist, a sample script or role-play)". "A" and "or" let an answer be four generic tips, and
 * answers varied. The owner's target (the mechanism of a sibling product; our own content and citation rules): every
 * coaching / hard-conversation / HR how-to answer is a PREP PACKAGE, tuned to the topic and to what the manager said:
 *
 *   why the behavior matters · when to have the conversation · an OUTLINE (opening, the facts and the expectation,
 *   listening, agreement on next steps, a follow-up date) · the words to use, a SCRIPT in quotation marks the manager
 *   can read aloud · a relatable analogy · a ROLE-PLAY to run together · a measurable ACTION PLAN with a follow-up date
 *   · a short checklist.
 *
 * "How do I help an employee who is struggling with X" adds what a coaching form would hold (Observed / Expectation /
 * Practice / Follow-Up) and closes with an offer to make the form. A Coaching card gets the same prep in the reply above
 * it, never on the card or the form (`coachingCardPrepRule`). It cites the JBA Policy Manual when a policy applies
 * (never renaming the manual) and proposes no form for advice. Coaching is framed as developing the person; a concern
 * is named only when the manager described one (`src/lib/forms/coaching-framing.ts`).
 *
 * Both chat paths read the rule from here: the agent loop's rules book (`agent-loop/rules-book.ts`) and the older chat
 * prompt (`prompts.ts`, `withCoachingHowTo`). The loop also checks its advice reply (`coachingAnswerShape`) and hands a
 * reply missing the outline, the script, the role-play or the plan back once (the loop's run module). Pure: reads text only.
 */

/** The rule, as both prompts give it. `place` is the app's word for a location ("salon", "store"). */
export function coachingHowToRule(place: string): string {
  return (
    "Every answer to advice or a how-to about coaching, a hard conversation, corrective action, follow-ups or any HR topic (\"how do I coach someone who keeps showing up late\", \"give me a script for talking to an employee about their attitude\", \"tips for a hard conversation with a leader about follow-ups\", \"how do I help an employee who is struggling with upselling\") is a prep package the manager can use, tuned to the topic and to the situation they described (the behavior, the person's role, the " + place + "), always all of these, in this order: " +
    "(1) why it matters: a line or two on why the behavior matters to the guests, the team and the " + place + "; " +
    "(2) when to have the conversation (soon after it is seen, privately, before the next shift, as fits); " +
    "(3) a short outline of the conversation, as a numbered list: the opening, the facts and the expectation, listening to their side, agreement on next steps, and a follow-up date; " +
    "(4) the words to use: a sample script in quotation marks that the manager can read aloud word for word, framed as developing the person, naming a concern only when the manager described one; " +
    "(5) a relatable analogy that makes the expectation easy to picture; " +
    "(6) a role-play to run together: who plays whom, the push-back to practise, and what good sounds like; " +
    "(7) a measurable action plan: what changes, how it is measured, and the follow-up date; " +
    "then a short checklist. " +
    "For \"how do I help an employee who is struggling with <X>\": give the coaching guidance first (from the official guides and the JBA Policy Manual where they cover it), then what a coaching form would hold, as Observed / Expectation / Practice / Follow-Up, then the role-play tied to the follow-up date, and close by offering to make the form. " +
    "When the manager has not said what the employee does now or what is expected, still give the package from what they said, and end with at most one or two quick questions that would sharpen it. " +
    "Cite the JBA Policy Manual by its title and the section's heading when a policy applies, and never invent one. Advice asks for no form: never propose a form and never ask who a form is for; a closing line may offer one."
  );
}

/** The rule for a Coaching card: the prep goes in the reply above it, never on the card or the form. */
export function coachingCardPrepRule(): string {
  return (
    "When propose_form makes a Coaching or Follow-Up Coaching card, the reply above the card gives the prep package for that conversation, tuned to the card's account: why it matters, when to have it, the numbered outline, the words to use in quotation marks, an analogy, a role-play and the measurable action plan with the follow-up date. " +
    "It is the manager's prep only: never put it in what_happened, on the card or on the form unless the manager asks for it there."
  );
}

/** A numbered or bulleted list item at the start of a line. */
const LIST_ITEM = /^\s*(?:\d{1,2}[.)]|[-*•]|#{1,4}\s+\d{1,2}[.)]?)\s+\S/;

/** A quoted passage the manager can say: straight, curly or guillemet quotes around at least eight words. */
const QUOTED = /["“«]([^"“”«»\n]{20,})["”»]/g;

/** A blockquote line ("> I want to talk about …") of at least eight words. */
const BLOCKQUOTE = /^\s*>\s*(?:\S+\s+){7,}\S/m;

/** A role-play to run together. */
const ROLE_PLAY = /\brole[- ]?\s?play/i;

/** A plan with a follow-up: "action plan", "plan: …", and a follow-up or check-in. */
const PLAN = /\b(?:action\s+plan|plan)\b/i;
const FOLLOW_UP = /\b(?:follow[- ]?\s?up|check[- ]?\s?in)\b/i;

export interface CoachingAnswerShape {
  readonly outline: boolean;
  readonly script: boolean;
  readonly rolePlay: boolean;
  readonly plan: boolean;
}

/** Which parts of the package a reply carries: the outline (three list items or more), a quoted script (eight words or more), a role-play, a plan with a follow-up. */
export function coachingAnswerShape(reply: string): CoachingAnswerShape {
  const text = String(reply ?? "");
  const items = text.split("\n").filter((line) => LIST_ITEM.test(line)).length;
  const quoted = [...text.matchAll(QUOTED)].some((match) => match[1]!.trim().split(/\s+/).length >= 8);
  return { outline: items >= 3, script: quoted || BLOCKQUOTE.test(text), rolePlay: ROLE_PLAY.test(text), plan: PLAN.test(text) && FOLLOW_UP.test(text) };
}

/** How many parts a shape has. */
export function partsOf(shape: CoachingAnswerShape): number {
  return Number(shape.outline) + Number(shape.script) + Number(shape.rolePlay) + Number(shape.plan);
}

/** Whether a shape has every part the loop checks. */
export function completeShape(shape: CoachingAnswerShape): boolean {
  return partsOf(shape) === 4;
}

/** Words that make an advice request about coaching or a hard conversation (not a policy lookup such as PTO). */
const COACHING_TOPIC =
  /\b(?:coach\w*|conversations?|talk(?:ing)?\s+(?:to|with)|speak(?:ing)?\s+(?:to|with)|say\s+to|what\s+(?:do|should|can)\s+i\s+say|script|feedback|follow-?\s?ups?|corrective\s+action|discipline|attitude|counsel\w*|confront\w*|role-?\s?play|tough|hard|difficult|struggl\w*|(?:showing|show|shows|coming|comes|come|being|running|clocking)\s+(?:up\s+|in\s+)?late|tard(?:y|iness)|no[- ]calls?|no[- ]shows?|motivat\w*|underperform\w*)\b/i;

/**
 * Whether the manager's words ask how to coach or how to run a hard conversation. `adviceNotForm` (the loop's reading
 * that a turn asks for advice and for no form) is the caller's: this only adds that the advice is about coaching.
 */
export function asksCoachingHowTo(question: string): boolean {
  return COACHING_TOPIC.test(String(question ?? ""));
}

/** The loop's hand-back note when an advice reply is missing part of the package. */
export function coachingHowToNote(shape: CoachingAnswerShape): string {
  const missing = [
    !shape.outline ? "a short numbered outline of the conversation (opening, the facts and the expectation, listening, agreement on next steps, a follow-up date)" : null,
    !shape.script ? "the words to use: a sample script in quotation marks the manager can read aloud, tailored to what they described" : null,
    !shape.rolePlay ? "a role-play to run together" : null,
    !shape.plan ? "a measurable action plan with a follow-up date" : null,
  ].filter(Boolean);
  return `[app check] The manager asked how to coach or run a hard conversation, and your reply is missing ${missing.join("; ")}. Write your answer again as the whole prep package: why it matters, when to have it, the numbered outline, the words to use in quotation marks, an analogy, the role-play, the measurable action plan with the follow-up date, and a short checklist, citing the JBA Policy Manual where a policy applies. Propose no form and never ask who a form is for; you may offer one in a closing line.`;
}

/** The older chat path's rule line, inserted after the signature-lines rule (both prompt branches carry that line). */
export const SIGNATURE_RULE = "- Signature lines, corrective-action decisions and anything with legal weight stay with the manager. Point them at the policy language; do not decide for them.";

/** The older chat prompt with the coaching how-to rule after the signature-lines rule; unchanged when that line is absent. */
export function withCoachingHowTo(prompt: string, place: string): string {
  if (!prompt.includes(SIGNATURE_RULE)) return prompt;
  return prompt.split(SIGNATURE_RULE).join(`${SIGNATURE_RULE}\n- ${coachingHowToRule(place)}`);
}
