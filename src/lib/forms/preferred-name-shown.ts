import { readableNamesEnabled } from "@/lib/config/chat-quality-flags";
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

/** The card's employee as one of the roster's preferred-name people, or null. */
export function aliasOf(employee: string, aliases: readonly PreferredAlias[]): PreferredAlias | null {
  if (!employee) return null;
  const alias = aliases.find((row) => same(row.legal, employee) || same(row.preferred, employee));
  return alias && !same(alias.legal, alias.preferred) ? alias : null;
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
  const content = response.content.replace(bold, () => {
    if (shown) return `**${alias.preferred}**`;
    shown = true;
    return preferredShown(alias);
  });
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
  const aliases = readAliases() ?? [];
  const wanted = key(name);
  const own = aliases.filter((row) => key(row.legal) === wanted || key(row.preferred) === wanted);
  if (own.length !== 1) return [name];
  const [alias] = own;
  // Another roster person known by either name (a legal "Rae Fairweather", say) is somebody else: no merge.
  const taken = aliases.filter((row) => row !== alias && [row.legal, row.preferred].some((other) => key(other) === key(alias!.legal) || key(other) === key(alias!.preferred)));
  if (taken.length > 0) return [name];
  return [alias!.legal, alias!.preferred];
}

/** Two names are one roster person by their preferred and legal names (`rosterAliasesOf`). */
export function sameRosterPerson(a: string, b: string): boolean {
  const left = rosterAliasesOf(a);
  if (left.length < 2) return false;
  return left.some((name) => key(name) === key(b));
}
