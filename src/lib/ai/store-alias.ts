import { storeAliasEnabled } from "@/lib/config/chat-quality-flags";
import { PRODUCTION_SALONS } from "@/data/salons";
import { readSalonMentions } from "@/lib/forms/salon-mention";

import type { AskRequest } from "./types";

/**
 * STORE_ALIAS_ENABLED: the way managers name a salon is written as the
 * roster name before any reader sees the turn.
 *
 * Live chats, 25 Oct 2026: "location o st" was not NE Lincoln O Street
 * (conv_mvoehonm2pfrkng); the sibling app had the same gap with a store and
 * its state. The readers are not changed: each manager turn has its aliases
 * replaced by the roster name, which every reader already reads.
 *
 * THE ALIASES ARE BUILT FROM THE LOCATION LIST, never typed in by hand:
 *   - city or street with the state ("kearney ne", "kearney, ne", "o st ne")
 *     is a place wherever it appears;
 *   - city and street together ("lincoln o st", "o st lincoln") too;
 *   - the street or city alone ("o st", "manhattan") only where the sentence
 *     says it is a place ("at", "our", "location", "salon", "store", "the
 *     location is …"; "in" and "the" only for a name of two words or more)
 *     or when it is the whole reply (a one-word reply only after the app
 *     asked which salon).
 * An alias two locations share is never used. A roster name already typed is
 * left as it is. A place the manager rules out ("not at lawrence", "she is
 * never at the o st location") is never rewritten: the readers do not read
 * negation, and the salon ruled out must not become the salon (QA-6, 26 Oct
 * 2026). Off, every turn is read as typed.
 *
 * The same file in the sibling app; only `READERS` differs.
 */

interface PlaceParts {
  /** The roster name the readers know. */
  readonly name: string;
  readonly state: string;
  readonly city: string;
  /** The part of the name after the city, when several locations share the city. */
  readonly local: string | null;
}

/** This app's locations, as name, state, city and the part after a shared city. */
const READERS = {
  /**
   * A whole-turn place reply is written as this app's slot answer, "the salon
   * is NE Kearney": every reader takes it as the salon, and the incident
   * readers never take it for what happened (QA, 26 Oct 2026: a bare "o st"
   * became What happened and the incident given earlier was lost).
   */
  placeReply: (name: string): string => `the salon is ${name}`,
  /** The turn names one salon the readers read. */
  named: (text: string): boolean => readSalonMentions(text).some((mention) => mention.salonIds.length === 1),
  /**
   * Local shorthand that names one salon, the reviewed list `salon-mention.ts`
   * already reads ("st joe" is St. Joseph, MO). Read with a place cue or as the
   * whole reply, like a street alone.
   */
  shorthand: { "st joe": "MO St Joseph" } as Readonly<Record<string, string>>,
  places: (): PlaceParts[] => {
    const rests = PRODUCTION_SALONS.map((salon) => salon.name.slice(salon.state.length).trim());
    const cities = ["Kansas City", "Lincoln", "Omaha"].filter(
      (city) => rests.filter((rest) => rest.startsWith(`${city} `)).length > 1,
    );
    return PRODUCTION_SALONS.map((salon, index) => {
      const rest = rests[index]!;
      const city = cities.find((shared) => rest.startsWith(`${shared} `));
      return city
        ? { name: salon.name, state: salon.state, city, local: rest.slice(city.length).trim() }
        : { name: salon.name, state: salon.state, city: rest, local: null };
    });
  },
};

// "the location is o st", "salon: o st" (QA, 26 Oct 2026).
const CUE_BEFORE = /\b(?:at|in|our|the|location|salon|store)\s+$|\b(?:location|salon|store)\s*(?:is|=|:)\s*$/i;
/** A one-word name needs a stronger cue: "in the dodge" is a car, "the manhattan" a drink (QA-6, 26 Oct 2026). */
const ONE_WORD_CUE_BEFORE = /\b(?:at|our|location|salon|store)\s+(?:the\s+)?$|\b(?:location|salon|store)\s*(?:is|=|:)\s*$/i;
/**
 * A place the manager rules out, in the same clause: "not at lawrence",
 * "never at the o st location", "isn't kearney", "except lawrence",
 * "without the o st salon". A comma or a stop ends it, so "it is not
 * lawrence, it is kearney ne" still reads Kearney.
 */
const RULED_OUT = /\b(?:not|never|no|isn['’]?t|wasn['’]?t|aren['’]?t|weren['’]?t|doesn['’]?t|didn['’]?t|except|without)\b[^,.;!?\n]{0,30}$/i;
const CUE_AFTER = /^\s*(?:location|salon|store)\b/i;
const SUFFIXES: readonly [string, string][] = [
  ["street", "st"],
  ["road", "rd"],
  ["parkway", "pkwy"],
  ["avenue", "ave"],
  ["boulevard", "blvd"],
];
const DIRECTION = /^(?:west|east|north|south|w|e|n|s)\s+/;

interface Alias {
  readonly phrase: string;
  readonly name: string;
  readonly cued: boolean;
}

/** The short forms of a street part: "O Street" → "o street", "o st"; "West Dodge Rd" → … "dodge". */
function localForms(local: string): string[] {
  const base = local.toLowerCase().replace(/[().,]/g, " ").replace(/\s+/g, " ").trim();
  const forms = new Set([base]);
  for (const [long, short] of SUFFIXES) {
    for (const form of [...forms]) {
      forms.add(form.replace(new RegExp(`\\b${long}$`), short));
      forms.add(form.replace(new RegExp(`\\b${short}$`), long));
    }
  }
  for (const form of [...forms]) {
    const bare = form.replace(new RegExp(`\\s+(?:${SUFFIXES.flat().join("|")})$`), "");
    if (bare !== form && /[a-z]{4,}$/.test(bare)) forms.add(bare);
    const undirected = bare.replace(DIRECTION, "");
    if (undirected !== bare && /^[a-z]{4,}$/.test(undirected)) forms.add(undirected);
  }
  return [...forms].filter((form) => form.length >= 3);
}

const ALIASES: readonly Alias[] = (() => {
  const all: Alias[] = [];
  for (const place of READERS.places()) {
    const state = place.state.toLowerCase();
    const city = place.city.toLowerCase();
    const add = (phrase: string, cued: boolean) => all.push({ phrase, name: place.name, cued });
    if (place.local) {
      for (const local of localForms(place.local)) {
        add(`${local} ${state}`, false);
        add(`${local}, ${state}`, false);
        add(`${city} ${local}`, false);
        add(`${local} ${city}`, false);
        add(`${state} ${city} ${local}`, false);
        add(local, true);
      }
    } else {
      add(`${city} ${state}`, false);
      add(`${city}, ${state}`, false);
      add(`${state} ${city}`, false);
      add(city, true);
    }
  }
  for (const [phrase, name] of Object.entries(READERS.shorthand)) all.push({ phrase, name, cued: true });
  // One alias, one location: a phrase two locations share is never used.
  const owners = new Map<string, Set<string>>();
  for (const alias of all) owners.set(alias.phrase, (owners.get(alias.phrase) ?? new Set()).add(alias.name));
  const seen = new Set<string>();
  return all
    .filter((alias) => owners.get(alias.phrase)!.size === 1 && !seen.has(alias.phrase) && seen.add(alias.phrase))
    .sort((a, b) => b.phrase.length - a.phrase.length);
})();

export function withStoreAliases(request: AskRequest): AskRequest {
  if (!storeAliasEnabled()) return request;
  const asked = (index: number) => {
    const before = [...request.history.slice(0, index)].reverse().find((turn) => turn.role === "assistant");
    // The app asked, or its card is still waiting on the salon.
    const card = (before as { readonly formProposal?: { readonly locationId?: string | null; readonly locationResolution?: string } | null } | undefined)?.formProposal;
    return PLACE_QUESTION.test(before?.content ?? "") || Boolean(card && !card.locationId && card.locationResolution === "needs_selection");
  };
  // An alias fills the first SALON the chat names; a turn that already names one the
  // readers read, and every turn after it, stays as typed, so a later place word never
  // changes the salon (that is NEWEST_PLACE_TURN_ENABLED's, as on main).
  let named = false;
  const write = (text: string, placeAsked: boolean): string => {
    if (named) return text;
    // A turn the readers already read is theirs as typed, unless it answers
    // the app's own "which salon or store?".
    if (!placeAsked && READERS.named(text)) {
      named = true;
      return text;
    }
    const out = rosterNames(text, placeAsked);
    named = READERS.named(out);
    return out;
  };
  let changed = false;
  const history = request.history.map((turn, index) => {
    if (turn.role !== "user" || typeof turn.content !== "string") return turn;
    const content = write(turn.content, asked(index));
    if (content === turn.content) return turn;
    changed = true;
    return { ...turn, content };
  });
  const question = write(request.question, asked(request.history.length));
  changed ||= question !== request.question;
  return changed ? { ...request, question, history } : request;
}

const ADDRESS = /\baddress\b[:\s]+[^.;\n]+|\b\d{1,6}\s+[A-Za-z][^,.;\n]*(?:,\s*[^,.;\n]+){0,3},?\s+[A-Za-z]{2}\.?\s+\d{5}(?:-\d{4})?\b/gi;

/** The app asked which salon or store: a one-word reply may be a place. */
const PLACE_QUESTION = /\b(?:salon|store|location)\b[^\n?]*\?/i;

/**
 * The text with every alias it uses written as the roster name. `placeAsked`:
 * the app's last message asked which salon or store, so a one-word reply
 * ("dodge") is read as a place; otherwise a one-word reply stays as typed (it
 * may be a name).
 */
export function rosterNames(text: string, placeAsked = false): string {
  if (!text) return text;
  // A roster name already typed is kept out of the alias pass.
  const kept: string[] = [];
  let out = text;
  for (const place of READERS.places()) {
    out = out.replace(new RegExp(escape(place.name), "gi"), (found) => `\u0000${kept.push(found) - 1}\u0000`);
  }
  // An address ("permanent address 123 Main St, Lawrence, KS 66044") is the
  // address reader's, never a salon or store.
  out = out.replace(ADDRESS, (found) => `\u0000${kept.push(found) - 1}\u0000`);
  const whole = out.trim().replace(/[.!?]+$/, "").trim().toLowerCase();
  // "NE Kearney" typed alone under "Which salon?" is the salon answer too.
  if (placeAsked && /^\u0000\d+\u0000$/.test(whole) && READERS.places().some((place) => place.name === kept[Number(whole.slice(1, -1))])) {
    return READERS.placeReply(kept[Number(whole.slice(1, -1))]!);
  }
  for (const alias of ALIASES) {
    if (whole === alias.phrase && (placeAsked || alias.phrase.includes(" "))) {
      out = READERS.placeReply(alias.name);
      break;
    }
    const pattern = new RegExp(`(?<![\\w\\u0000])${escape(alias.phrase).replace(/,\\s?/g, ",?\\s*").replace(/ /g, "\\s+")}(?![\\w\\u0000])`, "gi");
    out = out.replace(pattern, (found, offset: number, all: string) => {
      const before = all.slice(0, offset);
      if (RULED_OUT.test(before)) return found;
      const cue = alias.phrase.includes(" ") ? CUE_BEFORE : ONE_WORD_CUE_BEFORE;
      if (alias.cued && !cue.test(before) && !CUE_AFTER.test(all.slice(offset + found.length))) return found;
      return `\u0000${kept.push(alias.name) - 1}\u0000`;
    });
  }
  return out.replace(/\u0000(\d+)\u0000/g, (_, index: string) => kept[Number(index)]!);
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
