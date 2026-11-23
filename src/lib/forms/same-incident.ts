import "server-only";

import type { FormsActor } from "@/lib/forms/access";
import { instanceListFilterFor, visibleInstances } from "@/lib/forms/instance-scope";
import { listInstances } from "@/lib/forms/instances";

/**
 * ============================================================================
 * THE SAME INCIDENT ALREADY ON FILE (Pau's review, 24 Nov 2026 PHT, via QA: an employee had two finalized Corrective
 * Actions for one no-show on 11/18 and a third draft, and the AI never said one already existed)
 * ============================================================================
 *
 * This person's forms of one kind dated one day, as find_past_forms reads forms on file (the forms this manager may open:
 * `visibleInstances`), drafts and finalized, never archived or revised, minus the ones given. The agent loop's
 * propose_form asks before a card is made (`same_incident_on_file`); Create, the last gate, holds a card the loop made
 * when its date was never checked (QA's live check of #1123: the copy's card had no date, so propose had nothing to
 * compare). The person is matched by the caller (the loop by roster id, Create by the card's name). Form data; no words.
 */
export interface SameDayOnFile {
  readonly id: string;
  readonly form: string;
  readonly status: "draft" | "finalized";
  readonly formDate: string;
  readonly finalizedAt: string | null;
}

export async function formsOnFileSameDay(
  actor: FormsActor,
  input: { readonly nameWords: readonly string[]; readonly isPerson: (employeeName: string) => boolean; readonly templateKey: string; readonly formDate: string; readonly except?: readonly (string | null | undefined)[] },
): Promise<SameDayOnFile[]> {
  if (input.nameWords.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(input.formDate)) return [];
  const rows = await listInstances("all", 200, { ...instanceListFilterFor(actor), employeeNameWords: [...input.nameWords], formDateFrom: input.formDate, formDateTo: input.formDate }).catch(() => []);
  return visibleInstances(actor, rows)
    .filter((row) => row.templateKey === input.templateKey && row.formDate === input.formDate && !row.archivedAt && (row.status === "draft" || row.status === "finalized") && !(input.except ?? []).includes(row.id))
    .filter((row) => input.isPerson(row.employeeName ?? ""))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((row) => ({ id: row.id, form: row.templateName, status: row.status as "draft" | "finalized", formDate: row.formDate!, finalizedAt: row.finalizedAt ?? null }));
}

/** "<P> already has a Corrective Action for 11/18 (finalized 11/19). Do you want to open that one, or is this a separate incident?" */
export function sameDayOnFileQuestion(name: string, formName: string, onFile: readonly SameDayOnFile[]): string {
  const md = (iso: string | null) => {
    const found = /^\d{4}-(\d{2})-(\d{2})/.exec(iso ?? "");
    return found ? `${found[1]}/${found[2]}` : null;
  };
  const kind = formName.replace(/\s+Form$/i, "");
  const states = onFile.map((form) => (form.status === "finalized" ? (md(form.finalizedAt) ? `finalized ${md(form.finalizedAt)}` : "finalized") : "a draft"));
  const day = md(onFile[0]!.formDate);
  const which = onFile.length === 1 ? "that one" : "one of those";
  const has = onFile.length === 1 ? `a ${kind} for ${day} (${states[0]})` : `${onFile.length} ${kind}s for ${day} (${states.join("; ")})`;
  return `${name} already has ${has}. Do you want to open ${which}, or is this a separate incident?`;
}
