import { readableNamesEnabled } from "@/lib/config/chat-quality-flags";

import { nameInOneCase, readableName } from "./readable-name";
import type { AskResponse } from "@/lib/ai/types";

/**
 * ============================================================================
 * THE NAME THE MANAGER USED, PREFERRED OR LEGAL (READABLE_NAMES_ENABLED)
 * ============================================================================
 *
 * QA, 15 Nov 2026: a manager typed an employee's preferred first name, and the card showed only the legal name, so it
 * looked as though the app had switched people. Pau's ruling (15 Nov 2026, ~10:20 PHT, "Preferred name is fine let it
 * be flexible"), the same rule as the agent loop's `nameAsSaid`:
 *   - the card and the form use the name the manager used: Woven's preferred first name or the legal first name, with
 *     the surname ("rae fairweather" puts "Rae Fairweather" on the form);
 *   - with neither typed, the preferred first name when Woven has one;
 *   - never a third name; the person is the same roster person either way;
 *   - with the preferred name, the reply names the legal name once: "**Rae Fairweather** (Lorraine Fairweather in
 *     Woven)", and the card's note says so.
 * Pure; the server installs the turn's roster aliases (`person-roster-store.ts`).
 */

export interface PreferredAlias {
  /** The roster id: who the person is, whichever name is used. */
  readonly id?: string;
  /** "Lorraine Fairweather": the legal name. */
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

/** What the reply says for this person the first time, with the preferred name on the card. */
export function preferredShown(alias: PreferredAlias): string {
  return `**${alias.preferred}** (${alias.legal} in Woven)`;
}

/** The card's note under the employee, with the preferred name on the card. */
export function preferredCardNote(alias: PreferredAlias): string {
  return `${alias.preferred} is ${alias.legal} in Woven.`;
}

const firstWord = (name: string) => name.trim().split(/\s+/)[0]!.toLowerCase();

/** Which of the two names the manager used: the legal one only when they typed the legal first name and not the preferred. */
export function nameAsSaid(alias: PreferredAlias, managerWords: string): string {
  const said = ` ${managerWords.toLowerCase().replace(/[^\p{L}'’-]+/gu, " ")} `;
  const saidLegal = said.includes(` ${firstWord(alias.legal)} `);
  const saidPreferred = said.includes(` ${firstWord(alias.preferred)} `);
  return saidLegal && !saidPreferred ? alias.legal : alias.preferred;
}

/**
 * The card's employee as one of the roster's preferred-name people, or null. A legal name is that person (who may have no
 * preferred name); a preferred name only when no one else is known by it (QA's review: a legal "Rae Fairweather" is not
 * Lorraine, preferred Rae).
 */
export function aliasOf(employee: string, aliases: readonly PreferredAlias[]): PreferredAlias | null {
  if (!employee) return null;
  const byLegal = aliases.filter((row) => same(row.legal, employee));
  const byPreferred = aliases.filter((row) => same(row.preferred, employee) && !same(row.legal, employee));
  const owners = byLegal.length > 0 ? byLegal : byPreferred;
  const alias = owners.length === 1 && byLegal.length + byPreferred.length === 1 ? owners[0]! : null;
  return alias && !same(alias.legal, alias.preferred) ? alias : null;
}

/**
 * A roster person's two names as the card shows them: the legal name through `displayName` (an all-caps row reads
 * "Lorraine Fairweather"), the preferred one with the same surname ("Rae Fairweather", never "Rae FAIRWEATHER").
 */
export function aliasForRosterPerson(
  person: { readonly id?: string; readonly firstName: string; readonly lastName: string; readonly preferredFirstName?: string | null },
  shown: (person: { readonly firstName: string; readonly lastName: string }) => string,
): PreferredAlias {
  const legal = shown(person);
  const preferred = person.preferredFirstName?.trim();
  const id = person.id;
  if (!preferred || same(preferred, person.firstName)) return { id, legal, preferred: legal };
  const firstWords = person.firstName.trim().split(/\s+/).length;
  const surname = legal.split(" ").slice(firstWords).join(" ");
  const first = readableNamesEnabled() && nameInOneCase(preferred) ? readableName(preferred) : preferred;
  return { id, legal, preferred: `${first} ${surname}`.trim() };
}

/**
 * The reply and card with the name the manager used (`nameAsSaid`), and the legal name said once when it is the
 * preferred one. `managerWords`: the manager's turns, this one last. Off, or no preferred name, unchanged.
 */
export function withPreferredNameShown(response: AskResponse, managerWords: string | undefined): AskResponse {
  if (!readableNamesEnabled()) return response;
  const proposal = response.formProposal;
  const employee = proposal?.employeeName?.trim() ?? "";
  const alias = proposal && proposal.subject !== "team" ? aliasOf(employee, readAliases() ?? []) : null;
  if (!proposal || !alias) return response;
  const name = nameAsSaid(alias, managerWords ?? "");
  const bold = new RegExp(String.raw`\*\*(?:${escape(alias.legal)}|${escape(alias.preferred)})\*\*`, "giu");
  if (name === alias.legal) {
    return { ...response, content: response.content.replace(bold, `**${alias.legal}**`), formProposal: { ...proposal, employeeName: alias.legal } };
  }
  let shown = response.content.includes(`(${alias.legal} in Woven)`);
  const marked = response.content.replace(bold, () => {
    if (shown) return `**${alias.preferred}**`;
    shown = true;
    return preferredShown(alias);
  });
  // Any other mention of the legal name ("… where <legal> is assigned") is said the manager's way: the legal name once.
  const inWoven = `(${alias.legal} in Woven)`;
  const content = marked
    .split(inWoven)
    .map((part) => part.replace(new RegExp(String.raw`(?<![\p{L}*])${escape(alias.legal)}(?![\p{L}*])`, "giu"), alias.preferred))
    .join(inWoven);
  return {
    ...response,
    content,
    formProposal: { ...proposal, employeeName: alias.preferred, wovenCloseMatch: proposal.wovenCloseMatch?.trim() || preferredCardNote(alias) },
  };
}

/* ------------------------------------------------- one person, two names -- */

const key = (name: string) => name.toLowerCase().replace(/['’]s\b/g, "").replace(/\./g, "").replace(/\s+/g, " ").trim();

/**
 * QA, 15 Nov 2026 (with Pau's name ruling): a form saved as "Rae Fairweather" and one saved as "Lorraine Fairweather"
 * are the same roster person, and form_instances holds only employee_name. So every by-name lookup — the on-file lines,
 * prior forms, find_past_forms, edit-by-name, duplicate-draft reuse — reads the roster person's preferred and legal
 * names as one. Only when one roster person has both: a name another roster person also has is never merged.
 * READABLE_NAMES_ENABLED; off, or no aliases this turn, nothing is merged.
 */
export function rosterAliasesOf(name: string): readonly string[] {
  if (!readableNamesEnabled()) return [name];
  const people = aliasPeople(readAliases() ?? []);
  const own = holdersOf(name, people);
  // One roster person holds the name, and each of their names belongs to them alone: a name another roster person
  // also has (a legal "Rae Fairweather", say) decides nothing.
  if (own.length !== 1) return [name];
  const names = own[0]!.names;
  return names.every((other) => holdersOf(other, people).length === 1) && names.length > 1 ? names : [name];
}

/** A roster person and every full name they are known by (legal, preferred): the one shape both paths compare. */
export interface RosterPersonNames {
  readonly id: string;
  readonly names: readonly string[];
}

function holdersOf(name: string, people: readonly RosterPersonNames[]): RosterPersonNames[] {
  const wanted = key(name);
  return wanted === "" ? [] : people.filter((person) => person.names.some((one) => key(one) === wanted));
}

function aliasPeople(aliases: readonly PreferredAlias[]): RosterPersonNames[] {
  return aliases.map((alias, index) => ({ id: alias.id ?? `alias-${index}`, names: [...new Set([alias.legal, alias.preferred])] }));
}

/**
 * THE ONE NAME-MATCHER (QA, 15 Nov 2026: one helper for both paths, batch G's agent loop and today's chat). Two names
 * are one roster person when each is a full name (preferred or legal) of exactly one roster person, and it is the same
 * person. Two different roster people are never merged, and a name two roster people share decides nothing. Pure.
 */
export function sameRosterPersonAmong(a: string, b: string, people: readonly RosterPersonNames[]): boolean {
  const [x, y] = [holdersOf(a, people), holdersOf(b, people)];
  return x.length === 1 && y.length === 1 && x[0]!.id === y[0]!.id;
}

/** Two names are one roster person, by this turn's roster (`sameRosterPersonAmong`). READABLE_NAMES_ENABLED; off, never. */
export function sameRosterPerson(a: string, b: string): boolean {
  if (!readableNamesEnabled()) return false;
  if (key(a) === key(b)) return false;
  return sameRosterPersonAmong(a, b, aliasPeople(readAliases() ?? []));
}
