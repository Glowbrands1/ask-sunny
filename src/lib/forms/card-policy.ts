import type { ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * THE DRAFT CITES THE POLICY ITS CARD CITED
 * ============================================================================
 *
 * NEXT_PUBLIC_CARD_POLICY_TO_DRAFT_ENABLED. QA's live check, 3 Nov 2026: the
 * card for "make me a CA for <name> for being late to opening this morning"
 * read "**Policy:** Late Opening Policy, JBA Policy Manual p.15", and the
 * draft made from it cited Attendance p.14 — the card's policy is read by
 * one reader, the draft's by another, and the card's was never sent. The
 * heading on the card the manager pressed Create on is sent with the draft
 * request; the draft route uses it where the pinned manual has it.
 */

/** "**Policy:** Late Opening Policy, JBA Policy Manual p.15, as you said" → "Late Opening". */
export function cardPolicyHeading(content: string): string | null {
  const line = /\*\*Policy:\*\*\s*([^\n]+)/.exec(content)?.[1];
  if (!line) return null;
  const first = line.split(/;|\s—\s/)[0]!;
  const heading = first
    .replace(/,\s*JBA Policy Manual.*$/i, "")
    .replace(/,\s*as you said.*$/i, "")
    .replace(/\s+Policy$/i, "")
    .trim();
  return heading.length > 0 && heading.length <= 80 ? heading : null;
}

/** The policy heading on the card with this proposal id, in this conversation. */
export function cardPolicyFor(proposal: Pick<ChatFormProposal, "proposalId">, messages: readonly Pick<ChatMessage, "role" | "content" | "formProposal">[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === "assistant" && message.formProposal?.proposalId === proposal.proposalId) return cardPolicyHeading(message.content);
  }
  return null;
}

/** As the manual's headings are named in a sentence: "Late Opening" → "Late Opening policy". */
export function cardPolicyPhrase(heading: string): string {
  const name = heading.trim().slice(0, 120);
  return /\bpolic(?:y|ies)$/i.test(name) ? name : `${name} policy`;
}
