import { outOfDateIsTheProposalEnabled } from "@/lib/config/chat-quality-flags";

import type { AskRequest, AskResponse } from "./types";

/**
 * ============================================================================
 * "WHAT DOES OUT OF DATE MEAN" IN A FORM CHAT IS ABOUT THE PROPOSAL (OUT_OF_DATE_IS_THE_PROPOSAL_ENABLED)
 * ============================================================================
 *
 * QA round 5, sf-s38 (production, 7 Nov 2026): after a Corrective Action card, Create answered "This proposal is out
 * of date: …" (`forms/proposal-currency.ts`), and the manager asked "what does out of date mean". The turn went to the
 * knowledge answer, which replied about the tanning-bed schematics in the knowledge base. The words are the app's own
 * refusal. With the flag on, a QUESTION about "out of date" in a chat where the app has offered a card is answered
 * about that card, with no retrieval. A statement ("this proposal is out of date") is not this reader's (coding 2's
 * CARD_COMPLAINT_NOT_ACCOUNT reads it). Off, the turn as before.
 *
 * The server never receives the browser's copy of a card (`api/validation.ts` parseHistory keeps id, role and
 * content), so the card is recognised by the app's own words on it, and rebuilt by answering the manager's previous
 * turn (`server-ask.ts` answerQuestion): the answer keeps that card, so the next turn continues it.
 */
const OUT_OF_DATE = /\bout[\s-]+of[\s-]+date\b/i;
const ASKS = /\?\s*$|^\s*(?:so\s+|and\s+|but\s+)?(?:what|why|how|whats|what's|wdym|huh)\b|\bwhat\s+(?:does|do|is|it)\b[^.!]*\bmean/i;
/** The app's own words on a card it offered (`form-proposal.ts`, `roster-only-names.ts` CREATE_WHEN_READY). */
const CARD_REPLY = /\bI'll draft (?:a|an) \*\*[^*\n]+\*\*|Create the draft here when you're ready/;

function offeredACard(asked: AskRequest): boolean {
  return asked.history.some((turn) => turn.role === "assistant" && CARD_REPLY.test(turn.content));
}

function asksAboutOutOfDate(text: string): boolean {
  const question = (text ?? "").trim();
  return OUT_OF_DATE.test(question) && ASKS.test(question);
}

/** True when the flag is on and the turn asks what "out of date" means, in a chat where the app offered a card. */
export function asksWhatOutOfDateMeans(asked: AskRequest): boolean {
  if (!outOfDateIsTheProposalEnabled() || !asksAboutOutOfDate(asked.question)) return false;
  return offeredACard(asked) && cardTurn(asked) !== null;
}

/**
 * The manager's last turn before this one that is not itself a question about "out of date" (asked twice: "what does
 * out of date mean", then "why is it out of date"), asked again over the history before it, under its own message id,
 * so the rebuilt card's source turns are the account's, never this question's (coding 2's review). Null when there is
 * none, so the branch never answers itself.
 */
export function cardTurn(asked: AskRequest): AskRequest | null {
  for (let at = asked.history.length - 1; at >= 0; at -= 1) {
    const turn = asked.history[at]!;
    if (turn.role !== "user" || asksAboutOutOfDate(turn.content)) continue;
    return { ...asked, question: turn.content, questionMessageId: turn.id ?? undefined, history: asked.history.slice(0, at) };
  }
  return null;
}

/** The answer about the proposal: what "out of date" means here, and which part to change. The card stays attached. */
export function outOfDateAnswer(card: AskResponse): AskResponse {
  const proposal = card.formProposal ?? null;
  const form = proposal?.templateName ? `**${proposal.templateName}**` : "form";
  const person = proposal?.employeeName ? ` for **${proposal.employeeName}**` : "";
  const content = [
    `"Out of date" means the proposal card was made before something later in this conversation changed it, such as the person, the form or a correction, so Create asks you to use the newest proposal instead.`,
    `The newest proposal here is the ${form}${person}. Which part of the proposal looks out of date? Tell me what to change, or create the draft from the newest card.`,
  ].join("\n\n");
  return { content, citations: [], coverage: "not_applicable", recommendedVideoIds: [], ...(proposal ? { formProposal: proposal } : {}) };
}
