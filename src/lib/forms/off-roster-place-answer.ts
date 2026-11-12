import { offRosterPlaceAnswerEnabled } from "@/lib/config/chat-quality-flags";
import { PRODUCTION_SALONS, salonById } from "@/data/salons";
import type { AccessScope } from "@/types";

import { authorizeLocation } from "./location-scope";
import { offeredOffRosterName, offRosterOffer } from "./off-roster-confirm";
import { offRosterQuestion, storeOnlyAnswer } from "./off-roster-ask";
import { readSalonMentions } from "./salon-mention";

/*
 * ============================================================================
 * A PLACE IS NEVER THE PERSON WHILE THE OFF-ROSTER OFFER IS OPEN (OFF_ROSTER_PLACE_ANSWER_ENABLED)
 * ============================================================================
 *
 * QA's priority live bug (Sunny 37b, 12 Nov 2026; a gap in OFF_ROSTER_STORE_ANSWER_ONLY): an all-salon admin typed
 * "CA for <C>, do not terminate yet, she was late"; the reply offered "reply use <C>"; the manager answered with a salon
 * only, written state-first as the directory writes it ("IA Altoona"). The salon became the employee "Ia Altoona", the
 * Observation and the date were lost, and "use <C>" was not asked again. The earlier fix covered a salon director's
 * "kearney, ne" only.
 *
 * With the flag on, for any scope, a reply that is only a place while the offer is open:
 *   - is read as the turn that typed the name (`placeAnswerTurn`), so the card is drafted again from the manager's own
 *     account, date and policy — the place is never a person;
 *   - after the turn (`withPlaceAnswer`), the card holds no employee, takes the salon when the directory knows it and
 *     the scope allows it, and the reply asks the question and the offer again over the account it read.
 * Off, null and as given.
 */

/** US state and DC codes: the directory's names start with one ("NE Kearney", "IA Altoona"). */
const STATE_CODES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "),
);
/** The states the directory's salons are in: typed in lower case, only these read as a state ("ne kearney"). */
const DIRECTORY_STATES = new Set(PRODUCTION_SALONS.map((salon) => salon.state.toUpperCase()));
const PLACE_WORDS = String.raw`[A-Za-z][A-Za-z.'’-]*(?:\s+[A-Za-z0-9][A-Za-z0-9.'’-]*){0,3}`;
/** "IA Altoona", "NE Lincoln O Street", "at the IA Altoona salon". */
const STATE_FIRST = new RegExp(String.raw`^(?:(?:at|in)\s+)?(?:the\s+)?([A-Za-z]{2})[\s,]+(${PLACE_WORDS}?)(?:\s+(?:salon|location))?\s*[.!]?$`);
/** "Altoona, IA", "kearney, ne". */
const STATE_LAST = new RegExp(String.raw`^(?:(?:at|in)\s+)?(?:the\s+)?(${PLACE_WORDS}?),\s*([A-Za-z]{2})(?:\s+(?:salon|location))?\s*[.!]?$`);

const stateCode = (typed: string) => {
  const upper = typed.toUpperCase();
  if (!STATE_CODES.has(upper)) return false;
  // Typed in capitals it is a code wherever; in lower case only the directory's own states ("ne", never "in" or "me").
  return typed === upper || DIRECTORY_STATES.has(upper);
};

export interface PlaceAnswer {
  /** The name the offer is open for. */
  readonly pending: string;
  /** The place as typed. */
  readonly place: string;
  /** The directory's salon, when it knows the place. */
  readonly salonId: string | null;
}

/** The one salon the directory reads in a place-only turn, or null. */
function directorySalon(text: string): string | null {
  if (storeOnlyAnswer(text)) {
    const mentions = readSalonMentions(/^\s*at\b/i.test(text) ? text : `at ${text}`).filter((mention) => mention.salonIds.length === 1);
    return mentions[0]?.salonIds[0] ?? null;
  }
  return null;
}

/** A turn that is only a place: a directory salon or city, "<ST> <City>" or "<City>, <ST>". */
export function placeOnly(text: string): { salonId: string | null } | null {
  const said = (text ?? "").replace(/\s+/g, " ").trim();
  if (said === "" || said.length > 60) return null;
  const salonId = directorySalon(said);
  if (salonId) return { salonId };
  const first = STATE_FIRST.exec(said);
  if (first && stateCode(first[1]!)) return { salonId: null };
  const last = STATE_LAST.exec(said);
  if (last && stateCode(last[2]!)) return { salonId: null };
  return null;
}

type Turn = { readonly role: string; readonly content: string };

/** The open offer's name and the place, when this turn is only a place answering it. Off, or any other turn, null. */
export function placeAnswerOf(question: string, history: readonly Turn[]): PlaceAnswer | null {
  if (!offRosterPlaceAnswerEnabled()) return null;
  const lastAssistant = [...history].reverse().find((turn) => turn.role === "assistant");
  const pending = offeredOffRosterName(lastAssistant?.content);
  if (!pending) return null;
  const place = placeOnly(question);
  if (!place) return null;
  return { pending, place: question.trim(), salonId: place.salonId };
}

/** The turn the card is drafted from: the manager's turn that typed the name, so the place never reads as a person. */
export function placeAnswerTurn(answer: PlaceAnswer, history: readonly Turn[]): string | null {
  const typed = [...history]
    .reverse()
    .find((turn) => turn.role === "user" && turn.content.toLowerCase().includes(answer.pending.toLowerCase()));
  return typed?.content ?? null;
}

/** The lead the turn's reply opens with (the card for the name, or the offer for it); the account under it stays. */
const LEAD = /^(?:I['’]ll draft |I can['’]t find |I couldn['’]t find |\*\*[^*]+\*\* isn['’]t in the Woven roster)/;

interface CardLike {
  employeeName: string | null;
  employeeRole?: string | null;
  status: string;
  supportsInlineDraft?: boolean;
  locationId?: string | null;
  locationName?: string | null;
  locationResolution?: string;
}

/** After the turn: no employee on the card, the salon where the scope allows, and the question and offer again. */
export function withPlaceAnswer<T extends { content: string; formProposal?: CardLike | null }>(
  answer: T,
  place: PlaceAnswer,
  scope: AccessScope | null | undefined,
): T {
  const card = answer.formProposal;
  const salon = place.salonId ? salonById(place.salonId) : undefined;
  const allowed = salon && authorizeLocation(scope ?? null, salon.id).kind === "authorized";
  const account = answer.content
    .split(/\n{2,}/)
    .filter((paragraph) => !LEAD.test(paragraph.trim()))
    .join("\n\n")
    .trim();
  const noted = allowed
    ? `I've set the salon to **${salon!.name}**.`
    : `I read **${place.place}** as the salon, not the employee's name.`;
  const content = [`${noted} ${offRosterQuestion(place.pending)} ${offRosterOffer(place.pending)}`, account].filter(Boolean).join("\n\n");
  if (!card) return { ...answer, content };
  return {
    ...answer,
    content,
    formProposal: {
      ...card,
      employeeName: null,
      employeeRole: null,
      status: "needs_employee",
      supportsInlineDraft: false,
      ...(allowed ? { locationId: salon!.id, locationName: salon!.name, locationResolution: "resolved" } : {}),
    },
  };
}
