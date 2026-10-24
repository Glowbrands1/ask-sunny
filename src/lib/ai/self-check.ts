import { z } from "zod";

import { codeSlotsEnabled, printedPageCitationEnabled } from "@/lib/config/chat-quality-flags";
import { printedPageForPolicy } from "@/lib/forms/printed-policy-pages";
import { actionPlanSentenceCount, collapseToTwoSentences } from "@/lib/forms/action-plan-sentences";
import type { RosterEmployee } from "@/lib/forms/employee-match";
import { headingKey, type ManualChunk } from "@/lib/forms/official-policy-manual";

import { repairSpeaksAsValidator, scrubRosterBlock } from "./roster-reply";

/**
 * A last look before a form or an answer is sent.
 *
 * A cited page has to be the page on the retrieved chunk. A cited section
 * whose own text does not fit the question is dropped when the model says so
 * from that text. An action plan is two sentences. A name the manager typed
 * is not checked against Woven: a missing row is not a failure and the
 * repair model is not asked to refuse it. One repair may fix a citation or
 * an action plan. What is still wrong is removed rather than sent. The
 * repair model's own instructions never become the reply.
 */

const CITATION = /([A-Za-z][^,\n]{1,80}?)\s*,\s*JBA Policy Manual p\.(\d+)/g;
const PLAN_START = /Management will review\b/;
const PAYROLL_SENTENCE = /will be deducted from|a payroll deduction applies/i;

export interface OutgoingDraft {
  readonly content: string;
  readonly employeeName: string | null;
  readonly actionPlan: string | null;
  readonly chunks: readonly ManualChunk[];
  /** Null when the directory could not be read. An empty list was read and is empty. */
  readonly roster: readonly RosterEmployee[] | null;
  /** The manager's question, when a cited section should be judged against it. */
  readonly question?: string;
}

export interface CitedSectionText {
  readonly heading: string;
  readonly page: number | null;
  readonly text: string;
}

export interface ReviewBrief {
  readonly question: string;
  readonly sections: readonly CitedSectionText[];
  readonly failures: readonly SelfCheckFailure[];
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

const verdictSchema = z.object({
  heading: z.string(),
  applies: z.boolean(),
});

const reviewSchema = repairSchema.extend({
  sections: z.array(verdictSchema).optional(),
});

export interface SectionVerdict {
  readonly heading: string;
  readonly applies: boolean;
}

export function parseRepair(raw: unknown): RepairDraft | null {
  return parseReview(raw).repair;
}

export function parseReview(raw: unknown): { repair: RepairDraft | null; sections: SectionVerdict[] } {
  const parsed = reviewSchema.safeParse(raw);
  if (!parsed.success) return { repair: null, sections: [] };
  const sections = (parsed.data.sections ?? [])
    .map((section) => ({ heading: section.heading.trim(), applies: section.applies }))
    .filter((section) => section.heading.length > 0);
  const content = parsed.data.content.trim();
  if (!content) return { repair: null, sections };
  return {
    repair: {
      content,
      employeeName: parsed.data.employeeName?.trim() || null,
      actionPlan: parsed.data.actionPlan?.trim() || null,
    },
    sections,
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
  if (plan && !exactTwoSentencePlan(plan)) {
    failures.push({ kind: "action_plan", detail: plan });
  }
  // A name that is not on the Woven roster is not a failure. Refusing the
  // form, or sending the repair model's "I cannot repair this reply", took
  // the typed name off the card (live replay, 23 Oct 2026).
  return failures;
}

export async function runSelfCheck(
  draft: OutgoingDraft,
  repair: (brief: ReviewBrief) => Promise<unknown>,
): Promise<SettledDraft> {
  const failures = reviewOutgoing(draft);
  const cited = citedSections(`${draft.content}\n${draft.actionPlan ?? ""}`, draft.chunks);
  const ask = failures.length > 0 || (Boolean(draft.question?.trim()) && cited.some((section) => section.text.trim()));
  if (!ask) {
    return { content: draft.content, employeeName: draft.employeeName, actionPlan: draft.actionPlan, ok: true, repaired: false };
  }
  let reviewed = { repair: null as RepairDraft | null, sections: [] as SectionVerdict[] };
  try {
    reviewed = parseReview(await repair({ question: draft.question?.trim() ?? "", sections: cited, failures }));
  } catch {
    reviewed = { repair: null, sections: [] };
  }
  const usable = reviewed.repair && !repairSpeaksAsValidator(reviewed.repair.content) ? reviewed.repair : null;
  if (codeSlotsEnabled()) {
    // Repair prose is never the reply. A failed repair keeps the last good draft.
    if (!usable) {
      return keepGoodReply(draft, {
        content: draft.content,
        employeeName: draft.employeeName,
        actionPlan: draft.actionPlan,
        ok: false,
        repaired: false,
      });
    }
    const actionPlan = usable.actionPlan && exactTwoSentencePlan(usable.actionPlan) ? usable.actionPlan : draft.actionPlan;
    let content = draft.content;
    if (actionPlan && draft.actionPlan && content.includes(draft.actionPlan) && actionPlan !== draft.actionPlan) {
      content = content.replace(draft.actionPlan, actionPlan);
    }
    return keepGoodReply(draft, {
      content,
      employeeName: draft.employeeName,
      actionPlan,
      ok: reviewOutgoing({ ...draft, content, actionPlan }).length === 0,
      repaired: actionPlan !== draft.actionPlan,
    });
  }
  const next = applyReview(draft, usable, reviewed.sections);
  const remaining = reviewOutgoing({ ...draft, ...next });
  const settled =
    remaining.length === 0
      ? {
          ...next,
          ok: true as const,
          repaired:
            usable !== null &&
            (next.content !== draft.content || next.employeeName !== draft.employeeName || next.actionPlan !== draft.actionPlan),
        }
      : { ...fallback({ ...draft, ...next }, remaining), repaired: true };
  return keepGoodReply(draft, settled);
}

/**
 * The reply the manager already had. A repair that refuses the form, says
 * the person is missing from Woven, or scrubs down to nothing is not sent.
 */
function keepGoodReply(draft: OutgoingDraft, settled: SettledDraft): SettledDraft {
  const employeeName = settled.employeeName?.trim() || draft.employeeName;
  let content = scrubRosterBlock(settled.content);
  // A blank left by stripping a bad citation stays blank. A validator's
  // refusal is replaced with the reply we already had.
  if (repairSpeaksAsValidator(settled.content) || repairSpeaksAsValidator(content)) {
    const restored = scrubRosterBlock(draft.content);
    if (restored.trim() && !repairSpeaksAsValidator(restored)) content = restored;
    else if (draft.content.trim() && !repairSpeaksAsValidator(draft.content)) content = draft.content;
  }
  return { ...settled, content, employeeName };
}

/** The review sentence and one closing. A payroll sentence is not a plan. */
function exactTwoSentencePlan(plan: string): boolean {
  return actionPlanSentenceCount(plan) === 2 && !PAYROLL_SENTENCE.test(plan);
}

function withoutPayrollSentence(plan: string): string {
  return plan
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0 && !PAYROLL_SENTENCE.test(sentence))
    .join(" ");
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
  const employeeName = draft.employeeName;
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
    const collapsed = plan ? withoutPayrollSentence(collapseToTwoSentences(plan)) : "";
    if (collapsed && exactTwoSentencePlan(collapsed)) {
      content = plan && content.includes(plan) ? content.replace(plan, collapsed) : content;
      actionPlan = collapsed;
    } else if (plan && content.includes(plan)) {
      content = content.replace(plan, "").replace(/\n{3,}/g, "\n\n").trim();
      actionPlan = null;
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
  const expected = pageForHeading(heading, chunks);
  return expected !== null && expected === page;
}

/**
 * The page on the retrieved chunk.
 *
 * The number the chunk itself carries wins. A heading list inside the chunk
 * is used only when the chunk has no page of its own, so a list that still
 * says an older page cannot override the indexed chunk.
 */
export function pageForHeading(heading: string, chunks: readonly ManualChunk[]): number | null {
  const pages = new Set<number>();
  for (const chunk of chunksCarrying(heading, chunks)) {
    const indexed = indexedPage(chunk);
    if (indexed) pages.add(indexed);
    else {
      const listed = listedPage(heading, chunk);
      if (listed) pages.add(listed);
    }
  }
  if (pages.size !== 1) return null;
  return [...pages][0]!;
}

function applyReview(
  draft: OutgoingDraft,
  repair: RepairDraft | null,
  verdicts: readonly SectionVerdict[],
): { content: string; employeeName: string | null; actionPlan: string | null } {
  let content = repair?.content ?? draft.content;
  let actionPlan = repair ? repair.actionPlan : draft.actionPlan;
  // A repair may correct a spelling. It may not clear a name the manager typed.
  const employeeName = repair?.employeeName?.trim() ? repair.employeeName : draft.employeeName;
  for (const verdict of verdicts) {
    if (verdict.applies) continue;
    content = dropSection(content, verdict.heading, draft.chunks, verdicts);
    if (actionPlan) {
      const next = dropSection(actionPlan, verdict.heading, draft.chunks, verdicts);
      actionPlan = next.trim() ? next : null;
    }
  }
  content = alignCitationPages(content, draft.chunks);
  if (actionPlan) {
    const aligned = alignCitationPages(actionPlan, draft.chunks);
    actionPlan = aligned.trim() ? aligned : null;
  }
  if (!content.trim() && verdicts.some((verdict) => !verdict.applies)) {
    content = "I can't cite a manual section whose own text fits this situation.";
  }
  return { content, employeeName, actionPlan };
}

function citedSections(text: string, chunks: readonly ManualChunk[]): CitedSectionText[] {
  const found: CitedSectionText[] = [];
  const seen = new Set<string>();
  for (const citation of citationsIn(text)) {
    const label = labelFor(citation.heading, chunks);
    const key = headingKey(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    found.push({
      heading: label,
      page: pageForHeading(citation.heading, chunks),
      text: textForHeading(label, chunks),
    });
  }
  return found;
}

function dropSection(
  text: string,
  heading: string,
  chunks: readonly ManualChunk[],
  verdicts: readonly SectionVerdict[],
): string {
  const droppedAmounts = exclusiveAmounts(heading, chunks, verdicts);
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => {
      const cited = citationsIn(sentence);
      if (cited.some((citation) => sameHeading(citation.heading, heading))) return false;
      const citesKept = cited.some((citation) => !sameHeading(citation.heading, heading));
      if (!citesKept && droppedAmounts.some((amount) => sentenceHasAmount(sentence, amount))) return false;
      return true;
    })
    .join(" ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function alignCitationPages(text: string, chunks: readonly ManualChunk[]): string {
  return text.replace(new RegExp(CITATION.source, "g"), (full, heading: string, page: string) => {
    const expected = pageForHeading(heading, chunks);
    if (!expected || expected === Number(page)) return full;
    return full.replace(/p\.\d+$/, `p.${expected}`);
  });
}

function exclusiveAmounts(heading: string, chunks: readonly ManualChunk[], verdicts: readonly SectionVerdict[]): number[] {
  const dropped = moneyAmounts(textForHeading(heading, chunks));
  const kept = verdicts
    .filter((verdict) => verdict.applies && !sameHeading(verdict.heading, heading))
    .map((verdict) => textForHeading(verdict.heading, chunks))
    .join("\n");
  const keptAmounts = new Set(moneyAmounts(kept));
  return dropped.filter((amount) => !keptAmounts.has(amount));
}

function moneyAmounts(text: string): number[] {
  return [...text.matchAll(/\$\s*(\d+(?:\.\d+)?)/g)].flatMap((match) => {
    const amount = Number(match[1]);
    return Number.isFinite(amount) ? [amount] : [];
  });
}

function sentenceHasAmount(sentence: string, amount: number): boolean {
  return moneyAmounts(sentence).some((value) => value === amount);
}

function textForHeading(heading: string, chunks: readonly ManualChunk[]): string {
  return chunksCarrying(heading, chunks)
    .map((chunk) => chunk.content.trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 2000);
}

function labelFor(heading: string, chunks: readonly ManualChunk[]): string {
  const wanted = headingKey(heading.replace(/\s+policy$/i, ""));
  for (const chunk of chunksCarrying(heading, chunks)) {
    if (chunk.section && headingFits(wanted, headingKey(chunk.section))) return chunk.section.trim();
    const listed = (chunk.sections ?? []).find((section) => headingFits(wanted, headingKey(section.heading)));
    if (listed) return listed.heading.trim();
  }
  return heading.replace(/\s+policy$/i, "").trim();
}

function chunksCarrying(heading: string, chunks: readonly ManualChunk[]): ManualChunk[] {
  const wanted = headingKey(heading.replace(/\s+policy$/i, ""));
  if (!wanted) return [];
  return chunks.filter((chunk) => carries(chunk, wanted));
}

function carries(chunk: ManualChunk, wanted: string): boolean {
  if (chunk.section && headingFits(wanted, headingKey(chunk.section))) return true;
  return (chunk.sections ?? []).some((section) => headingFits(wanted, headingKey(section.heading)));
}

function indexedPage(chunk: ManualChunk): number | null {
  if (codeSlotsEnabled()) {
    const mapped = printedPageForPolicy(chunk.section);
    if (mapped) return mapped;
  }
  if (typeof chunk.printedPage === "number" && chunk.printedPage > 0) return chunk.printedPage;
  if (printedPageCitationEnabled()) return null;
  if (typeof chunk.page === "number" && chunk.page > 0) return chunk.page;
  return null;
}

function listedPage(heading: string, chunk: ManualChunk): number | null {
  const wanted = headingKey(heading.replace(/\s+policy$/i, ""));
  const listed = (chunk.sections ?? []).find((section) => headingFits(wanted, headingKey(section.heading)));
  return listed && listed.page > 0 ? listed.page : null;
}

function sameHeading(left: string, right: string): boolean {
  const a = headingKey(left.replace(/\s+policy$/i, ""));
  const b = headingKey(right.replace(/\s+policy$/i, ""));
  if (!a || !b) return false;
  return a === b || headingFits(a, b) || headingFits(b, a);
}

function headingFits(wanted: string, key: string): boolean {
  return wanted === key || wanted.endsWith(` ${key}`);
}

