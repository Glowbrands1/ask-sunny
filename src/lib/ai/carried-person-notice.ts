import { carriedPersonNoticeEnabled } from "@/lib/config/chat-quality-flags";
import { MANAGER_CONTEXT_TURNS } from "@/lib/forms/bounded-context";

import type { AskRequest, AskResponse } from "./types";

/*
 * ============================================================================
 * THE CARD SAYS WHEN ITS PERSON CAME FROM EARLIER IN THE CONVERSATION (CARRIED_PERSON_NOTICE_ENABLED)
 * ============================================================================
 *
 * QA's round-6 item (8 Nov 2026). The forms path says "I took <A> from earlier in this conversation — if this form is
 * for somebody else, tell me who." when the six-turn window names nobody and the person is read from the whole
 * conversation (`ai/form-proposal.ts`, `employeeFromEarlierTurns`). On the route, production's INTENT_EXTRACTION,
 * SLOT_RETENTION and REQUEST_KEPT_IN_WINDOW each put the person into what that check reads, so the card named <A>
 * with no notice: a silent carry-over (coding 2's bisect of the 232 live flags).
 *
 * This step decides from the manager's own words, whichever reader put the person on the card: a card for one of the
 * performance forms whose person is not named in the manager's last six turns, but is named before them, gets the
 * notice. A person named in those turns, a card that already says it, or a name the manager never typed gets none.
 * Off, the answer is returned as it was.
 */

/** The forms the forms path checks names for (`NAME_CHECKED_TEMPLATES` in `ai/form-proposal.ts`). */
const PERFORMANCE_FORMS: ReadonlySet<string> = new Set(["coaching", "follow-up-coaching", "dpoa", "policy-review", "sdit-epp", "tsd-epp"]);

const ALREADY_SAID = /from earlier in this conversation/i;

/** The manager's own turns, oldest first, the current one last. */
function managerTurns(request: Pick<AskRequest, "history" | "question">): string[] {
  return [
    ...(request.history ?? [])
      .filter((message) => message.role === "user" && !message.error && typeof message.content === "string" && message.content.trim() !== "")
      .map((message) => message.content),
    request.question,
  ];
}

/** Whether a turn names the person: a word of their name (a first or last name of two letters or more), any case. */
function names(turn: string, person: string): boolean {
  return person
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}'-]/gu, ""))
    .filter((word) => word.length >= 2)
    .some((word) => new RegExp(`(?<![\\p{L}])${word.replace(/[-']/g, "\\$&")}(?![\\p{L}])`, "iu").test(turn));
}

/** The notice the forms path writes, word for word. */
export function carriedNotice(person: string): string {
  return `I took **${person}** from earlier in this conversation — if this form is for somebody else, tell me who.`;
}

export function withCarriedPersonNotice(response: AskResponse, request: Pick<AskRequest, "history" | "question">): AskResponse {
  if (!carriedPersonNoticeEnabled()) return response;
  const card = response.formProposal;
  const person = card?.employeeName?.trim();
  if (!card || !person || !PERFORMANCE_FORMS.has(card.templateKey) || ALREADY_SAID.test(response.content)) return response;
  const turns = managerTurns(request);
  const window = turns.slice(-MANAGER_CONTEXT_TURNS);
  const before = turns.slice(0, -MANAGER_CONTEXT_TURNS);
  if (window.some((turn) => names(turn, person)) || !before.some((turn) => names(turn, person))) return response;
  return { ...response, content: `${response.content.trimEnd()}\n\n${carriedNotice(person)}` };
}
