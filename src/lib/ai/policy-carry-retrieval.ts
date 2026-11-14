import { policyCarryRetrievalEnabled } from "@/lib/config/chat-quality-flags";
import { namedPolicies } from "@/lib/forms/named-policy-section";

/**
 * ============================================================================
 * "JUST MAKE IT" IS NOT A NEW TOPIC: THE POLICY ALREADY CITED IS SEARCHED
 * (POLICY_CARRY_RETRIEVAL_ENABLED)
 * ============================================================================
 *
 * Ported from Ask Bubbles (production, 25 Oct 2026). Turn 2, "cite animals in
 * the workplace policy", was answered from Animals in the Workplace p.30. Turn
 * 4, "just make it", was searched on its own words; the excerpts that came
 * back were unrelated pages (there, production recipes), and the reply said "the
 * knowledge base doesn't have anything about an 'animals in the workplace'
 * policy". A policy cited earlier in the chat was denied.
 *
 * A turn that only says to go ahead (make it, create it, do it, yes, ok, go
 * ahead) asks nothing new. Its retrieval query is the manager's most recent
 * turn that named a policy, or else the most recent turn with a topic of its
 * own. Only the manager's words are used, never an assistant turn, and the
 * model is still given the turn as typed. A turn with any topic of its own is
 * searched as before. Off, null.
 */

const MAX_WORDS = 8;
const MAX_HOPS = 8;

const LEAD = String.raw`(?:(?:ok(?:ay)?|yes|yeah|yep|sure|please|pls|just|go\s+ahead\s+and|then|now|so|and|great|perfect|thanks|thank\s+you|cool|alright|all\s+right)[,.!\s]+)*`;
const VERB = String.raw`(?:make|create|do|draft|build|write|start|generate|finish|send|submit|prepare|put\s+together|open|bring\s+up|pull\s+up|fill(?:\s+out)?)`;
const OBJECT = String.raw`(?:it|this|that|one|them|the\s+(?:form|draft|card|ca|write[- ]?up|coaching(?:\s+form)?|corrective\s+action(?:\s+form)?|document|thing))`;
const TAIL = String.raw`(?:\s+(?:now|please|pls|already|for\s+me|then|thanks|ok))*`;

const GO_AHEAD = new RegExp(
  String.raw`^\s*${LEAD}(?:${VERB}(?:\s+${OBJECT})?${TAIL}|go\s+ahead|do\s+it|yes|yeah|yep|ok(?:ay)?|sure|sounds\s+good|that'?s\s+(?:fine|right|correct)|proceed|continue)\s*[.!]*\s*$`,
  "i",
);

/** Whether a turn only says to go ahead, with no topic of its own. */
export function isGoAheadTurn(question: string): boolean {
  const text = (question ?? "").trim();
  if (text === "" || text.split(/\s+/).length > MAX_WORDS) return false;
  return GO_AHEAD.test(text);
}

const NAMES_A_POLICY = /\bpolic(?:y|ies)\b|\bstandards? of conduct\b|\bdress code\b/i;

/**
 * The retrieval query for a go-ahead turn: the latest manager turn that named
 * a policy, else the latest with a topic of its own. Null when the turn has a
 * topic of its own, when nothing earlier does, or with the flag off.
 */
export function carriedPolicyTopic(
  question: string,
  history: readonly { role: string; content: string; error?: unknown }[],
): string | null {
  if (!policyCarryRetrievalEnabled() || !isGoAheadTurn(question)) return null;
  let topic: string | null = null;
  let hops = 0;
  for (let index = history.length - 1; index >= 0 && hops <= MAX_HOPS; index -= 1) {
    const turn = history[index]!;
    if (turn.role !== "user" || turn.error || typeof turn.content !== "string") continue;
    hops += 1;
    const text = turn.content.trim();
    if (text === "" || isGoAheadTurn(text)) continue;
    if (NAMES_A_POLICY.test(text) || namedPolicies(text).length > 0) return text;
    topic ??= text;
  }
  return topic;
}
