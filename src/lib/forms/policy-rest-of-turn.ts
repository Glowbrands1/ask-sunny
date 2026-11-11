import type { AskResponse } from "@/lib/ai/types";
import { policyChangeRestOfTurnEnabled } from "@/lib/config/chat-quality-flags";
import type { ChatMessage } from "@/types";

/**
 * ============================================================================
 * A POLICY NAMED WITH MORE IN THE SAME MESSAGE: THE REST IS NOT DROPPED
 * ============================================================================
 *
 * POLICY_CHANGE_REST_OF_TURN_ENABLED. The 2 Nov 2026 scan: "A manager said the
 * previous coaching was her policy manual signing in May 2025. The bot replied
 * 'everything else is as it was,' but Prior Actions stayed empty." Her message
 * was '… with "Bonus Policy" from the Policy Manual. Previous Coaching is when
 * she signed the Policy manual May 2025': the policy path cited the policy and
 * said "Everything else on the form is as it was", and the second sentence
 * went nowhere.
 *
 * After a policy change, the sentences of the turn that are not the policy
 * request go to the revision of the same draft. Written: both changes are
 * said. Not written: the reply says what of her message is not on the form,
 * never that everything else is as it was.
 */

const AS_IT_WAS = /\s*Everything else on the form is as it was(?: — give it a read below)?\.?/;

/** The sentence that asks for the policy: it quotes it, or takes it "from the … manual". */
function isPolicyRequest(sentence: string): boolean {
  return /["“”][^"“”]{2,80}["“”]/.test(sentence) || /\bfrom\s+the\s+(?:jba\s+)?(?:policy\s+)?manual\b/i.test(sentence) || /^\s*(?:use|cite|change|make|set)\s+(?:the\s+)?policy\b/i.test(sentence);
}

export function restOfPolicyTurn(question: string): string | null {
  const sentences = question
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length < 2 || !sentences.some(isPolicyRequest)) return null;
  const rest = sentences.filter((sentence) => !isPolicyRequest(sentence));
  const words = rest.join(" ").split(/\s+/).filter(Boolean);
  return words.length >= 3 ? rest.join(" ") : null;
}

export async function withRestOfPolicyTurn(input: {
  request: Request;
  policyChange: AskResponse;
  question: string;
  history: readonly ChatMessage[];
  today: string;
}): Promise<AskResponse> {
  const change = input.policyChange;
  const instanceId = change.formUpdate?.instanceId;
  if (!policyChangeRestOfTurnEnabled() || !instanceId) return change;
  const rest = restOfPolicyTurn(input.question);
  if (!rest) return change;
  const revised = await (await import("@/lib/forms/chat-revision")).reviseActiveForm({
    request: input.request,
    instanceId,
    question: `Add this to the form: ${rest}`,
    history: [...input.history],
    today: input.today,
  });
  if (revised?.formUpdate) {
    return {
      ...change,
      content: `${change.content.replace(AS_IT_WAS, "").trimEnd()}\n\n${revised.content}`,
      formUpdate: { instanceId, updated: [...new Set([...change.formUpdate!.updated, ...revised.formUpdate.updated])] },
    };
  }
  return {
    ...change,
    content: `${change.content.replace(AS_IT_WAS, "").trimEnd()}\n\n**Not on the form yet:** "${rest}". Tell me which part of the form it belongs in, or type it on the card and press **Save changes**.`,
  };
}
