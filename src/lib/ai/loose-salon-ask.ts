import { PRODUCTION_SALONS } from "@/data/salons";
import { fuzzySalonAsksEnabled } from "@/lib/config/chat-quality-flags";
import { displayName } from "@/lib/forms/employee-match";
import { GLOBAL_SALON_ASK, salonIdNamedIn } from "@/lib/forms/global-salon-ask";
import { authorizedSalonIds } from "@/lib/forms/location-scope";
import { readSalonMentions } from "@/lib/forms/salon-mention";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

import type { GroundedPerson } from "./grounded-entities";
import { withoutStateSentences } from "./form-card-slots";
import { fuzzySalon, uniqueRosterSalon } from "./intake-augment";
import type { AskResponse } from "./types";

/*
 * ============================================================================
 * FUZZY_SALON_ASKS — A SALON THE WORDS ONLY RESEMBLE IS ASKED, NOT FILED (QA's Sunny 38h live check, 14 Nov 2026)
 * ============================================================================
 *
 * The sibling app's #881 (FUZZY_STORE_ASKS), ported as a mechanism. An Admin covering every salon, for a person not on
 * the roster:
 *
 *   "create a ca for <A> at omaha west, she was late"  → NE Omaha Pacific (loc-0410), resolved, no question
 *   "create a ca for <A>, she was late because she was at lincoln high" → NE Lincoln Pine Lake (loc-0312), resolved
 *
 * No salon is called "Omaha West" or "Lincoln High". Two readers guessed one: the trigram resemblance
 * (`uniqueRosterSalon` / `fuzzySalon` in `intake-augment.ts`, which adds "It happened at <salon>." to the model's
 * question) and the card's partial-name fallback (`form-card-slots.ts` `salonIdsIn`: every name word of five letters
 * or more somewhere in the text — "lincoln" is the only one in "NE Lincoln Pine Lake"). And the reply still said
 * "Your account covers every salon, so this form won't name one." against its own card.
 *
 * With the flag on, after the card is settled:
 *
 *   A SALON THE MANAGER NAMED (the mention reader, a short name, a salon number or a one-letter typo — the readers
 *   already trusted to name one), the employee's own Woven salon, or the only salon the account covers: kept.
 *   A salon only a resemblance reader supplied: not filed. The card asks among the account's salons, and the reply
 *   says "I read **omaha west** as **NE Omaha Pacific** — is that the salon?". "yes" next turn files it.
 *   A card that names a salon never says "won't name one" (the reply's salon line agrees with the card).
 *
 * Off, the response is returned unchanged.
 */

const SALON_SENTENCE =
  /Your account covers every salon, so (?:the|this) form won't name one(?: unless you did)?\. Create the draft here when you're ready and edit it below — nothing is saved to anyone's file until you do\./g;
const DRAFT_STAYS_READY =
  "Create the draft here when you're ready and edit it below — nothing is saved to anyone's file until you do.";
const CONFIRM = /I read \*\*([^*]+)\*\* as \*\*([^*]+)\*\* — is that the salon\?/;
const YES = /^\s*(?:y|ya|yes|yeah|yep|yup|correct|right|that'?s (?:it|right|correct|the salon)|it is|sure)\b[\s\S]{0,40}$/i;
const NO = /^\s*(?:n|no|nope|nah|not (?:that|it|there)|wrong)\b/i;

export function askLooseSalon(
  response: AskResponse,
  input: {
    readonly question: string;
    readonly history: readonly ChatMessage[];
    readonly scope: AccessScope | null;
    readonly people?: readonly GroundedPerson[];
  },
): AskResponse {
  if (!fuzzySalonAsksEnabled()) return response;
  const proposal = response.formProposal;
  if (!proposal) return response;

  // The manager's words: the app's own lines ("The employee is …", "It happened at <salon>.") are not theirs.
  const question = withoutStateSentences(input.question).replace(/[ \t]+/g, " ").trim();
  // The app's lines come first; the manager's own turn is the last line ("yes").
  const answer = question.split("\n").map((line) => line.trim()).filter(Boolean).at(-1) ?? "";
  const said = [
    ...input.history.filter((turn) => turn.role === "user").map((turn) => turn.content),
    question,
  ].join("\n");
  const asked = lastConfirm(input.history);

  // "yes" to "I read … as <salon> — is that the salon?": that salon is the manager's word now.
  if (asked && YES.test(answer)) {
    if (proposal.locationId === asked.salonId) return agreeing(response);
    return agreeing({ ...response, formProposal: filed(proposal, asked.salonId) });
  }

  const salonId = proposal.locationResolution === "resolved" ? proposal.locationId : null;
  if (!salonId) return response;
  if (ownSalon(proposal, input.people ?? [], salonId) || onlySalon(input.scope, salonId)) return agreeing(response);
  // A city inside a longer place ("at kearney high", "at the kearney mall", "at omaha west") is not the salon named.
  const longer = longerPlaces(said, salonId);
  const bare = longer.reduce((text, phrase) => text.split(phrase.text).join(" ".repeat(phrase.text.length)), said);
  if (firmlyNamed(bare, salonId)) return agreeing(response);
  const typed = longer.at(-1)?.place ?? (firmlyNamed(said, salonId) ? null : resembledBy(said, salonId));
  if (!typed) return agreeing(response);

  const salon = PRODUCTION_SALONS.find((entry) => entry.id === salonId);
  const next: ChatFormProposal = {
    ...proposal,
    locationId: null,
    locationName: null,
    locationResolution: "needs_selection",
    authorizedLocationIds: input.scope ? authorizedSalonIds(input.scope) : PRODUCTION_SALONS.map((entry) => entry.id),
  };
  const ask =
    asked && NO.test(answer)
      ? GLOBAL_SALON_ASK
      : `I read **${typed}** as **${salon?.name ?? salonId}** — is that the salon? Say yes, or tell me the salon.`;
  // QA's ruling (14 Nov 2026): a bare "yes" never answers two questions. The salon question is the only one in this
  // reply; payroll deduct and any other question wait for the next turn.
  const content = onlyThisQuestion(response.content.replace(SALON_SENTENCE, DRAFT_STAYS_READY)).trim();
  return { ...response, content: content.includes(ask) ? content : `${content}\n\n${ask}`, formProposal: next };
}

/** The reply with every other question paragraph taken out; the card's own field lines ("**Label:** …") stay. */
function onlyThisQuestion(content: string): string {
  return content
    .split(/\n{2,}/)
    .filter((paragraph) => /^\s*\*\*[^*\n]+:\*\*/.test(paragraph) || !/\?(?:\*\*)?(?=\s|$)/.test(paragraph))
    .join("\n\n");
}

/** Words of a salon's name, its city, a salon number, or a word saying it is a salon: not a longer place's words. */
const SALON_WORD = /^(?:the|salon|location|store|sun|tan|city|stc|[a-z]{2}|\d+)$/;
const PLACE_PHRASE =
  /\b(?:at|in)\s+((?:the\s+)?[a-z0-9][a-z0-9'’.-]*(?:\s+[a-z0-9][a-z0-9'’.-]*){0,4}?)(?=\s*(?:[,.;:!?()\n]|$)|\s+(?:on|and|but|she|he|they|for|because|was|were|is|today|yesterday|this|last|with|by|after|before|during|when|while|of|at|in)\b)/gi;

/**
 * The "at/in …" phrases that hold one of this salon's words and also a word that is not one ("kearney high", "the
 * kearney mall", "omaha west"): a longer place named after the city, not the salon. A word one letter off a salon word
 * ("pacfic") is that word.
 */
function longerPlaces(said: string, salonId: string): { text: string; place: string }[] {
  const name = PRODUCTION_SALONS.find((entry) => entry.id === salonId)?.name;
  if (!name) return [];
  const own = name.toLowerCase().replace(/^[a-z]{2}\s+/, "").split(/[^a-z0-9]+/).filter(Boolean);
  const isOwn = (word: string) => own.includes(word) || (word.length >= 5 && own.some((part) => part.length >= 5 && oneOff(word, part)));
  const found: { text: string; place: string }[] = [];
  for (const match of said.matchAll(PLACE_PHRASE)) {
    const place = match[1]!.trim();
    const words = place.toLowerCase().split(/\s+/).map((word) => word.replace(/[^a-z0-9]/g, "")).filter(Boolean);
    if (!words.some(isOwn)) continue;
    if (words.every((word) => isOwn(word) || SALON_WORD.test(word))) continue;
    found.push({ text: match[0], place });
  }
  return found;
}

function oneOff(left: string, right: string): boolean {
  if (left === right || Math.abs(left.length - right.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) i += 1;
    else if (left.length < right.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (left.length - i) + (right.length - j) <= 1;
}

/** The reply's salon line agrees with the card: a card that names a salon never says "won't name one". */
function agreeing(response: AskResponse): AskResponse {
  const proposal = response.formProposal;
  if (!proposal?.locationId || proposal.locationResolution !== "resolved") return response;
  if (!SALON_SENTENCE.test(response.content)) return response;
  SALON_SENTENCE.lastIndex = 0;
  return { ...response, content: response.content.replace(SALON_SENTENCE, DRAFT_STAYS_READY) };
}

function filed(proposal: ChatFormProposal, salonId: string): ChatFormProposal {
  const salon = PRODUCTION_SALONS.find((entry) => entry.id === salonId);
  return {
    ...proposal,
    locationId: salonId,
    locationName: salon?.name ?? proposal.locationName ?? null,
    locationResolution: "resolved",
    authorizedLocationIds: [salonId],
    status: proposal.status === "needs_location" ? "ready" : proposal.status,
  };
}

/** The readers trusted to name a salon: a mention, a short name, a salon number, a one-letter typo. */
function firmlyNamed(said: string, salonId: string): boolean {
  for (const turn of said.split("\n")) {
    const ids = [...new Set(readSalonMentions(turn).flatMap((mention) => mention.salonIds))];
    if (ids.length === 1 && ids[0] === salonId) return true;
  }
  return salonIdNamedIn(said) === salonId;
}

function ownSalon(proposal: ChatFormProposal, people: readonly GroundedPerson[], salonId: string): boolean {
  const name = proposal.employeeName?.trim().toLowerCase();
  if (!name) return false;
  return people.some(
    (person) =>
      displayName(person).toLowerCase() === name &&
      (person.primarySalonId === salonId || person.salonIds.includes(salonId)),
  );
}

function onlySalon(scope: AccessScope | null, salonId: string): boolean {
  if (!scope || scope.level === "global") return false;
  const ids = authorizedSalonIds(scope);
  return ids.length === 1 && ids[0] === salonId;
}

/** The words a resemblance reader took as this salon ("omaha west"), or null when none did. */
function resembledBy(said: string, salonId: string): string | null {
  const name = PRODUCTION_SALONS.find((entry) => entry.id === salonId)?.name;
  if (!name) return null;
  const guessed = fuzzySalon(said) === name || uniqueRosterSalon(said) === name || partialName(said) === salonId;
  if (!guessed) return null;
  const places = [...said.matchAll(/\b(?:at|in)\s+(?:the\s+)?([a-z0-9][a-z0-9'’.-]*(?:\s+[a-z0-9][a-z0-9'’.-]*){0,3}?)(?=\s*(?:[,.;:!?()\n]|$)|\s+(?:on|and|but|she|he|they|for|because)\b)/gi)];
  const local = name.toLowerCase().replace(/^[a-z]{2}\s+/, "").split(/\s+/);
  const place = [...places].reverse().find((match) => local.some((word) => match[1]!.toLowerCase().split(/\s+/).includes(word)));
  return (place?.[1] ?? local.find((word) => said.toLowerCase().includes(word)) ?? name).trim();
}

/** `form-card-slots.ts` `salonIdsIn`'s fallback: every name word of five letters or more somewhere in the text. */
function partialName(said: string): string | null {
  const words = said.toLowerCase();
  const hits = PRODUCTION_SALONS.filter((salon) => {
    const name = salon.name.toLowerCase();
    return words.includes(name) || name.split(/\s+/).filter((word) => word.length >= 5).every((word) => words.includes(word));
  });
  return hits.length === 1 ? hits[0]!.id : null;
}

function lastConfirm(history: readonly ChatMessage[]): { salonId: string } | null {
  const last = [...history].reverse().find((turn) => turn.role === "assistant");
  const match = last?.content.match(CONFIRM);
  if (!match) return null;
  const salon = PRODUCTION_SALONS.find((entry) => entry.name === match[2]);
  return salon ? { salonId: salon.id } : null;
}
