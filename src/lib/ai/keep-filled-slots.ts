import { PRODUCTION_SALONS, salonById } from "@/data/salons";
import { readSalonMentions } from "@/lib/forms/salon-mention";
import { listIncidentDates } from "@/lib/forms/form-date-answer";
import { matchEmployeeName } from "@/lib/forms/employee-match";
import { extractEmployeeNames, extractJobTitle } from "@/lib/forms/proposal";
import { exitDateInWords, exitReady } from "@/lib/forms/exit-intake";
import { readExitDetails } from "@/lib/forms/exit-details";
import { readExitFacts } from "@/lib/forms/exit-facts";
import { statedPayrollDeduct } from "@/lib/forms/payroll-deduct";
import { managerStatedWarningLevel, templateHasWarningLevel, warningLevelFromTurns } from "@/lib/forms/warning-level";
import { describesMoreThanTheRequest } from "@/lib/forms/corrective-action-intake";
import { twoSentenceActionPlan } from "@/lib/forms/action-plan-sentences";
import { readPlaceState } from "@/lib/forms/place-state";
import { labelledSalonIds } from "@/lib/forms/salon-cue";
import { NOT_A_NAME, NOT_A_TYPED_NAME } from "@/lib/forms/name-words";
import {
  actionPlanSentencesEnabled,
  codeSlotsEnabled,
  globalSalonAskEnabled,
  groundedEntitiesEnabled,
  intentExtractionEnabled,
  warningLevelManagerOnlyEnabled,
  managerWordsOnlyEnabled,
  placeSpanGuardEnabled,
} from "@/lib/config/chat-quality-flags";
import { explicitIncidentIso } from "@/lib/forms/explicit-incident-date";
import { cleanPersonName, employeeNamedOnPurpose } from "@/lib/forms/roster-validated-name";
import type { ChatFormProposal, SourceCitation } from "@/types";

import { withoutAppLines } from "./app-sentences";
import type { GroundedPerson } from "./grounded-entities";
import { displayTypedName, repairSpeaksAsValidator, scrubRosterBlock } from "./roster-reply";

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
  const salonNames = PRODUCTION_SALONS.map((salon) => salon.name);
  const kept = keptName(proposal.employeeName, previous?.employeeName ?? null, turns, input.people);
  let employeeName = kept;
  if (codeSlotsEnabled()) {
    // The model never writes Employee. Each user turn can name someone;
    // a later turn keeps that name unless it renames them on purpose.
    let named: string | null = null;
    for (const turn of turns) {
      const next = cleanPersonName(
        employeeNamedOnPurpose(turn, named, input.people, salonNames),
        salonNames,
      );
      if (next) named = next;
    }
    employeeName = named;
  }
  const slotsOn = intentExtractionEnabled() || groundedEntitiesEnabled();
  const spokenRole = slotsOn ? spokenDirectoryTitle(turns.join("\n"), input.people, employeeName) : null;
  const employeeRole =
    extractJobTitle(input.question) ||
    extractJobTitle(turns.join("\n")) ||
    spokenRole ||
    proposal.employeeRole ||
    previous?.employeeRole ||
    null;
  const place = readPlaceState(turns.join("\n"));
  const namedSalon = turns.some((turn) => salonIds(turn).length > 0);
  let locationId = keptSalon(turns, proposal.locationId, previous?.locationId ?? null, employeeName, input.people);
  if (slotsOn && place.kind === "one") locationId = place.salon.id;
  if (slotsOn && place.kind === "unknown" && !namedSalon) locationId = null;
  const formDate = codeSlotsEnabled()
    ? explicitIncidentIso(input.question, input.today) ?? previous?.formDate ?? proposal.formDate ?? null
    : keptDate(input.question, input.today, proposal.formDate ?? null, previous?.formDate ?? null);
  const payrollDeduct = keptPayroll(
    turns,
    proposal.payrollDeduct ?? null,
    previous?.payrollDeduct ?? null,
    input.response.content,
  );
  /*
   * WARNING_LEVEL_MANAGER_ONLY_ENABLED: no level on a form without a Type of
   * Warning (live, 24 Oct 2026: "Written" on a Resignation/Exit Form and a
   * Policy Review), and none read from anything but the manager's turns.
   */
  const warningLevel = warningLevelManagerOnlyEnabled()
    ? templateHasWarningLevel({ key: proposal.templateKey, name: proposal.templateName })
      ? (proposal.warningLevel ?? previous?.warningLevel ?? managerStatedWarningLevel(turns.map((content) => ({ role: "user", content }))))
      : null
    : keptWarning(turns, input.question, proposal.warningLevel ?? null, previous?.warningLevel ?? null);

  let next: ChatFormProposal = proposal;
  if (employeeName !== proposal.employeeName) next = { ...next, employeeName };
  if (employeeRole && employeeRole !== next.employeeRole) next = { ...next, employeeRole };
  if (slotsOn && place.kind === "unknown" && !locationId) {
    const offered = directorySalonIds(employeeName, input.people);
    const ids = offered.length > 0 ? offered : next.authorizedLocationIds;
    if (ids.length > 0) {
      next = {
        ...next,
        locationId: null,
        locationName: null,
        namedLocationOutOfScope: null,
        locationResolution: "needs_selection",
        authorizedLocationIds: [...ids],
        // A missing salon does not hold the card. The choices stay in the reply.
        status: codeSlotsEnabled() && next.employeeName ? "ready" : next.employeeName ? "needs_location" : next.status,
        supportsInlineDraft: codeSlotsEnabled() ? Boolean(next.employeeName) : false,
      };
    }
  } else if (locationId && locationId !== next.locationId) {
    next = {
      ...next,
      locationId,
      locationResolution: "resolved",
      status: next.employeeName ? "ready" : next.status,
    };
  }
  if (formDate && formDate !== next.formDate) next = { ...next, formDate };
  if (payrollDeduct && payrollDeduct !== next.payrollDeduct) next = { ...next, payrollDeduct };
  if (warningLevel && warningLevel !== next.warningLevel) next = { ...next, warningLevel };
  if (warningLevelManagerOnlyEnabled() && !warningLevel && next.warningLevel) next = { ...next, warningLevel: null };
  if (next.employeeName && next.status === "needs_employee") {
    next = {
      ...next,
      status: codeSlotsEnabled() || next.locationId || next.locationResolution === "not_applicable" ? "ready" : "needs_location",
    };
  }
  if (codeSlotsEnabled() && next.employeeName && next.status === "needs_location") {
    next = { ...next, status: "ready", supportsInlineDraft: true };
  }

  let content = scrubRosterBlock(input.response.content);
  if (codeSlotsEnabled() && (!content.trim() || repairSpeaksAsValidator(input.response.content))) {
    const prior = previousContent(input.history, proposal.templateKey);
    if (prior.trim()) content = prior;
  }
  content = dropWarningLines(content);
  if (next.templateKey === "stc-exit" && next.employeeName) {
    content = exitContent(content, next, turns.join("\n"), input.today);
  }
  content = dropBlockedQuestions(content, next);
  content = keepPolicyLines(content, previousContent(input.history, proposal.templateKey));
  if (slotsOn) {
    content = withObservation(content, turns, next.employeeName);
    if (next.locationResolution === "needs_selection" && !next.locationId) {
      const asked = salonAlreadyAsked(input.history);
      // The global question already named every salon. A later turn does not
      // ask again and does not reprint the whole company. A short assignment
      // still lists its salons so the choice stays on the card.
      const everySalon = next.authorizedLocationIds.length === PRODUCTION_SALONS.length;
      if (!(asked && everySalon)) content = withSalonChoices(content, next.authorizedLocationIds, asked);
    }
  }

  const citations = (input.response.citations ?? []).filter((citation) => !isWarningCitation(citation));
  if (actionPlanSentencesEnabled() && next.templateKey === "dpoa" && next.employeeName) {
    content = withActionPlan(content, next, citations);
  }
  if (codeSlotsEnabled()) {
    for (const line of emptySlotQuestions(next)) {
      if (!content.includes(line)) content = content ? `${content}\n\n${line}` : line;
    }
  }
  const same =
    content === input.response.content &&
    next === proposal &&
    citations.length === (input.response.citations ?? []).length;
  return same ? input.response : { ...input.response, content, formProposal: next, citations };
}

function emptySlotQuestions(proposal: ChatFormProposal): string[] {
  if (!proposal.templateKey) return [];
  const lines: string[] = [];
  if (!proposal.employeeName) lines.push("Employee is still blank.");
  // Exit paperwork keeps its dates in the narrative. formDate stays empty on
  // purpose, so it is not a missing slot. A salon is never a gate.
  const dated = proposal.templateKey === "dpoa" || proposal.templateKey === "coaching";
  if (dated && !proposal.formDate) lines.push("Date is still blank.");
  return lines;
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
  // PLACE_SPAN_GUARD_ENABLED: "location st joe" names St Joseph (`salon-cue.ts`).
  if (placeSpanGuardEnabled()) return labelledSalonIds(text);
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

/**
 * A directory title the manager started. Their words are a prefix of that
 * title. The person's own title is used whole when it starts with those
 * words. Someone who is not on the roster keeps only the words they said.
 */
function spokenDirectoryTitle(
  text: string,
  people: readonly GroundedPerson[],
  employeeName: string | null,
): string | null {
  if (!employeeName) return null;
  const titles = [
    ...new Set(people.map((person) => person.title?.trim()).filter((title): title is string => Boolean(title))),
  ];
  let best: { prefix: string; words: number } | null = null;
  for (const title of titles) {
    const words = title.split(/\s+/).filter(Boolean);
    for (let length = words.length; length >= 2; length -= 1) {
      const prefix = words.slice(0, length).join(" ");
      const pattern = new RegExp(`\\b${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (!pattern.test(text)) continue;
      if (!best || length > best.words) best = { prefix, words: length };
      break;
    }
  }
  if (!best) return null;
  const person = personByName(employeeName, people);
  if (!person) return best.prefix;
  const own = person.title?.trim() ?? "";
  return own.toLowerCase().startsWith(best.prefix.toLowerCase()) ? own : null;
}

function personByName(name: string, people: readonly GroundedPerson[]): GroundedPerson | null {
  const match = matchEmployeeName(name, people);
  if (match.kind !== "exact") return null;
  return people.find((person) => person.id === match.employee.id) ?? null;
}

function directorySalonIds(name: string | null, people: readonly GroundedPerson[]): string[] {
  if (!name) return [];
  const person = personByName(name, people);
  return person ? [...person.salonIds] : [];
}

/** The account already given, copied onto the card so the offense is not asked again. */
function withObservation(content: string, turns: readonly string[], employeeName: string | null): string {
  const ignore = employeeName ? [employeeName] : [];
  const managerOnly = managerWordsOnlyEnabled();
  const sentences: string[] = [];
  for (const turn of managerOnly ? turns.map(withoutAppLines) : turns) {
    for (const part of turn.split(/\n+|(?<=[.!?])\s+/)) {
      const sentence = part.trim();
      if (sentence.length < 12) continue;
      if (!describesMoreThanTheRequest(sentence, { ignore })) continue;
      if (managerOnly && onlySaysWhereTheyWork(sentence, ignore)) continue;
      if (content.toLowerCase().includes(sentence.toLowerCase())) continue;
      if (sentences.some((kept) => kept.toLowerCase() === sentence.toLowerCase())) continue;
      sentences.push(sentence);
    }
  }
  if (sentences.length === 0) return content;
  return `${content}\n\n**Observation of Offense:** ${sentences.join(" ")}`.trim();
}

/**
 * "She works at NE Grand Island" says where the employee works. It is the
 * salon, not an offense. A sentence that also says what happened stays.
 */
const WHERE_THEY_WORK = /^(?:(?:she|he|they|[a-z'’-]+(?:\s+[a-z'’-]+)?)\s+)?(?:works|worked|is|was|is based|is assigned|is working)\s+(?:at|in|out of|from)(?:\s+the)?(?:\s+(?:salon|location|store))?$/;

function onlySaysWhereTheyWork(sentence: string, ignore: readonly string[]): boolean {
  const ids = [...new Set(readSalonMentions(sentence).flatMap((mention) => mention.salonIds))];
  if (ids.length === 0) return false;
  const salonWords = new Set(
    ids.flatMap((id) => (salonById(id)?.name ?? "").toLowerCase().split(/[^a-z0-9]+/)).filter(Boolean),
  );
  const nameWords = new Set(ignore.flatMap((name) => name.toLowerCase().split(/\s+/)).filter(Boolean));
  const rest = sentence
    .toLowerCase()
    .replace(/[.!,]+/g, " ")
    .split(/\s+/)
    .filter((word) => word && !salonWords.has(word) && !/^\d+$/.test(word))
    .map((word) => (nameWords.has(word) ? "she" : word));
  const collapsed = rest.filter((word, index) => !(word === "she" && rest[index - 1] === "she")).join(" ");
  return WHERE_THEY_WORK.test(collapsed);
}

/** The global salon question is once per conversation. A later turn does not ask it again. */
function salonAlreadyAsked(history: readonly HistoryTurn[]): boolean {
  if (!globalSalonAskEnabled()) return false;
  return history.some((message) => message.role === "assistant" && /which salon is this about/i.test(message.content));
}

/** The real salons, named, when the place they typed is not one of them. */
function withSalonChoices(content: string, ids: readonly string[], alreadyAsked = false): string {
  const names = ids.map((id) => salonById(id)?.name).filter((name): name is string => Boolean(name));
  if (names.length === 0 || names.every((name) => content.includes(name))) return content;
  const lines = names.map((name, index) => `${index + 1}. **${name}**`);
  const ask =
    alreadyAsked || /which salon/i.test(content) ? lines.join("\n") : `Which salon is this about?\n${lines.join("\n")}`;
  return `${content}\n\n${ask}`.trim();
}

function withActionPlan(content: string, proposal: ChatFormProposal, citations: readonly SourceCitation[]): string {
  if (/Management will review\b/i.test(content)) return content;
  const citedPolicies = [
    ...new Set(
      citations
        .map((citation) => citation.excerpt.split(".")[0]?.trim() ?? "")
        .filter((heading) => heading.length > 2 && !/^warning$/i.test(heading)),
    ),
  ];
  const plan = twoSentenceActionPlan({
    citedPolicies,
    employeeName: proposal.employeeName,
    payroll: { answer: proposal.payrollDeduct ?? null, amount: null },
  });
  return `${content}\n\n**Action Plan:** ${plan}`.trim();
}
