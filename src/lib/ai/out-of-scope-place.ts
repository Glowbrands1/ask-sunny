import { outOfScopePlaceSaidEnabled } from "@/lib/config/chat-quality-flags";
import { authorizedSalonIds } from "@/lib/forms/location-scope";
import { readSalonMentions, rosterSalonName } from "@/lib/forms/salon-mention";
import { salonCorrection, salonReply } from "@/lib/forms/salon-reply";

import type { ChatActor } from "./form-proposal";
import type { AskRequest, AskResponse } from "./types";

/**
 * OUT_OF_SCOPE_PLACE_SAID_ENABLED (QA, 28 Oct 2026; same flag in both apps):
 * a salon-scoped manager who names, in this turn, a salon they are not
 * assigned to — "Salon: KS Lawrence.", "lawrence", "it was at the lawrence
 * salon" — was answered with the card alone, which took that salon in
 * silence; only Create then refused it. With the flag on, the reply says so:
 *
 *   **KS Lawrence** isn't a salon on your assignment, so I can't file a form against it — Create will refuse it. Which of your salons is this about?
 *
 * Only when exactly one salon is named in the turn, none of the named salons
 * is the manager's, and the reply does not already say it. A manager whose
 * scope is not a list of salons (district, region, company) never gets it.
 * The card is not changed.
 */
export function outOfScopeSalonLine(name: string): string {
  return `**${name}** isn't a salon on your assignment, so I can't file a form against it — Create will refuse it. Which of your salons is this about?`;
}

const ALREADY_SAID = /isn['’]t a salon on your assignment/;
/** "Salon: KS Lawrence.", "salon is lawrence", "the salon is Lawrence": the label before a short salon reply. */
const LABEL = /^\s*(?:the\s+)?(?:salon|location)\s*(?::|\bis\b|=)\s*/i;

/** Every salon this one turn names: in a sentence, as a short reply, or as a correction. */
function salonsNamed(question: string): string[] {
  return [
    ...new Set([
      ...readSalonMentions(question).flatMap((mention) => mention.salonIds),
      ...(salonReply(question.replace(LABEL, ""), false) ?? []),
      ...(salonCorrection(question) ?? []),
    ]),
  ];
}

export function withOutOfScopePlace(response: AskResponse, request: AskRequest, actor: ChatActor): AskResponse {
  if (!outOfScopePlaceSaidEnabled() || !response.formProposal || !actor.scope) return response;
  if (ALREADY_SAID.test(response.content)) return response;
  const allowed = authorizedSalonIds(actor.scope);
  if (allowed.length === 0) return response;
  const named = salonsNamed(request.question ?? "");
  if (named.length !== 1 || allowed.includes(named[0]!)) return response;
  const name = rosterSalonName(named[0]!);
  if (!name) return response;
  return { ...response, content: `${response.content}\n\n${outOfScopeSalonLine(name)}` };
}
