import { closeSpellingMatchEnabled } from "@/lib/config/chat-quality-flags";

import { closePolicyQuestion } from "./named-policy-section";
import type { ManualChunk } from "./official-policy-manual";

/**
 * CLOSE_SPELLING_MATCH_ENABLED (Pau, via QA, 13 Nov 2026): a card that says no
 * manual section was found for the policy the manager named ("… for "anmals in
 * the wrkplace" … so I won't cite one") asks instead "Did you mean **Animals in
 * the Workplace** (page 33)?" when one or more headings are close to the words
 * but none confidently (`named-policy-section.ts` closePolicyQuestion). A
 * confident close spelling never reaches here: it is cited like an exact one.
 *
 * The card is written by `ai/form-proposal.ts`, which is not changed; its line
 * is rewritten here, after the answer. The manual is read only when the line is
 * there. Off, or with no close heading, the answer is returned as it is.
 */
const MISSING_LINE =
  /\*\*Policy:\*\* (?:Woven does not see|I don't see) a section of the current policy manual for "([^"\n]+)" in the knowledge base, so I won't cite one\. Tell me the policy as the manual names it, or tick Type of Offense and complete Direct policy on the form\./;

export async function withClosePolicyQuestion<T extends { readonly content: string }>(
  answer: T,
  chunks: () => Promise<readonly ManualChunk[] | null>,
): Promise<T> {
  if (!closeSpellingMatchEnabled() || !answer?.content) return answer;
  const missing = MISSING_LINE.exec(answer.content);
  if (!missing) return answer;
  let manual: readonly ManualChunk[] | null = null;
  try {
    manual = await chunks();
  } catch {
    return answer;
  }
  const question = closePolicyQuestion(missing[1]!, manual);
  return question ? { ...answer, content: answer.content.replace(missing[0], question) } : answer;
}
