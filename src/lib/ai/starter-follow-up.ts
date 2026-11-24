import { starterFollowUpExampleEnabled } from "@/lib/config/chat-quality-flags";

import type { AskRequest, AskResponse } from "./types";

/**
 * ============================================================================
 * A STARTER QUESTION'S FOLLOW-UP IS EASY TO ANSWER (STARTER_FOLLOW_UP_EXAMPLE_ENABLED; QA items 24 and its live re-test)
 * ============================================================================
 *
 * The production audit (20 Nov 2026): managers tapped a home starter with nothing else said; Sunny asked who, or which,
 * and three managers left. With the flag on, when one of the app's own starters (`QUICK_QUESTIONS`) is the chat's first
 * message and the reply asks who or which, the reply ends with one short example answer.
 *
 * QA's live re-test of #1127 (20 Nov 2026): "Create a coaching form." got "I can set that up. Who is this Coaching Form
 * for, and what's it about?" and "Help me prepare for a coaching conversation." got "1. Who is this coaching
 * conversation for? 2. What's the topic…?", both with no example: the who-question was matched too narrowly ("for?" right
 * after a bolded form name), the coaching-conversation chip was not keyed, and the agent loop never ran this. Now every
 * starter that is answered with a who or which question is keyed, the who-question is any "Who is this / it … for …?"
 * sentence, bold or not, and the agent loop applies the same step (`starterExampleText`, run.ts).
 *
 * Keyed to the app's own starter texts, never to a manager's own words. Off, as before.
 */
export const COACHING_STARTER = "Create a coaching form.";
export const COACHING_CONVERSATION_STARTER = "Help me prepare for a coaching conversation.";
export const TRAINING_STARTER = "Show me training related to this issue.";
export const OBJECTION_STARTER = "How should I handle a client objection?";

/** "Who is this Coaching Form for?", "Who is this **Coaching Form** for, and what's it about?", "Who is it for?". */
const WHO_QUESTION = /\bwho is (?:this|it)\b[^?\n]*?\bfor\b[^?\n]*\?/i;
/** "Which issue should I find training for?", "What's the objection?". */
const WHICH_QUESTION = /\b(?:which|what)\b[^?\n]*\?/i;

interface Starter {
  readonly text: string;
  /** The question the reply asks that the example answers. */
  readonly asks: RegExp;
  readonly example: string;
  /** Only when the reply showed nothing (no training, no source): a reply that answered needs no example. */
  readonly onlyWhenNothingShown?: boolean;
  /** Only when the card names nobody yet (the form's who-question). */
  readonly onlyWithoutPerson?: boolean;
}

const STARTERS: readonly Starter[] = [
  { text: COACHING_STARTER, asks: WHO_QUESTION, example: 'For example: "coaching for <name> on greeting guests".', onlyWithoutPerson: true },
  { text: COACHING_CONVERSATION_STARTER, asks: WHO_QUESTION, example: 'For example: "a coaching conversation with <name> about greeting guests".', onlyWithoutPerson: true },
  { text: TRAINING_STARTER, asks: WHICH_QUESTION, example: 'For example: "training on greeting guests" or "training on selling lotion".', onlyWhenNothingShown: true },
  { text: OBJECTION_STARTER, asks: WHICH_QUESTION, example: 'For example: "a guest says the lotion costs too much".', onlyWhenNothingShown: true },
];

/** The starters this step answers (for the test that keeps them in step with `QUICK_QUESTIONS`). */
export const STARTER_TEXTS = STARTERS.map((starter) => starter.text);

/**
 * The reply with the starter's example answer at its end, or the reply unchanged. `firstMessage`: the starter is the
 * chat's first manager message. `namesPerson`: a card this turn names its person. `showedSomething`: the reply carries
 * sources or training.
 */
export function starterExampleText(
  content: string,
  question: string,
  context: { readonly firstMessage: boolean; readonly namesPerson: boolean; readonly showedSomething: boolean },
): string {
  if (!starterFollowUpExampleEnabled() || !context.firstMessage) return content;
  const starter = STARTERS.find((entry) => entry.text === question.trim());
  if (!starter || content.includes(starter.example)) return content;
  if (starter.onlyWithoutPerson && context.namesPerson) return content;
  if (starter.onlyWhenNothingShown && context.showedSomething) return content;
  if (!starter.asks.test(content)) return content;
  return `${content.trimEnd()}\n\n${starter.example}`;
}

/** The regular chat's step (server-ask.ts, applied last). */
export function withStarterFollowUp(response: AskResponse, request: AskRequest): AskResponse {
  const content = starterExampleText(response.content, request.question, {
    firstMessage: !(request.history ?? []).some((turn) => turn.role === "user"),
    namesPerson: Boolean(response.formProposal?.employeeName),
    showedSomething: (response.recommendedVideoIds?.length ?? 0) > 0 || (response.citations?.length ?? 0) > 0,
  });
  return content === response.content ? response : { ...response, content };
}
