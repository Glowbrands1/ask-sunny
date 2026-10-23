import "server-only";

import { PRODUCTION_SALONS } from "@/data/salons";
import { datesInText, listIncidentDates } from "@/lib/forms/form-date-answer";
import { matchEmployeeName } from "@/lib/forms/employee-match";
import { supportsInlineDraft } from "@/lib/forms/inline-draft";
import { NOT_A_TYPED_NAME } from "@/lib/forms/name-words";
import { findManualSection, type ManualChunk } from "@/lib/forms/official-policy-manual";
import { payrollDeductAmount } from "@/lib/forms/payroll-deduct";
import { extractJobTitle } from "@/lib/forms/proposal";
import { readSalonMentions } from "@/lib/forms/salon-mention";
import type { ChatFormProposal, KnowledgeCategory, SourceCitation } from "@/types";

import { accountManualSections } from "./account-manual-sections";
import type { ConversationFormState } from "./form-state";
import type { GroundedPerson } from "./grounded-entities";
import { formatManualCitation } from "./policy-citation-fields";
import type { AskResponse } from "./types";

/**
 * Slots the manager already stated, put on the proposal the form path built.
 *
 * A missing employee used to replace the whole answer with "who is this for?",
 * and a missing salon replaced it with "which salon?". The date, the title,
 * the payroll amount and the policy were already in the message. They stay
 * on the card. A name Woven does not have stays too, with one sentence.
 */

const CATEGORIES = new Set<KnowledgeCategory>([
  "policies_compliance",
  "operations",
  "training",
  "leadership_coaching",
  "sales_client_experience",
  "reports_analytics",
  "bonuses_compensation",
  "safety",
  "equipment_procedures",
  "other",
]);

export function enrichFormCard(input: {
  readonly response: AskResponse;
  readonly question: string;
  readonly today: string;
  readonly people: readonly GroundedPerson[];
  readonly saved: ConversationFormState | null;
}): AskResponse {
  const proposal = input.response.formProposal;
  if (!proposal) return input.response;

  const blob = [input.question, input.saved?.incident ?? ""].filter(Boolean).join("\n");
  const statedName = statedEmployee(blob) ?? input.saved?.employeeName ?? null;
  const employeeName = proposal.employeeName ?? statedName;
  const title = statedTitle(blob, input.saved?.title ?? null) ?? proposal.employeeRole;
  const formDate = proposal.formDate ?? statedDate(blob, input.question, input.today) ?? input.saved?.formDate ?? null;
  const namedSalon = salonIdsIn(blob);
  const locationId =
    proposal.locationId ??
    (namedSalon.length === 1 ? namedSalon[0]! : null) ??
    input.saved?.salonId ??
    (namedSalon.length === 0 ? primarySalon(employeeName, input.people) : null);
  const amount = payrollDeductAmount(blob) ?? (input.saved?.payrollAmount ? `$${input.saved.payrollAmount}` : null);
  const payrollDeduct = proposal.payrollDeduct ?? (amount || input.saved?.payrollDeduct === "yes" ? "yes" : input.saved?.payrollDeduct ?? null);
  const warningLevel = proposal.warningLevel ?? input.saved?.warningLevel ?? null;

  let next: ChatFormProposal = {
    ...proposal,
    employeeName,
    employeeRole: title,
    formDate,
    payrollDeduct,
    warningLevel,
  };
  if (locationId && !next.locationId) next = settleLocation(next, locationId);
  else if (next.employeeName && next.locationId && next.status !== "ready") next = settleLocation(next, next.locationId);

  const followUps = followUpDates(blob, input.today, next.formDate ?? null);
  const policy = statedPolicy(blob, input.saved);
  let content = withoutBlocking(input.response.content, next);
  if (blockingOnly(input.response.content) && (next.employeeName || next.locationId)) {
    content = leadFor(next);
  }
  const lines = fieldLines({ proposal: next, followUps, policy, amount, statedTitle: title });
  for (const line of lines) {
    if (!alreadySaid(content, line)) content = content ? `${content}\n\n${line}` : line;
  }
  content = rosterOnce(content, next.employeeName, input.people);

  return content === input.response.content && next === proposal
    ? input.response
    : { ...input.response, content, formProposal: next };
}

export function formTurnCitations(input: {
  readonly notes: string;
  readonly chunks: readonly ManualChunk[];
  readonly documentId: string;
  readonly documentTitle: string;
  readonly documentCategory?: string | null;
  readonly modelHeading?: string | null;
}): SourceCitation[] {
  const sections = sectionsFor(input.notes, input.chunks, input.modelHeading ?? null);
  const category = categoryOf(input.documentCategory);
  const citations: SourceCitation[] = [];
  for (const section of sections) {
    if (section.page <= 0) continue;
    const chunk = input.chunks.find((item) => item.chunkIndex === section.chunkIndex);
    citations.push({
      documentId: input.documentId,
      documentTitle: input.documentTitle,
      locator: `Page ${section.page}`,
      category,
      excerpt: (chunk?.content ?? section.heading).slice(0, 500),
      relevance: 1,
    });
  }
  return citations;
}

/** Citations plus the policy line, for a form answer. Existing citations stay. */
export function attachFormTurnSources(input: {
  readonly content: string;
  readonly citations: readonly SourceCitation[];
  readonly notes: string;
  readonly chunks: readonly ManualChunk[];
  readonly documentId: string;
  readonly documentTitle: string;
  readonly documentCategory?: string | null;
  readonly modelHeading?: string | null;
}): { content: string; citations: SourceCitation[] } {
  const found = formTurnCitations(input);
  const citations = input.citations.length > 0 ? [...input.citations] : found;
  let content = input.content;
  for (const section of sectionsFor(input.notes, input.chunks, input.modelHeading ?? statedManualHeading(input.notes))) {
    const line = `**Policy:** ${formatManualCitation(section.heading, section.page > 0 ? section.page : null)}`;
    if (!content.toLowerCase().includes(section.heading.toLowerCase())) content = content ? `${content}\n\n${line}` : line;
  }
  return { content, citations };
}

export function statedManualHeading(notes: string): string | null {
  const match = /Policy reference:\s*([^,\n]+?)(?:,|\s+JBA Policy Manual|\.|$)/i.exec(notes);
  const heading = match?.[1]?.replace(/\s+policy$/i, "").trim() ?? "";
  return heading || null;
}

function sectionsFor(notes: string, chunks: readonly ManualChunk[], modelHeading: string | null) {
  const fromAccount = accountManualSections(notes, chunks);
  if (fromAccount.length > 0) return fromAccount;
  const heading = modelHeading ?? statedManualHeading(notes);
  if (!heading) return [];
  const section = findManualSection(chunks, [heading]);
  return section ? [section] : [];
}

function categoryOf(value: string | null | undefined): KnowledgeCategory {
  if (value && CATEGORIES.has(value as KnowledgeCategory)) return value as KnowledgeCategory;
  return "policies_compliance";
}

function statedEmployee(text: string): string | null {
  const marked = /The employee is ([^.\n]+)\./i.exec(text)?.[1]?.trim();
  if (marked && !isDocumentish(marked)) return marked;
  return nameAroundTitle(text);
}

function statedTitle(text: string, saved: string | null): string | null {
  const marked = /Job title:\s*([^.\n]+)\./i.exec(text)?.[1]?.trim();
  if (marked) return marked;
  if (saved && text.toLowerCase().includes(saved.toLowerCase())) return saved;
  return extractJobTitle(text);
}

function statedDate(text: string, question: string, today: string): string | null {
  const marked = /It happened on ([^.\n]+)\./i.exec(text)?.[1]?.trim();
  if (marked) {
    const known = datesInText(marked, today);
    if (known.length === 1) return known[0]!.iso;
  }
  const incidents = [...new Set(listIncidentDates(text, today).map((item) => item.iso))];
  if (incidents.length === 1) return incidents[0]!;
  if (/\btoday\b/i.test(question) && datesInText(question, today).length === 0) return today;
  return null;
}

function statedPolicy(text: string, saved: ConversationFormState | null): { heading: string; page: number | null } | null {
  const fromLine = statedManualHeading(text);
  if (fromLine) {
    const page = /Policy reference:[^\n]*\bp\.(\d+)/i.exec(text)?.[1];
    return { heading: fromLine, page: page ? Number(page) : saved?.policyPage ?? null };
  }
  if (saved?.policyHeading) return { heading: saved.policyHeading, page: saved.policyPage };
  return null;
}

function followUpDates(text: string, today: string, incident: string | null): string[] {
  const incidents = new Set(listIncidentDates(text, today).map((item) => item.iso));
  if (incident) incidents.add(incident);
  return [...new Set(datesInText(text, today).map((item) => item.iso))].filter((iso) => !incidents.has(iso));
}

function salonIdsIn(text: string): string[] {
  const ids = [...new Set(readSalonMentions(text).flatMap((mention) => mention.salonIds))];
  if (ids.length > 0) return ids;
  const words = text.toLowerCase();
  const hits = PRODUCTION_SALONS.filter((salon) => {
    const name = salon.name.toLowerCase();
    return words.includes(name) || name.split(/\s+/).filter((word) => word.length >= 5).every((word) => words.includes(word));
  });
  return hits.length === 1 ? [hits[0]!.id] : [];
}

function primarySalon(name: string | null, people: readonly GroundedPerson[]): string | null {
  if (!name || people.length === 0) return null;
  const match = matchEmployeeName(name, people);
  if (match.kind !== "exact" && match.kind !== "confirm") return null;
  const row = match.kind === "exact" ? match.employee : match.candidates.length === 1 ? match.candidates[0]!.employee : null;
  if (!row) return null;
  const person = people.find((item) => item.id === row.id);
  return person?.primarySalonId ?? null;
}

function nameAroundTitle(text: string): string | null {
  const tokens = text
    .split(/\s+/)
    .map((word) => word.replace(/^[^A-Za-z]+|[^A-Za-z'’-]+$/g, ""))
    .filter(Boolean);
  for (let start = 0; start < tokens.length; start += 1) {
    for (let len = 1; len <= 5 && start + len <= tokens.length; len += 1) {
      const window = tokens.slice(start, start + len).join(" ");
      if (!extractJobTitle(window)) continue;
      const shorter = len > 1 ? tokens.slice(start, start + len - 1).join(" ") : "";
      if (shorter && extractJobTitle(shorter)) continue;
      const after = takeName(tokens.slice(start + len));
      if (after.length >= 2) return after.join(" ");
      const before = takeName([...tokens.slice(0, start)].reverse()).reverse();
      if (before.length >= 2) return before.join(" ");
    }
  }
  return null;
}

function takeName(tokens: readonly string[]): string[] {
  const words: string[] = [];
  for (const word of tokens) {
    if (words.length === 2) break;
    if (!/^[A-Za-z][A-Za-z'’-]+$/.test(word) || word.length < 2) break;
    if (NOT_A_TYPED_NAME.has(word.toLowerCase())) break;
    words.push(word);
  }
  return words;
}

function isDocumentish(name: string): boolean {
  return /\b(?:manual|policy|handbook|standards)\b/i.test(name);
}

function settleLocation(proposal: ChatFormProposal, locationId: string): ChatFormProposal {
  const status = proposal.employeeName ? "ready" : "needs_employee";
  const wasReady = proposal.status === "ready";
  let inline = proposal.supportsInlineDraft;
  if (!wasReady && status === "ready") {
    inline = supportsInlineDraft(
      proposal.templateKey,
      proposal.variantKey ? [{ key: proposal.variantKey, label: proposal.variantKey, role: "", roleAbbr: "" }] : [],
    );
  }
  return {
    ...proposal,
    locationId,
    locationResolution: "resolved",
    status,
    supportsInlineDraft: inline,
  };
}

function withoutBlocking(content: string, proposal: ChatFormProposal): string {
  const lines = content.split("\n").filter((line) => {
    if (proposal.locationId && /which salon is this about|won't choose which salon/i.test(line)) return false;
    if (proposal.employeeName && /who is this \*\*/i.test(line)) return false;
    if (/which warning level did you mean/i.test(line)) return false;
    if (/^I still need /.test(line.trim())) return false;
    return true;
  });
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function blockingOnly(content: string): boolean {
  const text = content.trim();
  return (
    /^Who is this \*\*/.test(text) ||
    /which salon is this about/i.test(text) ||
    /^Which warning level/.test(text) ||
    /^I still need /.test(text)
  );
}

function leadFor(proposal: ChatFormProposal): string {
  const who = proposal.employeeName ? ` for **${proposal.employeeName}**` : "";
  return `Here is what I would put on a **${proposal.templateName}**${who}.`;
}

function fieldLines(input: {
  proposal: ChatFormProposal;
  followUps: readonly string[];
  policy: { heading: string; page: number | null } | null;
  amount: string | null;
  statedTitle: string | null;
}): string[] {
  const lines: string[] = [];
  if (input.proposal.formDate) lines.push(`**Date:** ${slash(input.proposal.formDate)}`);
  for (const iso of input.followUps) lines.push(`**Follow-up:** ${slash(iso)}`);
  if (input.statedTitle) lines.push(`**Job title:** ${input.statedTitle}`);
  if (input.proposal.payrollDeduct === "yes") {
    lines.push(input.amount ? `**Payroll deduction:** Yes, ${input.amount.startsWith("$") ? input.amount : `$${input.amount}`}` : "**Payroll deduction:** Yes");
  }
  if (input.policy) lines.push(`**Policy:** ${formatManualCitation(input.policy.heading, input.policy.page)}`);
  return lines;
}

function rosterOnce(content: string, name: string | null, people: readonly GroundedPerson[]): string {
  if (!name || people.length === 0) return content;
  if (/couldn'?t find|didn'?t find|not in the woven roster/i.test(content)) return content;
  const match = matchEmployeeName(name, people);
  if (match.kind !== "none") {
    if (match.kind === "confirm" && match.candidates.length === 1 && match.candidates[0]!.name.toLowerCase() !== name.toLowerCase()) {
      const suggestion = `Did you mean **${match.candidates[0]!.name}**? I'll keep **${name}** on the form unless you say otherwise.`;
      if (!content.includes("Did you mean")) return `${suggestion}\n\n${content}`;
    }
    return content;
  }
  return `I couldn't find **${name}** in the Woven roster.\n\n${content}`;
}

function alreadySaid(content: string, line: string): boolean {
  const plain = line.replace(/\*\*/g, "").trim().toLowerCase();
  return content.replace(/\*\*/g, "").toLowerCase().includes(plain);
}

function slash(iso: string): string {
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${Number(month)}/${Number(day)}/${year}`;
}
