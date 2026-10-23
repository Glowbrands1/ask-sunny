import { employeeFirstName } from "./employee-reference";
import {
  policyNamesFromViolated,
  policyPhrase,
  type ActionPlanInput,
} from "./ca-action-plan";
import { CA_ACTION_PLAN_CLOSING } from "./required-closing";

/**
 * Pau's two-sentence Action Plan.
 *
 * Management will review the policy with the employee. Then the required
 * closing. A payroll answer stays on its own field; it is not a third sentence.
 * Used only when ACTION_PLAN_SENTENCES_ENABLED is on.
 */

export function twoSentenceActionPlan(input: ActionPlanInput): string {
  const names = input.citedPolicies.length > 0 ? input.citedPolicies : policyNamesFromViolated(input.policyViolated);
  const who = employeeFirstName(input.employeeName) ?? "the employee";
  const review = `Management will review ${policyPhrase(names)} with ${who}.`;
  const closing = (input.closing?.trim() || CA_ACTION_PLAN_CLOSING).replace(/\s+/g, " ").trim();
  const ended = /[.!?]$/.test(closing) ? closing : `${closing}.`;
  return `${review} ${ended}`;
}

/**
 * Keeps the review sentence and the closing. A payroll sentence between
 * them is left on the payroll field, not in the plan.
 */
export function collapseToTwoSentences(plan: string): string {
  const sentences = plan
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
  if (sentences.length <= 2) return sentences.join(" ");
  const review = sentences.find((sentence) => /^Management will review\b/.test(sentence)) ?? sentences[0]!;
  const closing = sentences[sentences.length - 1]!;
  return `${review} ${closing}`;
}

/** Sentences, split on their ending punctuation. */
export function actionPlanSentenceCount(text: string): number {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0).length;
}
