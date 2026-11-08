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

/** True when the flag is on and the turn asks what "out of date" means, in a chat where the app offered a card. */
export function asksWhatOutOfDateMeans(asked: AskRequest): boolean {
  if (!outOfDateIsTheProposalEnabled()) return false;
  const question = (asked.question ?? "").trim();
  if (!OUT_OF_DATE.test(question) || !ASKS.test(question)) return false;
  return offeredACard(asked) && asked.history.some((turn) => turn.role === "user");
}

/** The manager's previous turn, asked again over the history before it: its answer is the card as it stands. */
export function cardTurn(asked: AskRequest): AskRequest {
  const at = asked.history.map((turn) => turn.role).lastIndexOf("user");
  const previous = asked.history[at]!;
  return { ...asked, question: previous.content, questionMessageId: previous.id ?? asked.questionMessageId, history: asked.history.slice(0, at) };
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
