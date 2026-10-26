import { cleanupRequestKeepsCardEnabled } from "@/lib/config/chat-quality-flags";

import type { AskRequest, AskResponse } from "./types";

/**
 * CLEANUP_REQUEST_KEEPS_CARD_ENABLED: a clean-up request or a thank-you never
 * changes the open card.
 *
 * QA live run, 26 Oct 2026 (both apps; names invented): after "create a ca for
 * <name> at <place>, she was late on 10-5 and 10-15. i coached her on 10-16
 * about being late" (card shown), "can you clean up my grammar and
 * capitalizing on proper nouns?" made the card disappear here (lowercase and
 * sentence case), and in the sibling app re-issued it with the request read
 * into the account: the draft kept only "On 10/16, Rory was coached about the
 * tardiness" and both late dates were gone.
 *
 * When the last reply carried a card and the manager's turn only asks to
 * clean up the wording ("clean up my grammar", "fix the spelling", "capitalize
 * the names", "proofread it") or only thanks ("thanks", "ok thank you"), the
 * reply is that card, unchanged — the same fields and the same source turns —
 * with one line in front. A turn that also asks for a change or names anything
 * else is left to the readers. Off, the reply is as it is.
 *
 * The same file in the sibling app.
 */

const CLEANUP =
  /\b(?:clean\s*up|tidy\s*up|fix|correct|check|improve|polish|proofread|reword|rephrase|rewrite)\b[^.?!]*\b(?:grammar|spelling|punctuation|capitali[sz](?:e|ed|ing|ation)|wording|writing|typos?|proper\s+nouns?)\b|\bcapitali[sz](?:e|ing)\b[^.?!]*\b(?:names?|proper\s+nouns?)\b|\bproofread\b/i;
const THANKS = /^\s*(?:(?:ok(?:ay)?|great|perfect|cool|awesome)[,!.\s]+)?(?:thanks?(?:\s+you)?|thank\s+you|thx|ty)(?:\s+(?:so\s+much|very\s+much))?[.!\s]*$/i;
const NEGATED = /\b(?:don'?t|do\s+not|never|no\s+need\s+to|not)\b/i;
/** Anything that changes the form: a new person, field, form or date. */
const CHANGE =
  /\b(?:change|add|remove|delete|make\s+it|instead|level|verbal|written|final|payroll|deduct|salon|store|date|name|employee|title|position|form|ca|coaching|exit|for\s+[A-Za-z]+\s+[A-Za-z]+)\b|\d/i;

export function withCleanupKeepsCard(response: AskResponse, request: AskRequest): AskResponse {
  if (!cleanupRequestKeepsCardEnabled()) return response;
  const previous = [...request.history].reverse().find((turn) => turn.role === "assistant");
  const card = previous?.formProposal;
  if (!previous || !card) return response;
  const said = (request.question ?? "").trim();
  const thanks = THANKS.test(said);
  const cleanup = !thanks && CLEANUP.test(said) && !CHANGE.test(said.replace(CLEANUP, " "));
  if (!thanks && !cleanup) return response;
  const line = thanks
    ? "You're welcome. The card below is unchanged; press **Create draft** when you're ready."
    : NEGATED.test(said)
      ? "The card below is unchanged. Press **Create draft** when you're ready."
      : "The card below is unchanged. When you press **Create draft**, the form is written in full sentences with names and places capitalised, and you can edit any wording on the form before you finalize it.";
  return { ...response, content: `${line}\n\n${previous.content.trim()}`, formProposal: card, citations: previous.citations ?? response.citations };
}
