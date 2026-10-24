import { readSalonMentions } from "@/lib/forms/salon-mention";
import { listIncidentDates } from "@/lib/forms/form-date-answer";
import { matchEmployeeName } from "@/lib/forms/employee-match";
import { extractEmployeeNames, extractJobTitle } from "@/lib/forms/proposal";
import { exitDateInWords, exitReady } from "@/lib/forms/exit-intake";
import { readExitDetails } from "@/lib/forms/exit-details";
import { readExitFacts } from "@/lib/forms/exit-facts";
import { statedPayrollDeduct } from "@/lib/forms/payroll-deduct";
import { warningLevelFromTurns } from "@/lib/forms/warning-level";
import { NOT_A_NAME, NOT_A_TYPED_NAME } from "@/lib/forms/name-words";
import type { ChatFormProposal, SourceCitation } from "@/types";

import type { GroundedPerson } from "./grounded-entities";
import { displayTypedName, scrubRosterBlock } from "./roster-reply";

/**
 * Slots the conversation already filled, put back on this turn's proposal.
 *
 * A later "Create a form" used to rebuild the card from the newest window
 * and drop the name, the title, the salon, the dates, and the payroll
 * answer. A value stays until the manager changes it. A name Woven does
 * not have is printed, capitalized, and is not an error.
 */

interface HistoryTurn {
  readonly role: string;
  readonly content: string;
  readonly formProposal?: ChatFormProposal | null;
}

export function holdFilledSlots(input: {
  readonly response: import("./types").AskResponse;
  readonly question: string;
  readonly history: readonly HistoryTurn[];
  readonly today: string;
  readonly people: readonly GroundedPerson[];
}): import("./types").AskResponse {
  const proposal = input.response.formProposal;
  if (!proposal) {
    const content = dropWarningLines(scrubRosterBlock(input.response.content));
    return content === input.response.content ? input.response : { ...input.response, content };
  }

  const turns = [
    ...input.history.filter((turn) => turn.role === "user").map((turn) => turn.content),
    input.question,
  ].filter((turn) => turn.trim());
  const previous = previousProposal(input.history, proposal.templateKey);
  const employeeName = keptName(proposal.employeeName, previous?.employeeName ?? null, turns, input.people);
  const employeeRole =
    extractJobTitle(input.question) ||
    proposal.employeeRole ||
    previous?.employeeRole ||
    extractJobTitle(turns.join("\n")) ||
    null;
  const locationId = keptSalon(turns, proposal.locationId, previous?.locationId ?? null, employeeName, input.people);
  const formDate = keptDate(input.question, input.today, proposal.formDate ?? null, previous?.formDate ?? null);
  const payrollDeduct = keptPayroll(
    turns,
    proposal.payrollDeduct ?? null,
    previous?.payrollDeduct ?? null,
    input.response.content,
  );
  const warningLevel = keptWarning(turns, input.question, proposal.warningLevel ?? null, previous?.warningLevel ?? null);

  let next: ChatFormProposal = proposal;
  if (employeeName !== proposal.employeeName) next = { ...next, employeeName };
  if (employeeRole && employeeRole !== next.employeeRole) next = { ...next, employeeRole };
  if (locationId && locationId !== next.locationId) {
    next = {
      ...next,
      locationId,
      locationResolution: "resolved",
    };
  }
  if (formDate && formDate !== next.formDate) next = { ...next, formDate };
  if (payrollDeduct && payrollDeduct !== next.payrollDeduct) next = { ...next, payrollDeduct };
  if (warningLevel && warningLevel !== next.warningLevel) next = { ...next, warningLevel };
  if (next.employeeName && next.status === "needs_employee") {
    next = {
      ...next,
      status: next.locationId || next.locationResolution === "not_applicable" ? "ready" : "needs_location",
    };
  }

  let content = scrubRosterBlock(input.response.content);
  content = dropWarningLines(content);
  if (next.templateKey === "stc-exit" && next.employeeName) {
    content = exitContent(content, next, turns.join("\n"), input.today);
  }
  content = dropBlockedQuestions(content, next);
  content = keepPolicyLines(content, previousContent(input.history, proposal.templateKey));

  const citations = (input.response.citations ?? []).filter((citation) => !isWarningCitation(citation));
  const same =
    content === input.response.content &&
    next === proposal &&
    citations.length === (input.response.citations ?? []).length;
  return same ? input.response : { ...input.response, content, formProposal: next, citations };
}

function previousProposal(history: readonly HistoryTurn[], templateKey: string): ChatFormProposal | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index]!;
    if (turn.role !== "assistant" || !turn.formProposal) continue;
    if (turn.formProposal.templateKey === templateKey) return turn.formProposal;
  }
  return null;
}

function previousContent(history: readonly HistoryTurn[], templateKey: string): string {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index]!;
    if (turn.role === "assistant" && turn.formProposal?.templateKey === templateKey) return turn.content;
  }
  return "";
}

function keptName(
  current: string | null,
  previous: string | null,
  turns: readonly string[],
  people: readonly GroundedPerson[],
): string | null {
  const question = turns[turns.length - 1] ?? "";
  const stated = newestName(turns);
  let picked: string | null = null;
  if (previous && !isFragment(previous)) {
    const longer = longerName(question, previous);
    picked = longer ?? (renamesEmployee(question, previous) ? stated ?? current : previous);
  } else if (!isFragment(current)) {
    const longer = stated && extendsName(stated, current!) ? stated : null;
    picked = longer ?? current;
  } else {
    picked = stated;
  }
  if (!picked || isFragment(picked)) return !isFragment(current) ? spell(current, people) : null;
  return spell(picked, people);
}

function spell(name: string | null, people: readonly GroundedPerson[]): string | null {
  if (!name) return null;
  if (people.length === 0) return displayTypedName(name);
  const match = matchEmployeeName(name, people);
  if (match.kind === "exact") return match.name;
  return displayTypedName(name);
}

function extendsName(longer: string, shorter: string): boolean {
  const extra = longer.trim().toLowerCase();
  const base = shorter.trim().toLowerCase();
  return extra !== base && extra.startsWith(`${base} `);
}

function longerName(question: string, previous: string): string | null {
  const found = extractEmployeeNames(question).find((name) => extendsName(name, previous));
  if (found) return found;
  const explicit = /(?:employee\s+name|name)\s+is\s+([A-Za-z][A-Za-z'’-]+(?:\s+[A-Za-z][A-Za-z'’-]+){0,3})/i.exec(question);
  if (explicit?.[1] && extendsName(explicit[1], previous)) return explicit[1];
  const words = previous.trim().split(/\s+/);
  if (words.length !== 1) return null;
  const match = new RegExp(String.raw`\b${words[0]}\s+([A-Za-z][A-Za-z'’-]+)\b`, "i").exec(question);
  if (!match?.[1]) return null;
  const full = match[0];
  if (isFragment(full) || NOT_A_NAME.has(match[1].toLowerCase()) || NOT_A_TYPED_NAME.has(match[1].toLowerCase())) return null;
  return full;
}

function renamesEmployee(question: string, previous: string): boolean {
  if (question.toLowerCase().includes(previous.toLowerCase())) return false;
  const explicit = /(?:employee\s+name|name)\s+is\s+([A-Za-z][A-Za-z'’-]+(?:\s+[A-Za-z][A-Za-z'’-]+){0,3})/i.exec(question);
  if (explicit?.[1] && !isFragment(explicit[1]) && explicit[1].toLowerCase() !== previous.toLowerCase()) return true;
  return false;
}

function distinctNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name.trim());
  }
  return out;
}

function newestName(turns: readonly string[]): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const text = turns[index]!;
    const explicit = /(?:employee\s+name|name)\s+is\s+([A-Za-z][A-Za-z'’-]+(?:\s+[A-Za-z][A-Za-z'’-]+){0,3})/i.exec(text);
    if (explicit?.[1] && !isFragment(explicit[1])) return explicit[1];
    const found = distinctNames(extractEmployeeNames(text).filter((name) => !isFragment(name)));
    // Two people in one turn is a choice. Picking the longer name filed the form for the wrong person.
    if (found.length > 1) return null;
    if (found.length === 1) return found[0]!;
  }
  return null;
}

function isFragment(name: string | null | undefined): boolean {
  if (!name?.trim()) return true;
  const text = name.trim();
  const words = text.toLowerCase().split(/\s+/);
  if (words.some((word) => NOT_A_NAME.has(word) || NOT_A_TYPED_NAME.has(word) || word === "exit" || word === "form")) {
    return true;
  }
  if (readSalonMentions(text).length > 0 || readSalonMentions(`at ${text}`).length > 0) return true;
  return false;
}

function salonIds(text: string): string[] {
  const visible = text.replace(/[.!]+/g, " ; ").replace(/[\n\r]+/g, " ; ");
  const fromVisible = [...new Set(readSalonMentions(visible).flatMap((mention) => mention.salonIds))];
  if (fromVisible.length > 0) return fromVisible;
  return [...new Set(readSalonMentions(text).flatMap((mention) => mention.salonIds))];
}

/**
 * The salon where it happened. "Primary salon is …" is the home salon, not
 * the one this account is about. A later turn that names none keeps the
 * one already named. The Woven primary is only the guess when nobody named one.
 */
function keptSalon(
  turns: readonly string[],
  current: string | null,
  previous: string | null,
  employeeName: string | null,
  people: readonly GroundedPerson[],
): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]!;
    const stripped = turn.replace(/\bprimary\s+salon\s+is\s+[^.\n]+/gi, " ");
    const ids = salonIds(stripped);
    if (ids.length === 1) return ids[0]!;
    if (stripped !== turn && ids.length === 0) {
      const home = salonIds(turn);
      if (home.length === 1) return home[0]!;
    }
  }
  const anyNamed = turns.some((turn) => salonIds(turn).length > 0);
  if (anyNamed) return previous ?? current;
  return current ?? previous ?? primarySalon(employeeName, people);
}

function primarySalon(name: string | null, people: readonly GroundedPerson[]): string | null {
  if (!name || people.length === 0) return null;
  const match = matchEmployeeName(name, people);
  if (match.kind !== "exact") return null;
  return people.find((person) => person.id === match.employee.id)?.primarySalonId ?? null;
}

function keptDate(question: string, today: string, current: string | null, previous: string | null): string | null {
  // "today" is the form's own default and is not stored as a calendar date.
  if (listIncidentDates(question, today).length === 0 && previous) return previous;
  return current ?? previous;
}

function keptPayroll(
  turns: readonly string[],
  current: "yes" | "no" | null,
  previous: "yes" | "no" | null,
  content: string,
): "yes" | "no" | null {
  // A published form with no payroll question must not grow an answer.
  const asks = /payroll deduct/i.test(content) || current !== null || previous !== null;
  if (!asks) return current ?? previous;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const text = turns[index]!;
    if (/\bnot\s+payroll\s+deductible\b/i.test(text)) return "no";
    const stated = statedPayrollDeduct(text);
    if (stated) return stated;
  }
  return current ?? previous;
}

function keptWarning(
  turns: readonly string[],
  question: string,
  current: "verbal" | "written" | null,
  previous: "verbal" | "written" | null,
): "verbal" | "written" | null {
  return warningLevelFromTurns([question]) ?? current ?? previous ?? warningLevelFromTurns(turns);
}

function dropBlockedQuestions(content: string, proposal: ChatFormProposal): string {
  return content
    .split("\n")
    .filter((line) => {
      if (proposal.locationId && /choose the salon below|which salon is this about/i.test(line)) return false;
      if (proposal.employeeName && /who is this|who is it for|confirmation of the employee/i.test(line)) return false;
      if (proposal.payrollDeduct && /is payroll deduct applicable\?\s*\(yes or no\)/i.test(line)) return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function dropWarningLines(content: string): string {
  return content
    .split("\n")
    .filter((line) => !/\bwarning policy\b/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isWarningCitation(citation: SourceCitation): boolean {
  const excerpt = citation.excerpt ?? "";
  return /^\s*warning\b/i.test(excerpt) || /\bwarning policy\b/i.test(excerpt);
}

function exitContent(content: string, proposal: ChatFormProposal, text: string, today: string): string {
  const facts = readExitFacts(text, today);
  const details = readExitDetails(text, today, facts);
  const asksWho = /who is (?:it|this)\b/i.test(content);
  const missingDate =
    (facts.lastDayWorked !== null && !content.includes(exitDateInWords(facts.lastDayWorked))) ||
    (facts.noticeGiven !== null && !content.includes(exitDateInWords(facts.noticeGiven)));
  const blank = /\*\*Left blank[^:]*:\*\*\s*([^\n]+)/i.exec(content)?.[1]?.toLowerCase() ?? "";
  const blankedKnown =
    (proposal.employeeRole && blank.includes("job title")) ||
    (proposal.locationId && blank.includes("location")) ||
    (facts.lastDayWorked !== null && blank.includes("last day")) ||
    (facts.noticeGiven !== null && blank.includes("notice"));
  if (!asksWho && !missingDate && !blankedKnown) return content;
  const ready = exitReady({ proposal, facts, details });
  const policy = content
    .split("\n")
    .filter((line) => /JBA Policy Manual/i.test(line) && !/\bwarning policy\b/i.test(line) && !ready.includes(line));
  return policy.length > 0 ? `${ready}\n\n${policy.join("\n")}` : ready;
}

function keepPolicyLines(content: string, previous: string): string {
  if (!previous || /JBA Policy Manual/i.test(content)) return content;
  const lines = previous
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /JBA Policy Manual/i.test(line) && !/\bwarning policy\b/i.test(line));
  if (lines.length === 0) return content;
  return `${content}\n\n${lines.join("\n")}`.trim();
}
