import { PRODUCTION_SALONS } from "@/data/salons";
import { globalSalonAskEnabled } from "@/lib/config/chat-quality-flags";
import type { AskResponse } from "@/lib/ai/types";
import type { AccessScope, ChatFormProposal, Role } from "@/types";

import { readSalonMentions } from "./salon-mention";

/**
 * A global administrator may file a form that names no salon. A global
 * district manager may not leave it unnamed without being asked: the card is
 * still built, and the salon is asked once. The question does not block the
 * draft. Pau approved this wording on 24 Oct 2026.
 *
 * A salon named in this turn, in an earlier turn, by a short name ("Dodge"),
 * or with a one-character typo is the location. The question is not asked.
 */
const SALON_SENTENCE =
  /Your account covers every salon, so (?:the|this) form won't name one(?: unless you did)?\. Create the draft here when you're ready and edit it below — nothing is saved to anyone's file until you do\./g;

export const GLOBAL_SALON_ASK =
  "Which salon is this about? The card is ready — choose the salon before you create the draft, so it is not filed with no salon.";

/** After the one question, the card stays ready and the draft can still be created. */
const DRAFT_STAYS_READY =
  "Create the draft here when you're ready and edit it below — nothing is saved to anyone's file until you do.";

const NOT_A_SALON = new Set([
  "about",
  "action",
  "assistant",
  "coaching",
  "consultant",
  "corrective",
  "create",
  "date",
  "deduct",
  "director",
  "district",
  "employee",
  "form",
  "from",
  "have",
  "manager",
  "member",
  "need",
  "payroll",
  "please",
  "policy",
  "salon",
  "tanning",
  "team",
  "that",
  "this",
  "today",
  "verbal",
  "with",
  "works",
  "written",
]);

export function globalNonAdminNeedsSalon(role: Role | null | undefined, scope: AccessScope | null | undefined): boolean {
  return Boolean(role && role !== "admin" && scope?.level === "global");
}

/** One roster salon named in the manager's own words, or null when it is not one salon. */
export function salonIdNamedIn(text: string): string | null {
  const mentions = readSalonMentions(text);
  const mentioned = [...new Set(mentions.flatMap((mention) => mention.salonIds))];
  if (mentioned.length === 1) return mentioned[0]!;
  if (mentioned.length > 1) return null;

  // A two-word name ("Lawrence Smith") is a person. Those words are not a
  // salon nickname, so KS Lawrence is not filled in from the person's name.
  const people = personTokens(text);
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !NOT_A_SALON.has(word) && !people.has(word));
  if (words.length === 0) return null;

  const nickname = uniqueSalon(PRODUCTION_SALONS.filter((salon) => words.some((word) => localTokens(salon.name).includes(word))));
  if (nickname) return nickname;

  const fuzzy = new Set<string>();
  for (const word of words) {
    if (word.length < 5) continue;
    for (const salon of PRODUCTION_SALONS) {
      for (const token of localTokens(salon.name)) {
        if (token.length >= 5 && editDistance(word, token) === 1) fuzzy.add(salon.id);
      }
    }
  }
  return fuzzy.size === 1 ? [...fuzzy][0]! : null;
}

/**
 * Resolve a salon the manager already named, or ask once without blocking
 * the draft. Flag off: the proposal is returned unchanged.
 */
export function askGlobalNonAdminForSalon(
  response: AskResponse,
  actor: { readonly role: Role | null; readonly scope: AccessScope | null },
  managerText = "",
  priorAssistant = "",
): AskResponse {
  if (!globalSalonAskEnabled()) return response;
  const proposal = response.formProposal;
  if (!proposal || !globalNonAdminNeedsSalon(actor.role, actor.scope)) return response;
  if (proposal.locationId || proposal.locationResolution === "resolved") return response;
  if (!proposal.employeeName) return response;

  const named = salonIdNamedIn(managerText);
  if (named) {
    const salon = PRODUCTION_SALONS.find((entry) => entry.id === named);
    const next: ChatFormProposal = {
      ...proposal,
      locationId: named,
      locationName: salon?.name ?? proposal.locationName,
      locationResolution: "resolved",
      authorizedLocationIds: [named],
      status: proposal.status === "needs_location" ? "ready" : proposal.status,
      supportsInlineDraft: proposal.supportsInlineDraft,
    };
    return { ...response, content: withoutSalonQuestion(response.content), formProposal: next };
  }

  if (proposal.locationResolution !== "not_applicable" && proposal.locationResolution !== "needs_selection") {
    return response;
  }

  const next: ChatFormProposal = {
    ...proposal,
    locationId: null,
    locationResolution: "needs_selection",
    authorizedLocationIds: PRODUCTION_SALONS.map((salon) => salon.id),
    status: "ready",
    supportsInlineDraft: true,
  };
  const askedAlready = /which salon is this about/i.test(`${priorAssistant}\n${response.content}`);
  if (askedAlready) {
    return { ...response, content: withoutSalonQuestion(response.content), formProposal: next };
  }
  const replaced = response.content.replace(SALON_SENTENCE, GLOBAL_SALON_ASK);
  const content = /which salon is this about/i.test(replaced)
    ? replaced
    : `${replaced.trim()}\n\n${GLOBAL_SALON_ASK}`;
  return { ...response, content, formProposal: next };
}

/** Drop a repeated salon question and the "won't name one" sentence. The create line stays. */
function withoutSalonQuestion(content: string): string {
  const stripped = content
    .replace(SALON_SENTENCE, DRAFT_STAYS_READY)
    .replace(/\n*Which salon is this about\? The card is ready — choose the salon before you create the draft, so it is not filed with no salon\./g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return /create the draft here/i.test(stripped) ? stripped : `${stripped}\n\n${DRAFT_STAYS_READY}`;
}

function personTokens(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(/\b[A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+)+\b/g)) {
    for (const word of match[0].toLowerCase().split(/[^a-z0-9]+/)) {
      if (word) found.add(word);
    }
  }
  return found;
}

function localTokens(name: string): string[] {
  const parts = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const local = parts[0] && parts[0].length <= 2 ? parts.slice(1) : parts;
  return local.filter((word) => word.length >= 4);
}

function uniqueSalon(salons: readonly { id: string }[]): string | null {
  const ids = [...new Set(salons.map((salon) => salon.id))];
  return ids.length === 1 ? ids[0]! : null;
}

function editDistance(left: string, right: string): number {
  if (Math.abs(left.length - right.length) > 1) return 2;
  const rows = left.length + 1;
  const cols = right.length + 1;
  let previous = Array.from({ length: cols }, (_, index) => index);
  for (let row = 1; row < rows; row += 1) {
    const current = [row];
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      current[col] = Math.min(current[col - 1]! + 1, previous[col]! + 1, previous[col - 1]! + cost);
    }
    previous = current;
  }
  return previous[cols - 1] ?? 2;
}
