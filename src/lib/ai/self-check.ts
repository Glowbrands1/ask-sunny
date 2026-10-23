import { z } from "zod";

import { actionPlanSentenceCount, collapseToTwoSentences } from "@/lib/forms/action-plan-sentences";
import { displayName, matchEmployeeName, type RosterEmployee } from "@/lib/forms/employee-match";
import { headingKey, type ManualChunk } from "@/lib/forms/official-policy-manual";

/**
 * A last look before a form or an answer is sent.
 *
 * A cited policy and page have to be on the JBA chunks this turn retrieved.
 * An action plan is two sentences. An employee on a form has to be on the
 * Woven roster. One repair may fix a failure. What is still wrong is removed
 * rather than sent.
 */

const CITATION = /([A-Za-z][^,\n]{1,80}?)\s*,\s*JBA Policy Manual p\.(\d+)/g;
const PLAN_START = /Management will review\b/;

export interface OutgoingDraft {
  readonly content: string;
  readonly employeeName: string | null;
  readonly actionPlan: string | null;
  readonly chunks: readonly ManualChunk[];
  /** Null when the directory could not be read. An empty list was read and is empty. */
  readonly roster: readonly RosterEmployee[] | null;
}

export interface RepairDraft {
  readonly content: string;
  readonly employeeName: string | null;
  readonly actionPlan: string | null;
}

export interface SelfCheckFailure {
  readonly kind: "citation" | "action_plan" | "employee";
  readonly detail: string;
}

export interface SettledDraft {
  readonly content: string;
  readonly employeeName: string | null;
  readonly actionPlan: string | null;
  readonly ok: boolean;
  readonly repaired: boolean;
}

const repairSchema = z.object({
  content: z.string(),
  employeeName: z.string().nullable().optional(),
  actionPlan: z.string().nullable().optional(),
});

export function parseRepair(raw: unknown): RepairDraft | null {
  const parsed = repairSchema.safeParse(raw);
  if (!parsed.success) return null;
  const content = parsed.data.content.trim();
  if (!content) return null;
  return {
    content,
    employeeName: parsed.data.employeeName?.trim() || null,
    actionPlan: parsed.data.actionPlan?.trim() || null,
  };
}

export function reviewOutgoing(draft: OutgoingDraft): SelfCheckFailure[] {
  const failures: SelfCheckFailure[] = [];
  const cited = citationsIn(`${draft.content}\n${draft.actionPlan ?? ""}`);
  for (const citation of cited) {
    if (!citationOnChunks(citation.heading, citation.page, draft.chunks)) {
      failures.push({
        kind: "citation",
        detail: `${citation.heading}, JBA Policy Manual p.${citation.page}`,
      });
    }
  }
  const plan = draft.actionPlan ?? actionPlanIn(draft.content);
  if (plan && actionPlanSentenceCount(plan) !== 2) {
    failures.push({ kind: "action_plan", detail: plan });
  }
  if (draft.employeeName && draft.roster && !employeeOnRoster(draft.employeeName, draft.roster)) {
    failures.push({ kind: "employee", detail: draft.employeeName });
  }
  return failures;
}

export async function runSelfCheck(
  draft: OutgoingDraft,
  repair: () => Promise<unknown>,
): Promise<SettledDraft> {
  const failures = reviewOutgoing(draft);
  if (failures.length === 0) {
    return { content: draft.content, employeeName: draft.employeeName, actionPlan: draft.actionPlan, ok: true, repaired: false };
  }
  let repaired: RepairDraft | null = null;
  try {
    repaired = parseRepair(await repair());
  } catch {
    repaired = null;
  }
  if (repaired) {
    const next: OutgoingDraft = {
      ...draft,
      content: repaired.content,
      employeeName: repaired.employeeName,
      actionPlan: repaired.actionPlan,
    };
    if (reviewOutgoing(next).length === 0) {
      return { ...repaired, ok: true, repaired: true };
    }
    return { ...fallback(next, reviewOutgoing(next)), repaired: true };
  }
  return { ...fallback(draft, failures), repaired: true };
}

export function actionPlanIn(content: string): string | null {
  const start = content.search(PLAN_START);
  if (start < 0) return null;
  const block = content.slice(start).split(/\n\s*\n/)[0]?.trim() ?? "";
  return block || null;
}

function fallback(draft: OutgoingDraft, failures: readonly SelfCheckFailure[]): Omit<SettledDraft, "repaired"> {
  let content = draft.content;
  let actionPlan = draft.actionPlan;
  let employeeName = draft.employeeName;
  if (failures.some((failure) => failure.kind === "citation")) {
    content = content
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => {
        const cited = citationsIn(sentence);
        return cited.every((citation) => citationOnChunks(citation.heading, citation.page, draft.chunks));
      })
      .join(" ")
      .trim();
  }
  if (failures.some((failure) => failure.kind === "action_plan")) {
    const plan = actionPlan ?? actionPlanIn(content);
    const collapsed = plan ? collapseToTwoSentences(plan) : "";
    if (collapsed && actionPlanSentenceCount(collapsed) === 2) {
      content = plan && content.includes(plan) ? content.replace(plan, collapsed) : content;
      actionPlan = collapsed;
    } else if (plan && content.includes(plan)) {
      content = content.replace(plan, "").replace(/\n{3,}/g, "\n\n").trim();
      actionPlan = null;
    }
  }
  if (failures.some((failure) => failure.kind === "employee")) {
    employeeName = null;
    if (!content.includes("not in the Woven roster")) {
      content = `I couldn't confirm that employee. The name is not in the Woven roster, so it is not on the form.\n\n${content}`.trim();
    }
  }
  return { content, employeeName, actionPlan, ok: false };
}

function citationsIn(text: string): { heading: string; page: number }[] {
  CITATION.lastIndex = 0;
  const found: { heading: string; page: number }[] = [];
  for (const match of text.matchAll(CITATION)) {
    const heading = match[1]?.trim();
    const page = Number(match[2]);
    if (heading && page > 0) found.push({ heading, page });
  }
  return found;
}

function citationOnChunks(heading: string, page: number, chunks: readonly ManualChunk[]): boolean {
  const wanted = headingKey(heading.replace(/\s+policy$/i, ""));
  if (!wanted) return false;
  const hits = headingHits(wanted, chunks);
  if (hits.length === 0) return false;
  const longest = Math.max(...hits.map((hit) => hit.key.length));
  const best = hits.filter((hit) => hit.key.length === longest);
  const listed = best.filter((hit) => hit.listed);
  const pool = listed.length > 0 ? listed : best;
  return pool.some((hit) => hit.page === page);
}

/**
 * A citation may name the heading after other words. The longest retrieved
 * heading that the citation ends with is the one that was cited, and a page
 * printed on a `sections` entry wins over the chunk's sheet page.
 */
function headingHits(
  wanted: string,
  chunks: readonly ManualChunk[],
): { key: string; page: number; listed: boolean }[] {
  const hits: { key: string; page: number; listed: boolean }[] = [];
  for (const chunk of chunks) {
    for (const section of chunk.sections ?? []) {
      const key = headingKey(section.heading);
      if (key && headingFits(wanted, key)) hits.push({ key, page: section.page, listed: true });
    }
    if (!chunk.section) continue;
    const key = headingKey(chunk.section);
    const printed = chunk.printedPage ?? chunk.page;
    if (key && printed != null && headingFits(wanted, key)) hits.push({ key, page: printed, listed: false });
  }
  return hits;
}

function headingFits(wanted: string, key: string): boolean {
  return wanted === key || wanted.endsWith(` ${key}`);
}

function employeeOnRoster(name: string, roster: readonly RosterEmployee[]): boolean {
  if (roster.length === 0) return false;
  const match = matchEmployeeName(name, roster);
  if (match.kind === "exact") return true;
  return roster.some((person) => displayName(person).toLowerCase() === name.trim().toLowerCase());
}
