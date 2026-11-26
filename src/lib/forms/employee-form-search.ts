import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { ADMIN_CONSOLE_ROLES } from "@/lib/permissions";
import type { Role } from "@/types";

import type { FormsActor } from "./access";
import { mayReadHrDecision } from "./hr-approval-rules";
import { listInstances, type InstanceListFilter, type InstanceRow } from "./instances";

/**
 * ============================================================================
 * FIND EVERY FORM ON FILE FOR ONE EMPLOYEE (leadership meeting, 24 Nov 2026)
 * ============================================================================
 *
 * HR asked to "search by employee": "if she's going back and trying to track like a CA for someone specific, she could
 * type in their name and it would pull up with anything that's been drafted or approved". Pau: only for HR and
 * administrators, a search bar on the forms list in both apps; every past form for that person, drafts included, with
 * its date, each one openable.
 *
 * WHY A READ OF ITS OWN, NOT A FILTER OVER THE LIST. The list is the newest 200 forms. Six months from now a person's
 * forms are mostly older than that, so filtering the rows on screen would quietly miss them. This asks the database
 * for the name (`employeeNameWords`, accent-folded), narrowed by exactly the filter the list uses
 * (`instanceListFilterFor`), and the page re-checks every row with the same predicate it uses for the list. The search
 * can therefore never show a form the list itself would not.
 *
 * WHO. HR approvers (`form_hr_approvers`) and the administrator roles (`ADMIN_CONSOLE_ROLES`). Nobody else is offered
 * the box, and a `?employee=` typed into the URL by anybody else is ignored.
 */

/** At most this many rows are read for one search; a name that matches more says so and asks for the full name. */
export const EMPLOYEE_SEARCH_LIMIT = 300;

/** Words shorter than this are not searched: "a" or "j" would match nearly every form. */
const MIN_WORD_LENGTH = 2;
const MAX_WORDS = 4;

/** Whether this reader is offered the employee search. HR approvers and administrators only. */
export function mayUseEmployeeFormSearch(actor: Pick<FormsActor, "hrApprover" | "role">): boolean {
  if (actor.hrApprover === true) return true;
  return actor.role !== null && (ADMIN_CONSOLE_ROLES as readonly Role[]).includes(actor.role);
}

/** Lower case, accents removed: "Lucía" and "lucia" are the same name (QA's f072). */
export function foldName(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * The words of what was typed, as the database read accepts them: letters only, folded, at least two letters, at most
 * four words. Empty when nothing searchable was typed, which shows the hint rather than every form.
 */
export function employeeSearchWords(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const words = foldName(raw.slice(0, 120))
    .split(/[^a-z]+/)
    .filter((word) => word.length >= MIN_WORD_LENGTH);
  return [...new Set(words)].slice(0, MAX_WORDS);
}

/**
 * Every word must be in the name. The database read matches ANY word (so "maria lopez" also reads every other Maria);
 * this narrows it to the person typed, in either order, with or without accents.
 */
export function nameHasEveryWord(employeeName: string, words: readonly string[]): boolean {
  const folded = foldName(employeeName);
  return words.every((word) => folded.includes(word));
}

/**
 * THE FILTER BESIDE THE BOX ("pulling up drafted/approved forms by filter"). Finalized includes a finalized form that
 * was later revised; Approved by HR is only offered meaningfully to a reader who may know (`hrNote`).
 */
export type EmployeeSearchStatus = "all" | "draft" | "finalized" | "hr_approved";

export function parseEmployeeSearchStatus(raw: string | null | undefined): EmployeeSearchStatus {
  return raw === "draft" || raw === "finalized" || raw === "hr_approved" ? raw : "all";
}

function statusMatches(result: EmployeeFormResult, status: EmployeeSearchStatus): boolean {
  if (status === "draft") return result.status === "draft";
  if (status === "finalized") return result.status === "finalized" || result.status === "revised";
  if (status === "hr_approved") return result.hrNote === HR_NOTE.approved;
  return true;
}

/** What one result row shows. Serializable: it is rendered by a component shared by both apps. */
export interface EmployeeFormResult {
  id: string;
  employeeName: string;
  formName: string;
  variantKey: string | null;
  status: InstanceRow["status"];
  /** "Waiting for HR", "Sent back", "Rejected", "Approved by HR" — only for a reader who may know (`mayReadHrDecision`). */
  hrNote: string | null;
  formDate: string;
  createdAt: string;
  locationName: string | null;
  createdByName: string;
}

export interface EmployeeFormSearch {
  query: string;
  words: string[];
  results: EmployeeFormResult[];
  /** The read stopped at `EMPLOYEE_SEARCH_LIMIT` rows, so older forms for this name may not be listed. */
  capped: boolean;
}

const HR_NOTE: Record<NonNullable<InstanceRow["hrApprovalState"]>, string> = {
  pending: "Waiting for HR",
  changes_requested: "Sent back by HR",
  rejected: "Rejected by HR",
  approved: "Approved by HR",
};

/** Newest form date first; the same day, the later-created first. */
function newestFirst(a: InstanceRow, b: InstanceRow): number {
  if (a.formDate !== b.formDate) return a.formDate < b.formDate ? 1 : -1;
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
}

/** Display names for the creators; best effort, an unknown account reads "A manager". */
async function creatorNames(ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const accounts = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (accounts.length === 0) return names;
  try {
    const { data } = await getSupabaseAdmin().from("app_users").select("id, display_name").in("id", accounts);
    for (const user of (data ?? []) as { id: string; display_name: string | null }[]) {
      if (user.display_name) names.set(user.id, user.display_name);
    }
  } catch {
    // Names are a courtesy; the forms are still listed.
  }
  return names;
}

export interface EmployeeFormSearchOptions {
  /** The list's own read filter for this reader (`instanceListFilterFor`). */
  filter: InstanceListFilter | undefined;
  /** The list's own per-row re-check (permissions to read the form's family, and its location). */
  keep: (rows: InstanceRow[]) => InstanceRow[];
  /** The status filter; all forms when absent. */
  status?: EmployeeSearchStatus;
  /** For tests. */
  read?: typeof listInstances;
  names?: (ids: string[]) => Promise<Map<string, string>>;
}

/** Every form on file this reader may open whose employee is the person typed, newest first. */
export async function searchFormsByEmployee(
  actor: FormsActor,
  rawQuery: string,
  options: EmployeeFormSearchOptions,
): Promise<EmployeeFormSearch> {
  const query = rawQuery.trim().slice(0, 120);
  const words = employeeSearchWords(query);
  if (words.length === 0) return { query, words, results: [], capped: false };

  const read = options.read ?? listInstances;
  const rows = await read(EMPLOYEE_SEARCH_LIMIT, { ...(options.filter ?? {}), employeeNameWords: words });
  const capped = rows.length >= EMPLOYEE_SEARCH_LIMIT;
  const found = options
    .keep(rows)
    .filter((row) => nameHasEveryWord(row.employeeName, words))
    .sort(newestFirst);

  const names = await (options.names ?? creatorNames)([...new Set(found.map((row) => row.createdBy))]);
  const results: EmployeeFormResult[] = found.map((row) => ({
      id: row.id,
      employeeName: row.employeeName,
      formName: row.templateShortName || row.templateName,
      variantKey: row.variantKey,
      status: row.status,
      hrNote: row.hrApprovalState && mayReadHrDecision(actor, row) ? HR_NOTE[row.hrApprovalState] : null,
      formDate: row.formDate,
      createdAt: row.createdAt,
      locationName: row.locationName,
      createdByName: row.createdBy === actor.id ? "You" : (names.get(row.createdBy) ?? "A manager"),
  }));
  const status = options.status ?? "all";
  return { query, words, capped, results: results.filter((result) => statusMatches(result, status)) };
}
