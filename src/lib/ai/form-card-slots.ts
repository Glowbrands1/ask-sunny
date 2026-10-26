import "server-only";

import { PRODUCTION_SALONS } from "@/data/salons";
import { datesInText, listIncidentDates, priorSteps } from "@/lib/forms/form-date-answer";
import {
  managerWordsOnlyEnabled,
  formChoiceStatedEnabled,
  payrollAmountFieldEnabled,
  remapIncidentFixEnabled,
  typedNameProceedsEnabled,
  warningLevelManagerOnlyEnabled,
  followUpNotPriorEnabled,
} from "@/lib/config/chat-quality-flags";
import { templateHasWarningLevel } from "@/lib/forms/warning-level";
import { matchEmployeeName, rosterNameNamedIn } from "@/lib/forms/employee-match";
import { inlineCloseMatch } from "@/lib/forms/typed-name-proceeds";
import { supportsInlineDraft } from "@/lib/forms/inline-draft";
import { isFieldLabelWord, nameAfterNameLabel, NOT_A_TYPED_NAME, stripFieldLabels } from "@/lib/forms/name-words";
import { describedManualSection } from "@/lib/forms/named-policy-section";
import {
  findManualSection,
  headingKey,
  withoutAttendanceForLateOpening,
  type ManualChunk,
  type ManualSection,
} from "@/lib/forms/official-policy-manual";
import {
  payrollAmountFromConversation,
  payrollAnswerForAmount,
  payrollDeductAmount,
  statedPayrollDeduct,
} from "@/lib/forms/payroll-deduct";
import { extractJobTitle, titleAfterJobTitleLabel } from "@/lib/forms/proposal";
import { readSalonMentions } from "@/lib/forms/salon-mention";
import type { ChatFormProposal, KnowledgeCategory, SourceCitation } from "@/types";

import { describedAttendanceKeys, readCaPolicy, statedOffenseKeys, withoutSetAsideSections } from "@/lib/forms/ca-policy";
import {
  citeAttendanceForTardiness,
  formatPolicyCitation,
  sectionsWithNameAndPage,
  withoutTardinessBoxLabel,
} from "@/lib/forms/required-policy-citation";

import { accountManualSections } from "./account-manual-sections";
import { appSentencesOnePerLine } from "./app-sentences";
import { titleTextFromQuestion } from "./title-words";
import type { ConversationFormState } from "./form-state";
import type { GroundedPerson } from "./grounded-entities";
import { formatManualCitation } from "./policy-citation-fields";
import { remapCitations, remapManualSections, withoutStateCodes } from "./remap-incident";
import type { AskResponse } from "./types";

/**
 * Slots the manager already stated, put on the proposal the form path built.
 *
 * A missing employee used to replace the whole answer with "who is this for?",
 * and a missing salon replaced it with "which salon?". The date, the title,
 * the payroll amount and the policy were already in the message. They stay
 * on the card. A close Woven spelling stays typed, with a short note under
 * the card. A name nobody in Woven is close to gets no note.
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
  /** Manager turns, so a name given earlier is still the person on the card. */
  readonly said?: string;
  readonly today: string;
  readonly people: readonly GroundedPerson[];
  readonly saved: ConversationFormState | null;
  /**
   * Callers still pass this. The note under the card stays on later turns;
   * it is not a question, so it is not suppressed.
   */
  readonly wovenNoteShown?: boolean;
}): AskResponse {
  const proposal = input.response.formProposal;
  if (!proposal) return input.response;

  const blob = [input.question, input.saved?.incident ?? ""].filter(Boolean).join("\n");
  const said = input.said?.trim() ? input.said : blob;
  const proposed = proposal.employeeName ? stripFieldLabels(proposal.employeeName) : null;
  const savedName = input.saved?.employeeName ? stripFieldLabels(input.saved.employeeName) : null;
  const statedName = statedEmployee(said) ?? savedName;
  const employeeName = preferRosterName(proposed ?? statedName, said, input.people);
  // REMAP_INCIDENT_FIX_ENABLED: "empire, sd" is a place and its state, not Salon Director.
  const fixed = remapIncidentFixEnabled();
  const titleBlob = fixed ? withoutStateCodes(blob) : blob;
  let title = statedTitle(titleBlob, input.saved?.title ?? null) ?? proposal.employeeRole;
  if (fixed && title && extractJobTitle(blob) === title && !extractJobTitle(titleBlob)) title = null;
  const spoken = withoutStateSentences(input.question);
  const groundedOn = incidentMarkedIn(input.question, input.today);
  const spokenIncidents = listIncidentDates(spoken, input.today);
  const formDate =
    groundedOn && spokenIncidents.length === 0
      ? groundedOn
      : proposal.formDate ?? statedDate(blob, input.question, input.today) ?? input.saved?.formDate ?? null;
  const askedHere = salonIdsIn(spoken);
  const namedSalon = salonIdsIn(blob);
  const locationId =
    (askedHere.length === 1 ? askedHere[0]! : null) ??
    proposal.locationId ??
    (namedSalon.length === 1 ? namedSalon[0]! : null) ??
    input.saved?.salonId ??
    (namedSalon.length === 0 && askedHere.length === 0 ? primarySalon(employeeName, input.people) : null);
  const amount = cardPayrollAmount(input, blob);
  const payrollDeduct = proposal.payrollDeduct ?? (amount || input.saved?.payrollDeduct === "yes" ? "yes" : input.saved?.payrollDeduct ?? null);
  // WARNING_LEVEL_MANAGER_ONLY_ENABLED: only a form with a Type of Warning carries a level.
  const warningLevel =
    warningLevelManagerOnlyEnabled() && !templateHasWarningLevel({ key: proposal.templateKey, name: proposal.templateName })
      ? null
      : proposal.warningLevel ?? input.saved?.warningLevel ?? null;

  let next: ChatFormProposal = {
    ...proposal,
    employeeName,
    employeeRole: title,
    formDate,
    payrollDeduct,
    warningLevel,
    ...(payrollAmountFieldEnabled() ? { payrollDeductAmount: amount } : {}),
  };
  if (locationId && next.locationId !== locationId) next = settleLocation(next, locationId);
  else if (next.employeeName && next.locationId && next.status !== "ready") next = settleLocation(next, next.locationId);

  const followUps = followUpDates(blob, input.today, next.formDate ?? null);
  const policy = statedPolicy(blob, input.saved);
  let content = withoutBlocking(input.response.content, next);
  // The salon question used to be the whole reply. Once the salon is known,
  // that line goes and the policy line that was under it stays.
  if (!content.trim() && (next.employeeName || next.locationId)) content = leadFor(next);
  const lines = fieldLines({ proposal: next, followUps, policy, amount, statedTitle: title });
  for (const line of lines) {
    if (!alreadySaid(content, line)) content = content ? `${content}\n\n${line}` : line;
  }
  if (typedNameProceedsEnabled() && input.people.length > 0) {
    const note = closeMatchNote(next.employeeName, input.people);
    if ((next.wovenCloseMatch ?? null) !== note) next = { ...next, wovenCloseMatch: note };
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
  const sections = withoutSetAsideSections(
    violatedSections(sectionsFor(input.notes, input.chunks, input.modelHeading ?? null)),
    input.notes,
  );
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
      excerpt: `${section.heading}. ${chunk?.content ?? ""}`.slice(0, 500),
      relevance: 1,
    });
  }
  return citations;
}

/** Citations plus the policy line, for a form answer. Existing citations stay. */
export function attachFormTurnSources(given: {
  readonly content: string;
  readonly citations: readonly SourceCitation[];
  readonly notes: string;
  readonly chunks: readonly ManualChunk[];
  readonly documentId: string;
  readonly documentTitle: string;
  readonly documentCategory?: string | null;
  readonly modelHeading?: string | null;
  readonly attendanceCitation?: boolean;
  readonly pageRequired?: boolean;
}): { content: string; citations: SourceCitation[] } {
  const input = formChoiceStatedEnabled() ? { ...given, modelHeading: headingForCard(given) } : given;
  const found = formTurnCitations(input);
  let citations = lateOpeningCitations(input.citations.length > 0 ? [...input.citations] : found, input.notes);
  let content = input.content;
  let sections = violatedSections(
    sectionsFor(input.notes, input.chunks, input.modelHeading ?? statedManualHeading(input.notes)),
  );
  sections = citeAttendanceForTardiness({
    enabled: input.attendanceCitation === true,
    notes: input.notes,
    chunks: input.chunks,
    sections,
  });
  if (input.pageRequired) {
    const reading = readCaPolicy(input.notes);
    const keys =
      statedOffenseKeys(reading, input.notes) ?? describedAttendanceKeys(input.notes) ?? [];
    for (const section of sectionsWithNameAndPage({
      enabled: true,
      notes: input.notes,
      chunks: input.chunks,
      offenseKeys: keys,
    })) {
      if (!sections.some((seen) => headingKey(seen.heading) === headingKey(section.heading))) sections.push(section);
    }
  }
  // REMAP_INCIDENT_FIX_ENABLED: the Standards of Conduct the account points
  // at ("missing the 10-15-26 woven deadline") is cited with its page, as the
  // remap path cites it (Ask Bubbles prod, 24 Oct 2026).
  if (sections.length === 0 && remapIncidentFixEnabled()) {
    sections = remapManualSections({ said: input.notes, chunks: input.chunks, incident: null, modelHeading: null });
    if (citations.length === 0) citations = lateOpeningCitations(remapCitations(input, sections), input.notes);
  }
  // LATE_OPEN_DATE_ENABLED: a late opening cites Late Opening, never Attendance,
  // whichever reader found the sections.
  sections = withoutAttendanceForLateOpening(sections, input.notes);
  // POLICY_SET_ASIDE_ENABLED: a policy the manager set aside is not cited, whichever reader found it.
  sections = withoutSetAsideSections(sections, input.notes);
  const mustCitePage = input.pageRequired === true || input.attendanceCitation === true;
  for (const section of sections) {
    const line =
      section.page > 0 ? formatPolicyCitation(section.heading, section.page) : formatManualCitation(section.heading, null);
    const hasHeading = content.toLowerCase().includes(section.heading.toLowerCase());
    const pageMissing =
      section.page > 0 && !new RegExp(String.raw`(?:\bp\.?\s*|page\s+)${section.page}\b`, "i").test(content);
    if (hasHeading && !(mustCitePage && pageMissing)) continue;
    content = content ? `${content}\n\n${line}` : line;
  }
  content = withoutTardinessBoxLabel(
    content,
    input.attendanceCitation === true && sections.some((section) => /^attendance$/i.test(section.heading)),
  );
  return { content, citations };
}

/**
 * A late opening's Sources are Late Opening alone (LATE_OPEN_DATE_ENABLED).
 * A citation's excerpt starts with its heading. See
 * `withoutAttendanceForLateOpening`.
 */
function lateOpeningCitations(citations: SourceCitation[], notes: string): SourceCitation[] {
  const headed = citations.map((citation) => ({ citation, heading: citation.excerpt.split(".")[0]?.trim() ?? "" }));
  const kept = withoutAttendanceForLateOpening(headed, notes);
  return kept.length === headed.length ? citations : kept.map((entry) => entry.citation);
}

/** "Disciplinary Action" is the manual's discipline procedure, not a policy an offense breaks. */
function isDisciplineProcedure(heading: string): boolean {
  return /^disciplinary actions?(?: policy)?$/.test(headingKey(heading));
}

/**
 * FORM_CHOICE_STATED_ENABLED. The card cites the policy the reply names.
 * "Disciplinary Action" is the procedure, never the policy broken; with it
 * gone, the reply's own "**Policy:** this reads as **Standards of Conduct**"
 * is the source (QA, 24 Oct 2026: the reply said Standards of Conduct and the
 * only source was "Page 14 — Disciplinary Action").
 */
function headingForCard(input: { readonly content: string; readonly notes: string; readonly modelHeading?: string | null }): string | null {
  const stated = input.modelHeading ?? statedManualHeading(input.notes);
  return (stated && !isDisciplineProcedure(stated) ? stated : null) ?? policyNamedInReply(input.content);
}

/** FORM_CHOICE_STATED_ENABLED: the discipline procedure is never cited as the violated policy. */
function violatedSections(sections: ManualSection[]): ManualSection[] {
  if (!formChoiceStatedEnabled()) return sections;
  return sections.filter((section) => !isDisciplineProcedure(section.heading));
}

/**
 * The policy the reply's "**Policy:**" line names in bold: "this reads as
 * **Standards of Conduct**", "reads as the policy manual's **Cell
 * Phone/Smart Watch Policy** (page 19)". Null when that line names none.
 */
export function policyNamedInReply(content: string): string | null {
  const line = content.split("\n").find((item) => item.trim().startsWith("**Policy:**"));
  if (!line) return null;
  const bold = [...line.slice(line.indexOf("**Policy:**") + "**Policy:**".length).matchAll(/\*\*([^*]+)\*\*/g)];
  const heading = bold[0]?.[1]?.replace(/\s+policy$/i, "").trim() ?? "";
  return heading && !isDisciplineProcedure(heading) ? heading : null;
}

export function statedManualHeading(notes: string): string | null {
  const match = /Policy reference:\s*([^,\n]+?)(?:,|\s+JBA Policy Manual|\.|$)/i.exec(notes);
  const heading = match?.[1]?.replace(/\s+policy$/i, "").trim() ?? "";
  return heading || null;
}

function sectionsFor(notes: string, chunks: readonly ManualChunk[], modelHeading: string | null) {
  const described = describedInLatestLines(notes, chunks);
  const fromAccount = accountManualSections(notes, chunks).filter(
    (section) => !headingIsOnlyTheJobTitle(section.heading, notes),
  );
  if (described) {
    const key = described.heading.toLowerCase();
    return citedPolicies([described, ...fromAccount.filter((section) => section.heading.toLowerCase() !== key)]);
  }
  if (fromAccount.length > 0) return citedPolicies(fromAccount);
  const heading = modelHeading ?? statedManualHeading(notes);
  if (!heading) return [];
  const section = findManualSection(chunks, [heading]);
  return section ? citedPolicies([section]) : [];
}

/** A sheet the manual does not title as a policy — the retirement "Warning" — is not cited. */
function citedPolicies(sections: readonly ManualSection[]): ManualSection[] {
  return sections.filter((section) => headingKey(section.heading) !== "warning");
}

/**
 * The newest line that describes a policy, walking past a later turn that
 * only names the salon or says "create the form". The whole account is not
 * one description: an earlier "dress code" keeps the cell-phone line from
 * being read, and "tanning consultant" is then the only heading left.
 */
function describedInLatestLines(notes: string, chunks: readonly ManualChunk[]): ManualSection | null {
  const lines = notes.split("\n").map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!;
    if (/^(?:The form is the |The employee is |Job title:|It happened at |It happened on |Warning level:|Payroll |No payroll|Policy reference:|Incident:)/.test(line)) {
      continue;
    }
    const described = describedManualSection({ text: line, chunks });
    if (described) return described.section;
  }
  return null;
}

/** "Tanning" inside "tanning consultant" is the job title, not the Tanning section. */
function headingIsOnlyTheJobTitle(heading: string, notes: string): boolean {
  const word = heading.trim().toLowerCase();
  if (!word || /\s/.test(word)) return false;
  const title = extractJobTitle(notes);
  if (!title) return false;
  const titleWords = title.toLowerCase().split(/\s+/);
  if (!titleWords.includes(word)) return false;
  const remaining = notes.toLowerCase().split(title.toLowerCase()).join(" ");
  return !new RegExp(`\\b${word}\\b`, "i").test(remaining);
}

function categoryOf(value: string | null | undefined): KnowledgeCategory {
  if (value && CATEGORIES.has(value as KnowledgeCategory)) return value as KnowledgeCategory;
  return "policies_compliance";
}

/**
 * The person the manager named in full, when the card is holding a fragment
 * ("nadia", "lawrence") or nobody. An exact directory spelling stays. A name
 * the roster does not have stays as typed when the manager named nobody else.
 */
function preferRosterName(name: string | null, text: string, people: readonly GroundedPerson[]): string | null {
  if (people.length === 0) return name;
  const named = rosterNameNamedIn(text, people);
  if (!name) return named;
  const match = matchEmployeeName(name, people);
  if (match.kind === "exact") return match.name;
  if (named && (match.kind === "none" || match.kind === "confirm")) return named;
  return name;
}

function statedEmployee(text: string): string | null {
  const labelled = nameAfterNameLabel(text);
  if (labelled) return labelled;
  const marked = /The employee is ([^.\n]+)\./i.exec(text)?.[1]?.trim();
  if (marked && !isDocumentish(marked)) {
    const cleaned = stripFieldLabels(marked);
    if (cleaned) return cleaned;
  }
  const around = nameAroundTitle(text);
  return around ? stripFieldLabels(around) : null;
}

function statedTitle(said: string, saved: string | null): string | null {
  const text = managerWordsOnlyEnabled() ? titleTextFromQuestion(said) : said;
  const labelled = managerWordsOnlyEnabled() ? labelledTitleByLine(text) : titleAfterJobTitleLabel(text);
  if (labelled) return extractJobTitle(labelled) ?? labelled;
  const marked = /Job title:\s*([^.\n]+)\./i.exec(text)?.[1]?.trim();
  if (marked && !isFieldLabelWord(marked)) return marked;
  if (saved && text.toLowerCase().includes(saved.toLowerCase())) return saved;
  return extractJobTitle(text);
}

/**
 * The label reader takes up to six words after "job title", across sentence
 * ends. The app's "Job title: CA." is followed on the same line by "It
 * happened at KS Lawrence.", which is not part of the title, so each line is
 * read alone and each app sentence is put on a line of its own.
 */
function labelledTitleByLine(text: string): string | null {
  for (const line of appSentencesOnePerLine(text).split("\n")) {
    const title = titleAfterJobTitleLabel(line);
    if (title) return title;
  }
  return null;
}

function statedDate(text: string, question: string, today: string): string | null {
  const marked = /It happened on ([^.\n]+)\./i.exec(text)?.[1]?.trim();
  if (marked) {
    const known = datesInText(marked, today);
    if (known.length === 1) return known[0]!.iso;
  }
  const incidents = [...new Set(listIncidentDates(text, today).map((item) => item.iso))];
  if (incidents.length === 1) return incidents[0]!;
  return dateSaidAsToday(text, question, today);
}

/** The incident date already written as "It happened on …", or null. */
function incidentMarkedIn(text: string, today: string): string | null {
  const marked = /It happened on ([^.\n]+)\./i.exec(text)?.[1]?.trim();
  if (!marked) return null;
  const known = datesInText(marked, today);
  return known.length === 1 ? known[0]!.iso : null;
}

/**
 * "today" is the form's date when the other dates are earlier steps. A prior
 * step's date, and any date listed after it in that same account, is history.
 */
function dateSaidAsToday(text: string, question: string, today: string): string | null {
  if (!/\btodays?\b/i.test(question)) return null;
  const steps = priorSteps(text, today);
  if (steps.length === 0) {
    if (listIncidentDates(text, today).length === 0 && datesInText(question, today).length === 0) return today;
    return null;
  }
  const foundAt = steps
    .map((step) => text.toLowerCase().indexOf(step.named.toLowerCase()))
    .filter((index) => index >= 0);
  if (foundAt.length === 0) return null;
  const first = Math.min(...foundAt);
  const later = new Set(datesInText(text, today).filter((found) => found.index > first).map((found) => found.iso));
  const prior = new Set(steps.map((step) => step.iso));
  const live = listIncidentDates(text, today).filter((found) => !prior.has(found.iso) && !later.has(found.iso));
  return live.length === 0 ? today : null;
}

function withoutStateSentences(question: string): string {
  return question
    .replace(/\bThe form is the [^.\n]+\./gi, " ")
    .replace(/\bThe employee is [^.\n]+\./gi, " ")
    .replace(/\bJob title: [^.\n]+\./gi, " ")
    .replace(/\bIt happened at [^.\n]+\./gi, " ")
    .replace(/\bIt happened on [^.\n]+\./gi, " ")
    .replace(/\bWarning level: [^.\n]+\./gi, " ")
    .replace(/\bPayroll deduct applies\./gi, " ")
    .replace(/\bNo payroll deduction\./gi, " ")
    .replace(/\bPolicy reference: [^.\n]+\./gi, " ")
    .replace(/\bIncident: [^.\n]+\./gi, " ")
    .replace(/\bPayroll amount: [^.\n]+\./gi, " ");
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
  // FOLLOW_UP_NOT_PRIOR_ENABLED: an earlier step's date ("a verbal on 06/25/2026") is a prior action, not a follow-up.
  if (followUpNotPriorEnabled()) for (const step of priorSteps(text, today)) incidents.add(step.iso);
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
      const titled = extractJobTitle(window);
      if (!titled) continue;
      const shorter = len > 1 ? tokens.slice(start, start + len - 1).join(" ") : "";
      if (shorter && extractJobTitle(shorter)) continue;
      // "for Jane Store tanning consultant" contains the title. The name is
      // the words next to the title, so a longer window with the same title
      // is not a second reading.
      const withoutFirst = len > 1 ? tokens.slice(start + 1, start + len).join(" ") : "";
      if (withoutFirst && extractJobTitle(withoutFirst) === titled) continue;
      const after = takeName(tokens.slice(start + len));
      if (after.length >= 2) return after.join(" ");
      const before = takeName([...tokens.slice(0, start)].reverse()).reverse();
      if (before.length >= 2) return before.join(" ");
    }
  }
  return null;
}

/**
 * Up to two words of a name. A stop word ends the scan, so the words after
 * "at" are not a second person. A leading "Job title" is skipped when a
 * full name follows it. Store or Salon as one of the two words is the surname.
 */
function takeName(tokens: readonly string[]): string[] {
  const gathered: string[] = [];
  for (const word of tokens) {
    if (!/^[A-Za-z][A-Za-z'’-]+$/.test(word) || word.length < 2) {
      if (gathered.length > 0) break;
      continue;
    }
    if (NOT_A_TYPED_NAME.has(word.toLowerCase())) break;
    gathered.push(word);
    if (gathered.length >= 6) break;
  }
  let start = 0;
  while (start < gathered.length && isFieldLabelWord(gathered[start]!)) start += 1;
  const rest = gathered.slice(start);
  if (rest.length >= 2) return rest.slice(0, 2);
  if (gathered.length >= 2 && gathered.some((word) => !isFieldLabelWord(word))) return gathered.slice(0, 2);
  return [];
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

function leadFor(proposal: ChatFormProposal): string {
  const who = proposal.employeeName ? ` for **${proposal.employeeName}**` : "";
  return `Here is what I would put on a **${proposal.templateName}**${who}.`;
}

/**
 * The figure on the card. With the amount field on, only a manager-stated
 * figure or one already stored for this conversation. A policy $25 is neither.
 */
function cardPayrollAmount(
  input: {
    readonly question: string;
    readonly said?: string;
    readonly saved: ConversationFormState | null;
    readonly response: AskResponse;
  },
  blob: string,
): string | null {
  if (!payrollAmountFieldEnabled()) {
    return payrollDeductAmount(blob) ?? (input.saved?.payrollAmount ? `$${input.saved.payrollAmount}` : null);
  }
  const proposal = input.response.formProposal;
  const said = [input.said, input.question].filter((line) => line && line.trim()).join("\n");
  const answer =
    proposal?.payrollDeduct ??
    input.saved?.payrollDeduct ??
    payrollAnswerForAmount(said || blob) ??
    statedPayrollDeduct(blob);
  return (
    payrollAmountFromConversation([{ role: "user", content: said || blob }], { payrollAnswer: answer }) ??
    input.saved?.payrollDeductAmount ??
    proposal?.payrollDeductAmount ??
    null
  );
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
  if (input.policy) lines.push(formatManualCitation(input.policy.heading, input.policy.page));
  return lines;
}

/** The under-card note, or null when nobody in Woven is close. */
function closeMatchNote(name: string | null, people: readonly GroundedPerson[]): string | null {
  if (!name || people.length === 0) return null;
  const match = matchEmployeeName(name, people);
  if (match.kind !== "confirm") return null;
  const names = match.candidates
    .map((candidate) => candidate.name)
    .filter((candidate) => candidate.toLowerCase() !== name.toLowerCase());
  if (names.length === 0) return null;
  return inlineCloseMatch(name, names) || null;
}

function rosterOnce(content: string, name: string | null, people: readonly GroundedPerson[]): string {
  if (typedNameProceedsEnabled()) return content;
  if (!name || people.length === 0) return content;
  if (/couldn'?t find|didn'?t find|not in the woven roster/i.test(content)) return content;
  const match = matchEmployeeName(name, people);
  if (match.kind !== "confirm" || match.candidates.length !== 1) return content;
  if (match.candidates[0]!.name.toLowerCase() === name.toLowerCase()) return content;
  const suggestion = `Did you mean **${match.candidates[0]!.name}**? I'll keep **${name}** on the form unless you say otherwise.`;
  if (!content.includes("Did you mean")) return `${suggestion}\n\n${content}`;
  return content;
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
