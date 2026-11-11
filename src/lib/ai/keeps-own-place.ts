import { outOfScopePlaceKeepsOwnEnabled } from "@/lib/config/chat-quality-flags";
import { authorizedSalonIds, proposeLocation } from "@/lib/forms/location-scope";
import { rosterSalonName } from "@/lib/forms/salon-mention";

import type { ChatActor } from "./form-proposal";
import type { AskRequest, AskResponse } from "./types";

/**
 * OUT_OF_SCOPE_PLACE_KEEPS_OWN_ENABLED (Pau, 28 Oct 2026; same flag in both
 * apps): a manager never sees a card for a salon they are not assigned to.
 * "Assigned" is the manager's full scope: the primary salon and every salon
 * they also cover. When the card holds a salon outside it — read from a later
 * "Salon: KS Lawrence." or "lawrence" — the card goes back to the manager's
 * own salon:
 *
 *   1. the salon the earlier turns already gave the card (read again from the
 *      manager's earlier turns with the same scope rules), else
 *   2. the manager's only salon, else
 *   3. no salon, and the card asks which of their salons this is about —
 *      never a guess.
 *
 * A salon in scope, a card with no salon, and a manager whose scope is not a
 * list of salons are left as they are. Create still refuses a salon outside
 * the scope on its own.
 */
export function withOwnPlace(response: AskResponse, request: AskRequest, actor: ChatActor): AskResponse {
  const card = response.formProposal;
  if (!outOfScopePlaceKeepsOwnEnabled() || !card || !card.locationId || !actor.scope) return response;
  const allowed = authorizedSalonIds(actor.scope);
  if (allowed.length === 0 || allowed.includes(card.locationId)) return response;
  const named = rosterSalonName(card.locationId);
  const earlier = request.history
    .filter((turn) => turn.role === "user" && typeof turn.content === "string")
    .map((turn) => turn.content)
    .join("\n");
  const reading = proposeLocation(actor.scope, earlier);
  const own =
    reading.resolution === "resolved" && allowed.includes(reading.locationId)
      ? reading.locationId
      : allowed.length === 1
        ? allowed[0]!
        : null;
  if (own) {
    const kept = { ...card, locationId: own, locationResolution: "resolved" as const };
    delete kept.namedLocationOutOfScope;
    return { ...response, formProposal: kept };
  }
  return {
    ...response,
    formProposal: {
      ...card,
      locationId: null,
      locationName: null,
      locationResolution: "needs_selection",
      authorizedLocationIds: [...allowed],
      ...(named ? { namedLocationOutOfScope: named } : {}),
      status: card.employeeName ? "needs_location" : card.status,
      supportsInlineDraft: false,
    },
  };
}
