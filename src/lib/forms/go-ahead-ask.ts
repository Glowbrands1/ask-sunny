import { isGoAheadTurn } from "@/lib/ai/policy-carry-retrieval";
import { goAheadAsksWhoAndFormEnabled } from "@/lib/config/chat-quality-flags";

import { detectTemplateIntent } from "./template-intent";

/*
 * ============================================================================
 * "JUST MAKE IT" AFTER A POLICY QUESTION ASKS ONE SHORT QUESTION (GO_AHEAD_ASKS_WHO_AND_FORM_ENABLED)
 * ============================================================================
 *
 * QA's r37 live check (12 Nov 2026, main 7e8dcdb6; low): after "cite the animals in the workplace policy", "just make
 * it" replied "I need two things first: which employee … and you'll need to ask for it by name". QA's ruling: nothing is
 * assumed — not a Corrective Action — and the reply is ONE short question, who it is for and which of the forms the app
 * makes for a policy. Only when the chat has no card and no form request yet, and an earlier turn named a policy. Off,
 * the answer as given.
 */
export const GO_AHEAD_ASK = "Who is it for, and should it be a **Corrective Action** or a **Coaching Form**?";

const NAMES_A_POLICY = /\bpolic(?:y|ies)\b|\bstandards? of conduct\b|\bdress code\b/i;

interface Turn {
  readonly role: string;
  readonly content: string;
  readonly formProposal?: unknown;
}

function asksForAForm(text: string): boolean {
  const intent = detectTemplateIntent(text);
  return intent.kind !== "none" && !(intent.kind === "corrective_action" && !intent.requestedCreation);
}

export function withGoAheadAsk<T extends { content: string; formProposal?: unknown }>(answer: T, history: readonly Turn[], question: string): T {
  if (!goAheadAsksWhoAndFormEnabled() || answer.formProposal || !isGoAheadTurn(question)) return answer;
  if (history.some((turn) => turn.role === "assistant" && turn.formProposal)) return answer;
  const said = history.filter((turn) => turn.role === "user").map((turn) => String(turn.content ?? ""));
  if (said.some(asksForAForm) || !said.some((turn) => NAMES_A_POLICY.test(turn))) return answer;
  return { ...answer, content: GO_AHEAD_ASK };
}
