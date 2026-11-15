import { readableNamesEnabled } from "@/lib/config/chat-quality-flags";
import type { AskResponse } from "@/lib/ai/types";

/**
 * ============================================================================
 * THE PREFERRED NAME THE MANAGER TYPED, SAID BACK WITH THE LEGAL NAME ONCE (READABLE_NAMES_ENABLED)
 * ============================================================================
 *
 * QA, 15 Nov 2026: a manager typed an employee's preferred first name, and the card showed only the legal name, so it
 * looked as though the app had switched people. Pau's ruling (15 Nov 2026): forms show the LEGAL name only, and a
 * preferred name never goes on a form field; chat replies and cards may say the preferred name the manager typed, with
 * the legal name once — "<Preferred> <Last> (<Legal> <Last> in Woven)".
 *
 * So with the flag: when the manager's message types a roster person's preferred name and the card is that person, the
 * card's employee is the legal name, the reply's first bold mention of them reads "<preferred> (**<legal>** in
 * Woven)", and the card's note says so. Every other mention, and the form, keep the legal name. Pure; the server
 * installs the turn's roster aliases (`person-roster-store.ts`).
 */

export interface PreferredAlias {
  /** "Lorraine Fairweather": the name the form uses. */
  readonly legal: string;
  /** "Rae Fairweather": the preferred first name with the last name. */
  readonly preferred: string;
}

let readAliases: () => readonly PreferredAlias[] | undefined = () => undefined;

/** The server installs the turn's aliases; a test or the browser reads none. */
export function installPreferredAliases(read: () => readonly PreferredAlias[] | undefined): void {
  readAliases = read;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, String.raw`\s+`);

/** What the reply says for this person the first time. */
export function preferredShown(alias: PreferredAlias): string {
  // The legal name is the bold one: the reply's bold names are the card's people (REPLY_MATCHES_CARD reads them).
  return `${alias.preferred} (**${alias.legal}** in Woven)`;
}

/** The card's note under the employee. */
export function preferredCardNote(alias: PreferredAlias): string {
  return `${alias.preferred} is ${alias.legal} in Woven; the form uses the legal name.`;
}

/** The alias of the card's employee when the manager's message typed their preferred name, or null. */
export function typedPreferredAlias(employee: string, message: string | undefined, aliases: readonly PreferredAlias[]): PreferredAlias | null {
  if (!message || !employee) return null;
  const alias = aliases.find((row) => same(row.legal, employee) || same(row.preferred, employee));
  if (!alias || same(alias.legal, alias.preferred)) return null;
  return new RegExp(String.raw`(?<![\p{L}])${escape(alias.preferred)}(?![\p{L}])`, "iu").test(message) ? alias : null;
}

/** The reply and card with the preferred name said once and the legal name on the card. Off, or no alias, unchanged. */
export function withPreferredNameShown(response: AskResponse, message: string | undefined): AskResponse {
  if (!readableNamesEnabled()) return response;
  const proposal = response.formProposal;
  const employee = proposal?.employeeName?.trim() ?? "";
  const alias = proposal && proposal.subject !== "team" ? typedPreferredAlias(employee, message, readAliases() ?? []) : null;
  if (!proposal || !alias) return response;
  let shown = false;
  const content = response.content.replace(new RegExp(String.raw`\*\*(?:${escape(alias.legal)}|${escape(alias.preferred)})\*\*`, "giu"), () => {
    if (shown) return `**${alias.legal}**`;
    shown = true;
    return preferredShown(alias);
  });
  return {
    ...response,
    content,
    formProposal: { ...proposal, employeeName: alias.legal, wovenCloseMatch: proposal.wovenCloseMatch?.trim() || preferredCardNote(alias) },
  };
}

/**
 * The agent loop's find_staff (READABLE_NAMES_ENABLED): when the manager typed this person's preferred first name, how
 * the reply says them, and that the form uses the legal name. Null otherwise, or with the flag off.
 */
export function loopPreferredNote(typed: string, person: { readonly firstName: string; readonly preferredFirstName?: string | null; readonly lastName: string }): string | null {
  if (!readableNamesEnabled()) return null;
  const preferred = person.preferredFirstName?.trim() ?? "";
  if (!preferred || same(preferred, person.firstName)) return null;
  const first = typed.trim().split(/\s+/)[0] ?? "";
  if (!same(first, preferred)) return null;
  const alias = { legal: `${person.firstName.trim()} ${person.lastName.trim()}`, preferred: `${preferred} ${person.lastName.trim()}` };
  return `The manager typed the preferred name. Say "${alias.preferred} (${alias.legal} in Woven)" the first time; the form uses the legal name, ${alias.legal}.`;
}
