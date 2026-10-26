import { PRODUCTION_SALONS } from "@/data/salons";
import { storeAliasEnabled } from "@/lib/config/chat-quality-flags";
import type { AskRequest } from "@/lib/ai/types";

/**
 * ============================================================================
 * STORE_ALIAS_ENABLED: WHAT MANAGERS TYPE FOR A SALON, READ AS THE SALON
 * ============================================================================
 *
 * QA, 26 Oct 2026 (production chats in both apps). "kearney, ne", "lawrence,
 * ks" and "manhattan ks" named no salon: the card's Salon stayed "Not set"
 * and there was no Create draft button. A bare "o st" typed under "Which
 * salon is this about?" named none either, and was searched as a knowledge
 * question ("I don't have anything in the knowledge base for …").
 *
 * A PRE-READ, NOT A NEW READER. Before any reader sees the turn, an alias is
 * rewritten to the salon's roster name ("kearney, ne" → "NE Kearney"), which
 * every reader already knows. `salon-mention.ts` is not changed.
 *
 *   anywhere      a place followed by its own state ("kearney, ne",
 *                 "lawrence ks", "st joe, mo"): the state is the cue, so the
 *                 alias is read wherever it stands;
 *   a bare reply  the whole turn is the place ("o st", "132nd and maple",
 *                 "the location is wornall"), and the app's last message
 *                 asked which salon, or the turn says it is the salon: only
 *                 then, because "Lawrence" and "Liberty" are also people.
 *
 * Only an alias that names exactly one roster salon is rewritten; "lincoln"
 * or "omaha" alone names several and stays as typed, for the readers to ask
 * about. Off, the request is as sent.
 *
 * The same mechanism in both apps; only `ROSTER` (the company's own salon
 * or store list) differs.
 */

interface Place {
  /** The roster name every reader knows. */
  readonly name: string;
  readonly state: string;
  /** What managers type for it, lower case, without the state. */
  readonly aliases: readonly string[];
}

/** "street" and "st", "and" and "&": one spelling, on both sides. */
function fold(text: string): string {
  return ` ${text.toLowerCase()} `
    .replace(/[.'’]/g, "")
    .replace(/&/g, " and ")
    .replace(/\bstreet\b/g, "st")
    .replace(/\bsaint\b/g, "st")
    .replace(/\bparkway\b/g, "pkwy")
    .replace(/\bkc\b/g, "kansas city")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * This app's salons. "NE Lincoln O Street": the state is the prefix; the
 * city is the head several salons share ("lincoln"), and what follows it
 * ("o st") is that salon's own name. Local shorthand ("st joe") is added
 * where it names one salon.
 */
const ROSTER: readonly Place[] = (() => {
  const locals = PRODUCTION_SALONS.map((salon) => fold(salon.name.slice(3)));
  const shared = (head: string) => locals.filter((local) => local === head || local.startsWith(`${head} `)).length > 1;
  const extra: Readonly<Record<string, readonly string[]>> = { "MO St Joseph": ["st joe"] };
  return PRODUCTION_SALONS.map((salon, index) => {
    const local = locals[index]!;
    const words = local.split(" ");
    const aliases = new Set<string>([local, ...(extra[salon.name] ?? [])]);
    for (let length = 1; length < words.length; length += 1) {
      if (!shared(words.slice(0, length).join(" "))) continue;
      const own = words.slice(length).join(" ");
      if (own.replace(/\s/g, "").length >= 2) aliases.add(own);
      // "132nd and maple": either street alone is still this salon.
      for (const part of own.split(" and ")) if (part.length >= 3 && part !== own) aliases.add(part);
    }
    return { name: salon.name, state: salon.state.toLowerCase(), aliases: [...aliases] };
  });
})();

/** The one place an alias names, or null when it names none or several. */
function placeFor(alias: string, state: string | null): Place | null {
  const said = fold(alias);
  const found = ROSTER.filter(
    (place) => (!state || place.state === state.toLowerCase()) && place.aliases.some((name) => name === said),
  );
  // "lincoln" names three; "o st" one. Several candidates are left for the readers to ask about.
  const unique = [...new Set(found.map((place) => place.name))];
  return unique.length === 1 ? found[0]! : null;
}

const STATES = [...new Set(ROSTER.map((place) => place.state))];
const ALIAS_WORDS = [...new Set(ROSTER.flatMap((place) => place.aliases))].sort((a, b) => b.length - a.length);

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** An alias as typed: its words in order, "st"/"street", "and"/"&", points and commas between. */
function typedPattern(alias: string): string {
  return alias
    .split(" ")
    .map((word) => (word === "st" ? "(?:st\\.?|street|saint)" : word === "and" ? "(?:and|&)" : escape(word)))
    .join("[\\s.,]+");
}

const WITH_STATE = new RegExp(
  String.raw`(?<![\w-])(${ALIAS_WORDS.map(typedPattern).join("|")})\s*,?\s+(${STATES.join("|")})\b(?![\w-])`,
  "gi",
);

/** "kearney, ne" → "NE Kearney" wherever it stands. */
export function withStatedAliases(text: string): string {
  return text.replace(WITH_STATE, (whole, alias: string, state: string) => placeFor(alias, state)?.name ?? whole);
}

/** "the location is …", "salon: …", "at …": the turn says the place is the salon. */
const PLACE_LABEL =
  /^(?:(?:the\s+)?(?:(?:primary|home|main)\s+)?(?:salon|store|location)(?:\s+(?:is|=|:)|:)|it'?s\s+(?:at|in)|at|in)\s+(?:the\s+|our\s+)?/i;

/** The app's last message asked which salon. */
const ASKED_PLACE = /\b(?:which|what)\s+(?:salon|store|location)\b|\b(?:salon|store|location)\s*\?/i;

/** How this app labels a place reply, so every reader takes it as the salon answer, never as the account. */
const PLACE_REPLY = "the salon is";

/**
 * A whole turn that is only the place, as the salon answer, or null. It counts
 * when it carries its state ("kearney, ne"), says it is the salon ("the
 * location is o st"), or answers "Which salon is this about?". A bare reply
 * is written "the salon is NE Kearney": the readers take it as the salon,
 * and the incident readers never take it for what happened.
 */
export function bareAliasReply(turn: string, asked: boolean): string | null {
  const said = turn.trim().replace(/[.!]+$/, "");
  const label = PLACE_LABEL.exec(said)?.[0] ?? "";
  const rest = said
    .slice(label.length)
    .replace(/\s+(?:salon|store|location)$/i, "")
    .trim();
  const stated = /^(.+?)\s*,?\s+([a-z]{2})$/i.exec(rest);
  const withState = stated ? placeFor(stated[1]!, stated[2]!) : null;
  if (!withState && !label && !asked) return null;
  const place = withState ?? placeFor(rest, null);
  if (!place) return null;
  // "the location is o st" keeps the manager's label; "at o st" and a bare "o st" are the salon answer.
  return /\b(?:salon|store|location)\b/i.test(label) ? `${label}${place.name}` : `${PLACE_REPLY} ${place.name}`;
}

/** One manager turn as the readers should see it. `asked`: the app's last message asked which salon. */
export function readStoreAliases(turn: string, asked: boolean): string {
  return bareAliasReply(turn, asked) ?? withStatedAliases(turn);
}

interface AssistantTurn {
  readonly content: string;
  readonly formProposal?: { readonly locationId?: string | null; readonly locationResolution?: string | null } | null;
}

/**
 * The app asked which salon: one of its question lines asks it ("What is
 * their job title? / Which salon? / Verbal or written?"), or its card is
 * still waiting on the salon.
 */
export function askedForPlace(turn: AssistantTurn | null): boolean {
  if (!turn) return false;
  if (turn.content.split("\n").some((line) => /\?/.test(line) && ASKED_PLACE.test(line))) return true;
  const card = turn.formProposal;
  return Boolean(card && !card.locationId && card.locationResolution === "needs_selection");
}

/** The request the readers see: the question and the manager's earlier turns, each alias as its roster salon. */
export function withStoreAliases(request: AskRequest): AskRequest {
  if (!storeAliasEnabled()) return request;
  let last: AssistantTurn | null = null;
  let changed = false;
  const history = request.history.map((turn) => {
    if (turn.role === "assistant") {
      last = turn as AssistantTurn;
      return turn;
    }
    if (turn.role !== "user" || typeof turn.content !== "string") return turn;
    const content = readStoreAliases(turn.content, askedForPlace(last));
    if (content === turn.content) return turn;
    changed = true;
    return { ...turn, content };
  });
  const question = readStoreAliases(request.question, askedForPlace(last));
  if (question !== request.question) changed = true;
  return changed ? { ...request, question, history } : request;
}
