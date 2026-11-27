import "server-only";

import { ACTIVE_BRAND } from "@/lib/brand";
import type { RosterEmployee } from "@/lib/forms/employee-match";
import { authorizedSalonIds } from "@/lib/forms/location-scope";
import { rosterSalonName, spokenSalonNames } from "@/lib/forms/salon-mention";
import { PRODUCTION_SALONS } from "@/data/salons";
import { spokenNameKeyterms, spokenVocabulary, type SpokenPlace, type SpokenVocabulary } from "./spoken-names";
import type { AccessScope, ChatMessage, Role } from "@/types";

/**
 * ============================================================================
 * SPELLING HINTS FOR ASSEMBLYAI, BUILT ON THE SERVER (VOICE_INPUT_ENABLED)
 * ============================================================================
 *
 * At most 100 terms and 8,000 characters, duplicates removed, terms over six words dropped. Every term comes from the
 * app's own data on the server; the browser cannot add one. The list is never logged and never sent to the browser.
 *
 * CHANGED ON PURPOSE (the owner, 27 Nov 2026: "i said Curt, it spelled it as Kurt"; "make sure sunny ... know the
 * spelling of all employee"; "also salon names too"). A staff name used to be a hint only when this person's own
 * conversation had already used it, so the FIRST time a manager said a name, nothing told the provider how it is
 * spelled. Now the people and salons this manager may already see (the same scoped roster the forms' name check reads,
 * and the salons of their scope) are hints too, after the conversation's own names, and the 100-term bound keeps the
 * manager's own salons first. Nobody outside their scope is ever a hint. The same people and salons are the
 * `vocabulary` the route corrects the transcript's spelling against (`spoken-names.ts`); it stays on the server.
 *
 * Boxes A, B and C (the chat, the Overview band, a report's ask bar), in this order:
 *   (a) names used in this conversation (the person's own, read from the server's history, and only when the browser
 *       named a conversation that is theirs), kept only when they are also on the person's scoped roster;
 *   (b) the person's own salon name, then the other salons in their scope (with the short names the app knows);
 *   (c) the published form type names;
 *   (d) the people on their scoped roster: their own salons' first, full names, then first names.
 * Box D (the L10 Leadership Assistant), in this order:
 *   (a) the people in that meeting, as the Leadership Hub returns them to this person (names only);
 *   (b) the meeting's name as the Hub gives it;
 *   (c) the salons and then the people of this person's scope, as above.
 */

export const MAX_KEYTERMS = 100;
export const MAX_KEYTERM_CHARACTERS = 8_000;
export const MAX_KEYTERM_WORDS = 6;
/** Recent turns sent as `conversation_context`, each cut to this many characters. */
const CONTEXT_TURNS = 6;
const CONTEXT_TURN_CHARACTERS = 1_200;

export interface VoiceHints {
  readonly keyterms: string[];
  readonly prompt: string;
  /** Only when the person's own conversation was read (boxes A, B, C). */
  readonly conversationContext?: string[];
  /** The scoped people and salons the transcript's spelling is checked against. Server only: never sent or logged. */
  readonly vocabulary?: SpokenVocabulary;
}

export interface VoiceActor {
  readonly userId: string;
  readonly role: Role | null;
  readonly scope: AccessScope | null;
}

/** Bounds a list of terms: trimmed, no duplicates (any letter case), six words at most, 100 terms, 8,000 characters. */
export function boundKeyterms(terms: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let characters = 0;
  for (const raw of terms) {
    const term = (raw ?? "").replace(/\s+/g, " ").trim();
    if (!term) continue;
    if (term.split(" ").length > MAX_KEYTERM_WORDS) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    if (out.length >= MAX_KEYTERMS) break;
    if (characters + term.length > MAX_KEYTERM_CHARACTERS) continue;
    seen.add(key);
    out.push(term);
    characters += term.length;
  }
  return out;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The roster's names that the conversation's text uses, spelled as the directory spells them. */
export function rosterNamesUsed(messages: readonly Pick<ChatMessage, "content">[], roster: readonly RosterEmployee[]): string[] {
  const text = messages.map((message) => message.content ?? "").join("\n");
  if (!text.trim()) return [];
  const used: { name: string; at: number }[] = [];
  for (const employee of roster) {
    const last = (employee.lastName ?? "").trim();
    const firsts = [employee.firstName, employee.preferredFirstName].map((first) => (first ?? "").trim()).filter(Boolean);
    for (const first of firsts) {
      if (!last) continue;
      const name = `${first} ${last}`;
      const match = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(name).replace(/ /g, "\\s+")}(?=$|[^\\p{L}\\p{N}])`, "iu").exec(text);
      if (match) used.push({ name, at: match.index });
    }
  }
  return used.sort((a, b) => a.at - b.at).map((entry) => entry.name);
}

function recentTurns(messages: readonly ChatMessage[]): string[] {
  return messages
    .filter((message) => (message.role === "user" || message.role === "assistant") && (message.content ?? "").trim())
    .slice(-CONTEXT_TURNS)
    .map((message) => message.content.replace(/\s+/g, " ").trim().slice(0, CONTEXT_TURN_CHARACTERS));
}

function chatPrompt(): string {
  return `A ${ACTIVE_BRAND.brandName} manager is speaking a question or request to ${ACTIVE_BRAND.productName}, the company's assistant for salon policy, coaching, HR forms, operations and performance. The speech may name employees, salons and form types.`;
}

function l10Prompt(meetingName: string | null): string {
  const meeting = meetingName ? ` (${meetingName})` : "";
  return `A ${ACTIVE_BRAND.brandName} manager is speaking to the Leadership Assistant during a leadership L10 meeting${meeting}. The speech may name the meeting's people, scorecard measurables, rocks, issues, to-dos and salons.`;
}

/* ── Boxes A, B and C ─────────────────────────────────────────────────── */

export interface ChatHintDeps {
  /** The person's own conversation by its browser id, or null when it is not theirs (or cannot be read). */
  readonly ownConversation: (userId: string, conversationId: string) => Promise<readonly ChatMessage[] | null>;
  readonly scopedRoster: (scope: AccessScope | null) => Promise<readonly RosterEmployee[]>;
  readonly publishedFormNames: (actor: VoiceActor) => Promise<readonly string[]>;
  readonly salonName: (scope: AccessScope | null) => string | null;
  /** The salons this scope may see, by the names a manager says them by. */
  readonly scopedPlaces?: (scope: AccessScope | null) => readonly SpokenPlace[];
}

export async function chatVoiceHints(
  input: { readonly actor: VoiceActor; readonly conversationId?: string | null },
  deps: ChatHintDeps = defaultChatHintDeps,
): Promise<VoiceHints> {
  const { actor } = input;
  const roster = await deps.scopedRoster(actor.scope).catch(() => [] as readonly RosterEmployee[]);
  const places = (deps.scopedPlaces ?? scopedPlaces)(actor.scope);
  let names: string[] = [];
  let conversationContext: string[] | undefined;
  if (input.conversationId) {
    const messages = await deps.ownConversation(actor.userId, input.conversationId).catch(() => null);
    if (messages && messages.length > 0) {
      names = rosterNamesUsed(messages, roster);
      const turns = recentTurns(messages);
      if (turns.length > 0) conversationContext = turns;
    }
  }
  const forms = await deps.publishedFormNames(actor).catch(() => []);
  const scoped = spokenNameKeyterms(roster, places, ownSalonIds(actor.scope));
  const keyterms = boundKeyterms([...names, deps.salonName(actor.scope), ...scoped.places, ...forms, ...scoped.people]);
  return {
    keyterms,
    prompt: chatPrompt(),
    ...(conversationContext ? { conversationContext } : {}),
    vocabulary: spokenVocabulary(roster, places),
  };
}

/* ── Box D ────────────────────────────────────────────────────────────── */

export interface L10HintDeps {
  /** The meeting as the Hub returns it to this person: its name and its people's names (never emails or ids). */
  readonly meeting: (meetingKey: string) => Promise<{ readonly name: string | null; readonly people: readonly string[] } | null>;
  readonly salonName: (scope: AccessScope | null) => string | null;
  readonly scopedRoster?: (scope: AccessScope | null) => Promise<readonly RosterEmployee[]>;
  readonly scopedPlaces?: (scope: AccessScope | null) => readonly SpokenPlace[];
}

export async function l10VoiceHints(
  input: { readonly meetingKey: string; readonly scope: AccessScope | null },
  deps: L10HintDeps = defaultL10HintDeps,
): Promise<VoiceHints> {
  const meeting = await deps.meeting(input.meetingKey).catch(() => null);
  const roster = await (deps.scopedRoster ?? defaultScopedRoster)(input.scope).catch(() => [] as readonly RosterEmployee[]);
  const places = (deps.scopedPlaces ?? scopedPlaces)(input.scope);
  const scoped = spokenNameKeyterms(roster, places, ownSalonIds(input.scope));
  const keyterms = boundKeyterms([...(meeting?.people ?? []), meeting?.name, deps.salonName(input.scope), ...scoped.places, ...scoped.people]);
  // The meeting's people are spellings the Hub gave this person, so they are corrected to as well.
  const meetingPeople: RosterEmployee[] = (meeting?.people ?? []).map((name, index) => {
    const [first = "", ...rest] = name.trim().split(/\s+/);
    return { id: `meeting-${index}`, firstName: first, lastName: rest.join(" "), preferredFirstName: null, salonIds: [] };
  });
  return { keyterms, prompt: l10Prompt(meeting?.name ?? null), vocabulary: spokenVocabulary([...roster, ...meetingPeople], places) };
}

/* ── The app's own readers ────────────────────────────────────────────── */

/** The salons whose people come first in the hints: a salon scope's own salons; none for a wider scope. */
function ownSalonIds(scope: AccessScope | null): string[] {
  return scope && scope.level === "salon" ? authorizedSalonIds(scope) : [];
}

/**
 * The salons a scope may see, as the directory is scoped: a salon scope's own salons, a district or region's salons,
 * every salon for a global scope, and none without a scope.
 */
export function scopedPlaces(scope: AccessScope | null): SpokenPlace[] {
  if (!scope) return [];
  const ids = scope.level === "global" ? PRODUCTION_SALONS.map((salon) => salon.id) : authorizedSalonIds(scope);
  return ids.map((id) => ({ id, names: spokenSalonNames(id) })).filter((place) => place.names.length > 0);
}

async function defaultScopedRoster(scope: AccessScope | null): Promise<readonly RosterEmployee[]> {
  const { loadScopedRoster } = await import("@/lib/forms/employee-roster");
  return loadScopedRoster(scope);
}

function ownSalonName(scope: AccessScope | null): string | null {
  if (!scope || scope.level !== "salon" || !scope.primaryAreaId) return null;
  return rosterSalonName(scope.primaryAreaId);
}

const defaultChatHintDeps: ChatHintDeps = {
  async ownConversation(userId, conversationId) {
    const { getOwnConversation } = await import("@/lib/chat/store");
    try {
      return (await getOwnConversation(userId, conversationId)).messages;
    } catch {
      return null;
    }
  },
  scopedRoster: defaultScopedRoster,
  async publishedFormNames(actor) {
    const [{ listTemplateSummaries }, { buildFormInventory, publishedEntries }] = await Promise.all([
      import("@/lib/forms/repository"),
      import("@/lib/forms/inventory"),
    ]);
    return publishedEntries(buildFormInventory(await listTemplateSummaries(), { role: actor.role, scope: actor.scope })).map((entry) => entry.name);
  },
  salonName: ownSalonName,
};

const defaultL10HintDeps: L10HintDeps = {
  async meeting(meetingKey) {
    const { openMeeting } = await import("@/features/l10/data.server");
    const opened = await openMeeting(meetingKey);
    if (!opened.ok) return null;
    return {
      name: typeof opened.meeting.info?.name === "string" ? opened.meeting.info.name : null,
      people: opened.meeting.people.map((person) => person?.name).filter((name): name is string => typeof name === "string"),
    };
  },
  salonName: ownSalonName,
};
