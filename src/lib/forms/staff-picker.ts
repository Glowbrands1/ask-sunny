import { salonById, type ProductionSalon } from "@/data/salons";
import type { AskResponse } from "@/lib/ai/types";
import { loadScopedRoster, readDirectoryFacts } from "@/lib/forms/employee-roster";
import { rosterSalonFor } from "@/lib/forms/salon-text";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * "FOR WHOLE STAFF" — ONE FORM PER PERSON, PICKED FROM THE STAFF LIST
 * ============================================================================
 *
 * STAFF_PICKER_ENABLED (port from the sibling app; QA and Pau, 30 Oct 2026, same
 * flag in both apps). There one manager's "for whole staff - associates" was
 * refused and another's "can you create a coaching form for my whole staff?"
 * got a blanket card named "All team members". Pau: no blanket form — ask
 * which salon, list its staff, and the manager picks who.
 *
 * So a whole-staff request on a form turn is answered here, before any card:
 *   - an account covering more than one salon is asked which salon;
 *   - the salon's active staff are listed from the Woven-synced directory, read
 *     through the same scoped roster the chat already uses (an Assistant Salon
 *     Director sees their own salon only), name and position only;
 *   - the manager is asked who the form is for, one person at a time.
 * A database read, no model call.
 */

/** "whole staff", "my whole team", "all associates", "everyone", "all of my employees". */
const WHOLE_STAFF =
  /\b(?:whole|entire)\s+(?:\w+\s+)?(?:staff|team|crew|salon)\b|\ball\s+(?:of\s+)?(?:my\s+|the\s+|our\s+)?(?:staff|team(?:\s+members)?|associates|employees|crew|people)\b|\beveryone\b|\bevery(?:\s+single)?\s+(?:employee|associate|team\s+member)\b/i;

/** The turn is about a form: named in it, or answering "Who is this form for?". */
const FORM_WORDS = /\b(?:form|coaching|write-?\s?up|corrective\s+action|\bca\b|warning|evaluation|review)\b/i;
const WHO_ASKED = /\bwho is (?:this|the) (?:form|coaching form|[a-z ]*form) for\b|\bwhole team\b|\ball team members\b/i;

/** The marker this module's own salon question carries, so the answer is read here. */
export const STORE_QUESTION = "Which salon's staff should I list?";

const LISTED_MAX = 40;

function lastAssistant(history: readonly Pick<ChatMessage, "role" | "content">[]): string {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]!.role === "assistant") return history[index]!.content ?? "";
  }
  return "";
}

export function asksForWholeStaff(question: string, history: readonly Pick<ChatMessage, "role" | "content">[]): boolean {
  if (!WHOLE_STAFF.test(question)) return false;
  return FORM_WORDS.test(question) || WHO_ASKED.test(lastAssistant(history));
}

/** One person on the list: who, where, and the position Woven gives, if any. */
interface StaffMember {
  readonly firstName: string;
  readonly lastName: string;
  readonly preferredFirstName?: string | null;
  readonly salonIds: readonly string[];
  readonly positionName: string | null;
}

/** The directory with positions; a district or region (which it does not read) falls back to the roster. */
async function staffInScope(scope: AccessScope | null): Promise<StaffMember[]> {
  const facts = await readDirectoryFacts(scope);
  if (facts.length > 0) return facts.map((person) => ({ ...person, positionName: person.title }));
  return (await loadScopedRoster(scope)).map((person) => ({ ...person, positionName: null }));
}

function displayName(person: StaffMember): string {
  return `${(person.preferredFirstName || person.firstName).trim()} ${person.lastName.trim()}`.trim();
}

/** Name and position only, grouped by position, at most `LISTED_MAX` names. */
function staffList(store: ProductionSalon, people: readonly StaffMember[]): string {
  if (people.length === 0) {
    return `I can't see any active staff at **${store.name}** in the directory. Tell me who the form is for by name.`;
  }
  const byPosition = new Map<string, string[]>();
  for (const person of [...people].sort((a, b) => displayName(a).localeCompare(displayName(b)))) {
    const position = person.positionName?.trim() || "Position not on file";
    byPosition.set(position, [...(byPosition.get(position) ?? []), displayName(person)]);
  }
  const lines: string[] = [];
  let listed = 0;
  for (const [position, names] of [...byPosition.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (listed >= LISTED_MAX) break;
    const shown = names.slice(0, LISTED_MAX - listed);
    listed += shown.length;
    lines.push(`**${position}**`, ...shown.map((name) => `- ${name}`), "");
  }
  const more = people.length - listed;
  return [
    `A form is written for one person, so here is the staff at **${store.name}** (${people.length}):`,
    "",
    ...lines,
    ...(more > 0 ? [`…and ${more} more — tell me a name if you don't see them.`, ""] : []),
    "Who is the form for? Name one person and I'll start their form. For several, I'll do them one at a time — when the first is ready, say **do the same form for** the next person and it carries over.",
  ].join("\n");
}

function storeQuestion(stores: readonly ProductionSalon[]): string {
  return [
    "A form is written for one person, so I'll list the staff for you to pick from.",
    "",
    STORE_QUESTION,
    "",
    ...stores.slice(0, 30).map((store) => `- ${store.name}`),
    ...(stores.length > 30 ? [`…and ${stores.length - 30} more — name the salon.`] : []),
  ].join("\n");
}

function reply(content: string): AskResponse {
  return { content, citations: [], coverage: "not_applicable", recommendedVideoIds: [] };
}

export async function staffPickerTurn(input: {
  question: string;
  history: readonly Pick<ChatMessage, "role" | "content">[];
  scope: AccessScope | null;
}): Promise<AskResponse | null> {
  const answeringStore = lastAssistant(input.history).includes(STORE_QUESTION);
  if (!answeringStore && !asksForWholeStaff(input.question, input.history)) return null;

  const roster = await staffInScope(input.scope);
  const storeIds = [...new Set(roster.flatMap((person) => person.salonIds))];
  const stores = storeIds
    .map((id) => salonById(id))
    .filter((store): store is ProductionSalon => Boolean(store))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (stores.length === 0) {
    return answeringStore
      ? null
      : reply("A form is written for one person, and I can't see a staff list for your account. Tell me who the form is for by name.");
  }

  const staffAt = (store: ProductionSalon) => roster.filter((person) => person.salonIds.includes(store.id));

  if (answeringStore) {
    /*
     * The manager's own words are the last line: the intake may have put what
     * it already read ("It happened at NE Kearney.") on the lines above.
     */
    const lines = input.question.split("\n").map((line) => line.trim()).filter(Boolean).reverse();
    let chosen: ProductionSalon | undefined;
    for (const line of lines) {
      const resolved = rosterSalonFor(line);
      const typed = line.toLowerCase();
      chosen = resolved
        ? stores.find((store) => store.id === resolved.id)
        : stores.find((store) => store.name.toLowerCase().includes(typed));
      if (chosen) break;
    }
    // A salon outside the account's own is never listed: asked again from the account's salons.
    return reply(chosen ? staffList(chosen, staffAt(chosen)) : storeQuestion(stores));
  }

  return reply(stores.length === 1 ? staffList(stores[0]!, staffAt(stores[0]!)) : storeQuestion(stores));
}
