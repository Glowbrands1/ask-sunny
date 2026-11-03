import { wholeTeamCoachingEnabled } from "@/lib/config/chat-quality-flags";
import type { ChatMessage } from "@/types";

import { salonById } from "@/data/salons";

import { readSalonMentions } from "./salon-mention";
import { isBareWholeStaff } from "./staff-picker";
import { readsAsTeamSubject } from "./team-subject";

/**
 * ============================================================================
 * "COACHING FORM FOR ALL TEAM MEMBERS" — THE TEAM CARD, IN EVERY CHAT
 * ============================================================================
 *
 * WHOLE_TEAM_COACHING_ENABLED. Ported from Ask Bubbles: a Location Manager,
 * 2 Nov 2026, rated 1 star:
 * "earlier bubbles made a coaching form for all team members. Now it is
 * struggling to do that, it says it cannot make a coaching form for all team
 * members, but it just did it for me earlier". Pau, 3 Nov: "I need all
 * managers to have it" — the same whether or not a draft is open, and never a
 * refusal.
 *
 * The team Coaching card ("All team members", one salon) is made by the form
 * intake (`team-subject.ts`, `buildProposal`), but only where the conversation
 * names nobody, and a turn the intake does not read as a form request went to
 * the answering model. So a whole-team COACHING request is handed to the
 * intake as a request of its own: "Coaching Form for the whole team: <her
 * words>", without the turns before it (a person named earlier, or another
 * person's open draft, is not this card's subject) and with the salon this
 * conversation already named, so it is not asked again. A bare "whole staff"
 * counts when the form on screen is a Coaching Form. Corrective Action and
 * every other form are untouched: one person at a time.
 */

const COACH = /\bc(?:oa|ao)ch(?:ing)?\b/i;

export interface TeamRequest {
  readonly question: string;
  readonly history: ChatMessage[];
}

export function wholeTeamRequest(input: {
  question: string;
  history: readonly ChatMessage[];
  /** The intake is still asking about this form ("coaching"), if any. */
  continuingTemplateKey?: string | null;
  /** The open draft's template name, read only for a bare "whole staff" with a draft open. */
  openTemplateName?: string | null;
}): TeamRequest | null {
  if (!wholeTeamCoachingEnabled()) return null;
  const question = input.question.trim();
  if (!question || pastTeamStatement(question)) return null;
  const bare = isBareWholeStaff(question) && (input.continuingTemplateKey === "coaching" || COACH.test(input.openTemplateName ?? ""));
  const asked = COACH.test(question) && readsAsTeamSubject(question);
  const answering = input.continuingTemplateKey === "coaching" && readsAsTeamSubject(question);
  if (!bare && !asked && !answering) return null;
  const store = rememberedStore(question, input.history);
  return {
    question: `Coaching Form for the whole team${store ? ` at ${store}` : ""}: ${question}`,
    history: [],
  };
}

/** The salon the manager named earlier in this conversation (the latest single one), by its name. */
function rememberedStore(question: string, history: readonly ChatMessage[]): string | null {
  if (readSalonMentions(question).length > 0) return null;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index]!;
    if (turn.role !== "user" || typeof turn.content !== "string") continue;
    const ids = new Set(readSalonMentions(turn.content).flatMap((mention) => [...mention.salonIds]));
    if (ids.size === 1) return salonById([...ids][0]!)?.name ?? null;
  }
  return null;
}

/*
 * "earlier you made a caoching form for all team members for me" — a statement
 * about the past, not a request (QA, 3 Nov 2026). Answered with what to do,
 * never the refusal and never a new card.
 */
const PAST =
  /\b(?:earlier|before|yesterday|last\s+time|already)\b[^.?!]*\b(?:you|it|bubbles|sunny|the\s+(?:app|bot))\s+(?:just\s+)?(?:made|did|created|gave|built)\b|\b(?:you|it|bubbles|sunny)\s+(?:just\s+)?(?:made|did|created)\s+(?:one|that|it|me|a|the)\b[^.?!]*\b(?:earlier|before|for\s+me)\b/i;

export function pastTeamStatement(text: string): boolean {
  return PAST.test(text) && readsAsTeamSubject(text.replace(/\bc(?:oa|ao)ch/gi, "coach"));
}

export function pastTeamReply(): string {
  return [
    "Yes — a **Coaching Form** can be for the whole team: one card for **All team members** at one salon.",
    "Tell me what the coaching is about (for example \"check every client\'s skin type before a session\"), or say **coaching form for all team members**, and I'll make the team card.",
  ].join("\n\n");
}

/** The marker `wholeTeamRequest` writes. */
const TEAM_MARKER = /^Coaching Form for the whole team\b/;

/**
 * The team card is being made this turn, or is the card on screen. The saved
 * form state (a person this conversation was about) is then neither read nor
 * written, and the intent reader is not run: the team card's subject is the
 * team (ported to Ask Sunny, where both put the earlier person back).
 */
export function isTeamCardTurn(request: { question: string; history: readonly Pick<ChatMessage, "role" | "formProposal">[] }): boolean {
  if (!wholeTeamCoachingEnabled()) return false;
  if (TEAM_MARKER.test(request.question.trim())) return true;
  for (let index = request.history.length - 1; index >= 0; index -= 1) {
    const turn = request.history[index]!;
    if (turn.role !== "assistant") continue;
    if (turn.formProposal) return turn.formProposal.subject === "team";
  }
  return false;
}
