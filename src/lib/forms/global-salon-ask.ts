import { PRODUCTION_SALONS } from "@/data/salons";
import type { AskResponse } from "@/lib/ai/types";
import type { AccessScope, ChatFormProposal, Role } from "@/types";

/**
 * A global administrator may file a form that names no salon. A global
 * district manager may not: the card is still built, and the salon is asked
 * once. Creating waits until they choose one.
 */
const SALON_SENTENCE =
  /Your account covers every salon, so (?:the|this) form won't name one(?: unless you did)?\. Create the draft here when you're ready and edit it below — nothing is saved to anyone's file until you do\./g;

export const GLOBAL_SALON_ASK =
  "Which salon is this about? The card is ready — choose the salon before you create the draft, so it is not filed with no salon.";

export function globalNonAdminNeedsSalon(role: Role | null | undefined, scope: AccessScope | null | undefined): boolean {
  return Boolean(role && role !== "admin" && scope?.level === "global");
}

export function askGlobalNonAdminForSalon(
  response: AskResponse,
  actor: { readonly role: Role | null; readonly scope: AccessScope | null },
): AskResponse {
  const proposal = response.formProposal;
  if (!proposal || !globalNonAdminNeedsSalon(actor.role, actor.scope)) return response;
  if (proposal.locationId || proposal.locationResolution === "resolved") return response;
  if (proposal.locationResolution !== "not_applicable" || !proposal.employeeName) return response;

  const next: ChatFormProposal = {
    ...proposal,
    locationId: null,
    locationResolution: "needs_selection",
    authorizedLocationIds: PRODUCTION_SALONS.map((salon) => salon.id),
    status: "needs_location",
    supportsInlineDraft: false,
  };
  const replaced = response.content.replace(SALON_SENTENCE, GLOBAL_SALON_ASK);
  const content = /which salon is this about/i.test(replaced)
    ? replaced
    : `${replaced.trim()}\n\n${GLOBAL_SALON_ASK}`;
  return { ...response, content, formProposal: next };
}
