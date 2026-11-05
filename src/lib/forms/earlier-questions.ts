import { isQuestionNotForm } from "@/lib/ai/question-not-form";

import { detectTemplateIntent } from "./template-intent";

/** The manager asked for this Corrective Action in this turn. */
function asksForTheCa(turn: string): boolean {
  const intent = detectTemplateIntent(turn);
  return (intent.kind === "explicit" && intent.templateKey === "dpoa") || (intent.kind === "corrective_action" && intent.requestedCreation);
}

/**
 * OBSERVATION_NOT_EARLIER_QUESTION_ENABLED (Pau via QA, 5 Nov 2026, sf-s25):
 * "What policy would it be if a tanning consultant did not complete the
 * closing correctly …", asked before "Write a CA for …", began the card's
 * Observation of Offense. The turns the account is read from, without the
 * ones before the latest request that were questions to answer
 * (`isQuestionNotForm`). A turn after the request stays whatever it asks
 * ("can you have it include that …" adds to the account).
 */
export function withoutEarlierQuestions(turns: readonly string[]): readonly string[] {
  let requestAt = -1;
  turns.forEach((turn, index) => {
    if (asksForTheCa(turn)) requestAt = index;
  });
  if (requestAt <= 0) return turns;
  return turns.filter((turn, index) => index >= requestAt || !isQuestionNotForm(turn));
}
