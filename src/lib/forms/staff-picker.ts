import type { AskResponse } from "@/lib/ai/types";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * "A COACHING FORM FOR MY WHOLE STAFF" — WHO IS ON IT, ONE PERSON AT A TIME
 * ============================================================================
 *
 * STAFF_PICKER_ENABLED (ported from Ask Bubbles; Pau, 30 Oct 2026; same flag in
 * both apps). "for whole
 * staff - associates" was refused in one chat, and "can you create a coaching
 * form for my whole staff?" made a card for "All team members" in another.
 * Pau: "if managers wants that then i need to ask bubbles and sunny to be able
 * to list staff in their location, if multiple, ask which location and check
 * woven".
 *
 * So no card for a whole staff. With more than one salon in the account's
 * scope and none named, the manager is asked which (never guessed). For one
 * salon, its staff from the Woven-synced directory — the same scoped roster
 * every name check reads, so an account sees only its own salons' people —
 * by name and position only, and the manager is asked who the form is for.
 * After that person's draft, "do the same <form> for <next>" copies it
 * (SAME_FORM_COPY_ENABLED). No model call; one directory read.
 */

const WHOLE =
  /\b(?:(?:my|our|the|all(?:\s+of)?(?:\s+(?:my|our|the))?|whole|entire|every)\s+(?:whole\s+|entire\s+)?(?:staff|team(?:\s+members)?|crew|associates|employees|salon|location)\b(?:\s*[-–—]\s*associates)?|\beveryone\b|\beverybody\b|\ball\s+(?:team\s+members|associates|employees|staff)\b)/i;
const SCOPE_WORD = /\b(?:whole|entire|all|every|everyone|everybody)\b/i;
const FORM_WORD = /\b(?:forms?|coaching|coach|corrective\s+action|ca|write[- ]?ups?|drafts?|cards?)\b/i;

/** The marker on the "which location" question, read back from the next turn's history. */
const ASKED_LOCATION = "Which salon's staff should I list?";
const LISTED = "Who is this form for?";

/** "whole staff", "my whole team", "all associates", "everyone" — said for a form. */
export function asksForWholeStaff(text: string): boolean {
  const match = WHOLE.exec(text);
  if (!match) return false;
  // "my staff" alone is a person's team, not all of it: "whole", "all", "every" or "everyone" says all.
  return SCOPE_WORD.test(match[0]);
}

function lastAssistant(history: readonly Pick<ChatMessage, "role" | "content">[]): string {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index]!;
    if (turn.role === "assistant") return turn.content ?? "";
  }
  return "";
}

/** A person on the scoped roster: name, position and salons only. */
export interface StaffPerson {
  readonly firstName: string;
  readonly lastName: string;
  readonly preferredFirstName?: string | null;
  readonly positionName?: string | null;
  readonly salonIds: readonly string[];
}

export interface StaffLocation {
  readonly id: string;
  readonly name: string;
}

function formName(text: string): string {
  if (/\bcoach/i.test(text)) return "Coaching Form";
  if (/\b(?:corrective\s+action|ca)\b/i.test(text)) return "Corrective Action Form";
  return "form";
}

const MAX_LISTED = 40;

function listStaff(location: StaffLocation, roster: readonly StaffPerson[], form: string): string {
  const people = roster
    .filter((person) => person.salonIds.includes(location.id))
    .map((person) => ({
      name: `${person.preferredFirstName?.trim() || person.firstName} ${person.lastName}`.trim(),
      position: person.positionName?.trim() || "Position not on file",
    }))
    .sort((a, b) => a.position.localeCompare(b.position) || a.name.localeCompare(b.name));
  const one = form === "form" ? "A form" : `A ${form}`;
  if (people.length === 0) {
    return `${one} is for one person at a time. I couldn't find anyone on the directory for **${location.name}**. Tell me the name of the person it is for.`;
  }
  const shown = people.slice(0, MAX_LISTED);
  const groups = new Map<string, string[]>();
  for (const person of shown) {
    if (!groups.has(person.position)) groups.set(person.position, []);
    groups.get(person.position)!.push(person.name);
  }
  const lines = [...groups].map(([position, names]) => `**${position}**\n${names.map((name) => `- ${name}`).join("\n")}`);
  const more = people.length > shown.length ? `\n\n…and ${people.length - shown.length} more. Name anyone not shown.` : "";
  const next = form === "form" ? "the same form" : `the same ${form}`;
  return [
    `${one} is for one person at a time, so I won't make one card for the whole staff. Here is the staff at **${location.name}** on the directory:`,
    `${lines.join("\n\n")}${more}`,
    `${LISTED} Name one person. Once their draft is created, say **do ${next} for <next name>** and I'll copy it onto that person's card.`,
  ].join("\n\n");
}

/**
 * The reply for a whole-staff turn, or null for any other turn. Pure: the
 * caller passes the account's in-scope locations, the scoped roster and the
 * locations the question names.
 */
export function staffPickerReply(input: {
  question: string;
  history: readonly Pick<ChatMessage, "role" | "content">[];
  /** The intake is still asking about a proposed form ("Who is this form for?"). */
  continuing: boolean;
  /** The locations this account may see, by the authenticated scope. */
  locations: readonly StaffLocation[];
  /** Location ids the question names (any; intersected with `locations` here). */
  namedLocationIds: readonly string[];
  roster: readonly StaffPerson[];
}): string | null {
  const previous = lastAssistant(input.history);
  const answeringWhich = previous.includes(ASKED_LOCATION);
  const wholeStaff =
    asksForWholeStaff(input.question) && (FORM_WORD.test(input.question) || input.continuing);
  if (!wholeStaff && !answeringWhich) return null;

  const inScope = new Map(input.locations.map((location) => [location.id, location]));
  const named = [...new Set(input.namedLocationIds)].filter((id) => inScope.has(id));
  // A reply to the location question that names no location is the manager moving on.
  if (!wholeStaff && named.length !== 1) return null;

  const form = formName(`${input.question} ${previous}`);
  const one = form === "form" ? "A form" : `A ${form}`;
  if (named.length === 1) return listStaff(inScope.get(named[0]!)!, input.roster, form);
  if (inScope.size === 1) return listStaff([...inScope.values()][0]!, input.roster, form);
  if (inScope.size === 0) {
    return `${one} is for one person at a time, and I can't list a staff for your account. Tell me the name of the person it is for.`;
  }
  const names = [...inScope.values()].map((location) => location.name).sort((a, b) => a.localeCompare(b));
  const choices = names.length <= 15 ? `\n\n${names.map((name) => `- ${name}`).join("\n")}` : "";
  return `${one} is for one person at a time, so I won't make one card for the whole staff. ${ASKED_LOCATION} Your account covers ${names.length} salons.${choices}`;
}

export function staffPickerAnswer(content: string): AskResponse {
  return { content, citations: [], coverage: "not_applicable", recommendedVideoIds: [] };
}

/**
 * The route's turn: the account's own locations and scoped roster, read only
 * when the words ask for a whole staff (or answer the location question).
 */
export async function staffPickerTurn(input: {
  question: string;
  history: readonly Pick<ChatMessage, "role" | "content">[];
  continuing: boolean;
  scope: AccessScope | null;
}): Promise<AskResponse | null> {
  const answeringWhich = lastAssistant(input.history).includes(ASKED_LOCATION);
  if (!asksForWholeStaff(input.question) && !answeringWhich) return null;
  const [{ authorizedSalonIds }, { PRODUCTION_SALONS, salonById }, { readSalonMentions }, roster] = await Promise.all([
    import("@/lib/forms/location-scope"),
    import("@/data/salons"),
    import("@/lib/forms/salon-mention"),
    import("@/lib/forms/employee-roster"),
  ]);
  /*
   * The salons this account may see, as the roster reads them: one salon's
   * scope its own salons, a global scope every salon. A district or region
   * reads no roster here (`scopeRoster` fails closed), so none is listed.
   */
  const ids = !input.scope
    ? []
    : input.scope.level === "global"
      ? PRODUCTION_SALONS.map((salon) => salon.id)
      : authorizedSalonIds(input.scope);
  const locations = ids
    .map((id) => salonById(id))
    .filter((salon): salon is NonNullable<typeof salon> => Boolean(salon))
    .map((salon) => ({ id: salon.id, name: salon.name }));
  const namedLocationIds = readSalonMentions(input.question).flatMap((mention) => [...mention.salonIds]);
  // Asked first without the roster: the salon question needs no directory read.
  const draft = staffPickerReply({ ...input, locations, namedLocationIds, roster: [] });
  if (draft === null) return null;
  const needsRoster = draft.includes(LISTED) || draft.includes("couldn't find anyone");
  if (!needsRoster) return staffPickerAnswer(draft);
  // Woven's title where the directory read gives it; the plain scoped roster otherwise.
  const facts = await roster.readDirectoryFacts(input.scope);
  const people: StaffPerson[] =
    facts.length > 0
      ? facts.map((person) => ({ ...person, positionName: person.title }))
      : await roster.loadScopedRoster(input.scope);
  return staffPickerAnswer(staffPickerReply({ ...input, locations, namedLocationIds, roster: people })!);
}
