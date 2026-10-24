import { PRODUCTION_SALONS } from "@/data/salons";
import { typedNameProceedsEnabled } from "@/lib/config/chat-quality-flags";
import { readCaPolicy } from "@/lib/forms/ca-policy";
import {
  displayName,
  matchEmployeeName,
  rosterNameNamedIn,
  type RosterEmployee,
} from "@/lib/forms/employee-match";
import { withKeptTypedNames } from "@/lib/forms/kept-typed-names";
import { supportsInlineDraft } from "@/lib/forms/inline-draft";
import { readEmployeeMentions } from "@/lib/forms/proposal";
import { readSalonMentions, rosterSalonName } from "@/lib/forms/salon-mention";
import type { ChatFormProposal } from "@/types";
import type { AskResponse } from "./types";

import { prependFormState, type ConversationFormState } from "./form-state";
import { uniqueRosterSalon } from "./intake-augment";
import { namesOfficialPolicyManual } from "./policy-manual-coverage";

/**
 * An employee, salon, or policy is accepted when it resolves.
 *
 * One strong roster match is rewritten to the directory spelling and limited
 * to that row. Two matches are told apart with the salon's name and the job
 * title. No match is said plainly and is not put on the form. An empty roster
 * leaves the typed name alone.
 */

export interface GroundedPerson extends RosterEmployee {
  readonly title: string | null;
  readonly primaryLocationName: string | null;
  /** Woven primary salon, when the directory mapped one that is in scope. */
  readonly primarySalonId?: string | null;
}

export interface GroundedPrep {
  readonly question: string;
  readonly rosterIds: readonly string[] | null;
  readonly keptTypedNames: readonly string[];
  readonly unmatched: readonly string[];
  readonly ambiguous: readonly GroundedPerson[];
  readonly ambiguousTyped: string | null;
  readonly keptTypedName: string | null;
  readonly employeeId: string | null;
}

export function prepareGroundedQuestion(input: {
  readonly question: string;
  readonly history: readonly { role: string; content: string }[];
  readonly people: readonly GroundedPerson[];
  readonly saved: ConversationFormState | null;
}): GroundedPrep {
  const people = input.people;
  const roster = people as readonly RosterEmployee[];
  let question = prependFormState(input.question, input.saved);
  const kept = new Set<string>();
  if (input.saved?.keptTypedName) kept.add(input.saved.keptTypedName);

  let rosterIds: string[] | null = null;
  let keptTypedName: string | null = input.saved?.keptTypedName ?? null;
  const choice = readGroundedChoice(input.history, input.question, people);
  if (choice?.kind === "person") {
    question = `The employee is ${choice.name}. ${input.question}`;
    rosterIds = [choice.id];
    keptTypedName = null;
  } else if (choice?.kind === "keep") {
    question = `The employee is ${choice.typed}. ${input.question}`;
    kept.add(choice.typed);
    keptTypedName = choice.typed;
    rosterIds = null;
  } else if (!choice && input.saved?.employeeId && readEmployeeMentions(input.question).names.length === 0) {
    rosterIds = [input.saved.employeeId];
  }

  if (readSalonMentions(question).length === 0) {
    const salon = uniqueRosterSalon(input.question) ?? uniqueRosterSalon(question);
    if (salon && !question.includes(`It happened at ${salon}.`)) {
      question = `${question}\nIt happened at ${salon}.`;
    }
  }

  const matchingRoster =
    rosterIds && rosterIds.length === 1 ? roster.filter((person) => person.id === rosterIds![0]) : roster;
  const gated = withKeptTypedNames([...kept], () => gateMentions(question, matchingRoster, people));
  if (gated.rosterIds && gated.rosterIds.length === 1) rosterIds = [...gated.rosterIds];

  return {
    question: gated.question,
    rosterIds,
    keptTypedNames: [...kept],
    unmatched: gated.unmatched,
    ambiguous: gated.ambiguous,
    ambiguousTyped: gated.ambiguousTyped,
    keptTypedName,
    employeeId: rosterIds && rosterIds.length === 1 ? rosterIds[0]! : null,
  };
}

export function readGroundedChoice(
  history: readonly { role: string; content: string }[],
  reply: string,
  people: readonly GroundedPerson[],
): { kind: "person"; id: string; name: string } | { kind: "keep"; typed: string } | null {
  const asked = [...history].reverse().find((turn) => turn.role === "assistant");
  if (!asked) return null;
  const labeled = parseLabeledQuestion(asked.content);
  if (!labeled || labeled.options.length < 2) return null;
  if (/^\s*keep\b/i.test(reply)) return { kind: "keep", typed: labeled.typed };
  const index = ordinalIndex(reply);
  if (index !== null && labeled.options[index]) {
    const person = personForOption(labeled.options[index]!, people);
    if (person) return { kind: "person", id: person.id, name: displayName(person) };
  }
  const distinguished = distinguishingOption(reply, labeled.options);
  if (distinguished) {
    const person = personForOption(distinguished, people);
    if (person) return { kind: "person", id: person.id, name: displayName(person) };
  }
  return null;
}

export function labelDuplicateQuestion(
  content: string,
  people: readonly GroundedPerson[],
  typed: string | null,
): string {
  if (!content.startsWith("Did you mean **")) return content;
  const head = /^Did you mean (.+?)\?/.exec(content);
  if (!head) return content;
  const names = [...head[1]!.matchAll(/\*\*([^*]+)\*\*/g)].map((match) => match[1]!.trim());
  if (names.length < 2) return content;
  const used = new Set<string>();
  const options = names.map((name, index) => {
    const row = people.find((person) => displayName(person) === name && !used.has(person.id));
    if (row) used.add(row.id);
    const salon = row ? salonLabel(row) : null;
    const detail = [salon, row?.title ?? null].filter(Boolean).join(", ");
    const label = detail ? `**${name}** (${detail})` : `**${name}**`;
    return `${index + 1}. ${label}`;
  });
  const typedName =
    typed ??
    /(?:couldn't find|a close match for|matches) \*\*([^*]+)\*\*/.exec(content)?.[1]?.trim() ??
    names[0]!;
  return `Did you mean ${options.join(" or ")}? More than one person on your team is a close match for **${typedName}**. Reply with the number, the salon, or the job title — or say "keep ${typedName}" to use the name exactly as you typed it.`;
}

export function applyGroundedProposal(
  response: AskResponse,
  input: {
    readonly people: readonly GroundedPerson[];
    readonly prep: GroundedPrep;
    readonly rosterEmpty: boolean;
  },
): AskResponse {
  let content = response.content;
  if (
    !typedNameProceedsEnabled() &&
    (input.prep.ambiguous.length > 1 || content.startsWith("Did you mean **"))
  ) {
    content = labelDuplicateQuestion(content, input.people, input.prep.ambiguousTyped);
  }
  if (!response.formProposal) return content === response.content ? response : { ...response, content };

  let proposal = response.formProposal;
  if (proposal.employeeName && isDocumentOrPolicyName(proposal.employeeName)) {
    const refused = proposal.employeeName;
    proposal = clearEmployee(proposal);
    if (!content.includes("names a document or a policy")) {
      content = `I didn't use **${refused}** as the employee — that names a document or a policy.\n\n${content}`;
    }
  } else if (!input.rosterEmpty && proposal.employeeName) {
    const currentName = proposal.employeeName;
    const match = matchEmployeeName(currentName, input.people);
    if (match.kind === "none" && isSalonPhrase(currentName)) {
      proposal = applySalon(clearEmployee(proposal), salonIdForPhrase(currentName));
    }
  }

  const fact = factForProposal(proposal, input.people, input.prep.employeeId);
  if (fact) {
    if (!proposal.employeeRole && fact.title) proposal = { ...proposal, employeeRole: fact.title };
    const ids = factSalonIds(fact);
    if (ids.length === 1 && (proposal.locationResolution !== "resolved" || !proposal.locationId)) {
      proposal = withLocation(proposal, ids[0]!);
    } else if (ids.length > 1 && !proposal.locationId && proposal.employeeName) {
      proposal = {
        ...proposal,
        locationResolution: "needs_selection",
        status: "needs_location",
        supportsInlineDraft: false,
        authorizedLocationIds: ids,
      };
    }
  }

  return proposal === response.formProposal && content === response.content
    ? response
    : { ...response, content, formProposal: proposal };
}

function gateMentions(
  question: string,
  roster: readonly RosterEmployee[],
  people: readonly GroundedPerson[],
): {
  question: string;
  rosterIds: readonly string[] | null;
  unmatched: string[];
  ambiguous: GroundedPerson[];
  ambiguousTyped: string | null;
} {
  if (roster.length === 0) {
    return { question, rosterIds: null, unmatched: [], ambiguous: [], ambiguousTyped: null };
  }
  const mentions = readEmployeeMentions(question);
  let next = question;
  const unmatched: string[] = [];
  let rosterIds: readonly string[] | null = null;
  let ambiguous: GroundedPerson[] = [];
  let ambiguousTyped: string | null = null;

  for (const name of mentions.names) {
    if (isDocumentOrPolicyName(name)) continue;
    const match = matchEmployeeName(name, roster);
    if (match.kind === "unchecked") continue;
    if (match.kind === "exact") {
      rosterIds = [match.employee.id];
      if (match.name !== name) next = replacePhrase(next, name, match.name);
      continue;
    }
    if (match.kind === "confirm" && typedNameProceedsEnabled()) {
      continue;
    }
    if (match.kind === "confirm" && match.candidates.length === 1) {
      const only = match.candidates[0]!;
      next = replacePhrase(next, name, only.name);
      rosterIds = [only.employee.id];
      continue;
    }
    if (match.kind === "confirm") {
      ambiguous = match.candidates.map(
        (candidate) => people.find((person) => person.id === candidate.employee.id) ?? asPerson(candidate.employee),
      );
      ambiguousTyped = name;
      continue;
    }
    const embedded = rosterNameNamedIn(name, roster);
    if (embedded) {
      next = replacePhrase(next, name, embedded);
      const again = matchEmployeeName(embedded, roster);
      if (again.kind === "exact") rosterIds = [again.employee.id];
      else if (again.kind === "confirm" && again.candidates.length === 1) rosterIds = [again.candidates[0]!.employee.id];
      else if (again.kind === "confirm") {
        ambiguous = again.candidates.map(
          (candidate) => people.find((person) => person.id === candidate.employee.id) ?? asPerson(candidate.employee),
        );
        ambiguousTyped = embedded;
      }
      continue;
    }
    if (isSalonPhrase(name)) continue;
    // The typed name stays in the question. The reply says Woven does not have it.
    unmatched.push(name);
  }

  return {
    question: next.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim(),
    rosterIds,
    unmatched,
    ambiguous,
    ambiguousTyped,
  };
}

interface LabeledOption {
  readonly index: number;
  readonly name: string;
  readonly detail: string;
}

function parseLabeledQuestion(content: string): { typed: string; options: LabeledOption[] } | null {
  if (!content.startsWith("Did you mean ")) return null;
  const typed = /a close match for \*\*([^*]+)\*\*/.exec(content)?.[1]?.trim();
  if (!typed) return null;
  const options = [...content.matchAll(/(\d+)\. \*\*([^*]+)\*\*(?: \(([^)]+)\))?/g)].map((match) => ({
    index: Number(match[1]) - 1,
    name: match[2]!.trim(),
    detail: match[3]?.trim() ?? "",
  }));
  return options.length > 0 ? { typed, options } : null;
}

function personForOption(option: LabeledOption, people: readonly GroundedPerson[]): GroundedPerson | null {
  const named = people.filter((person) => displayName(person) === option.name);
  if (named.length === 1) return named[0]!;
  const salon = uniqueRosterSalon(option.detail);
  const hit = named.find((person) => {
    if (salon && salonLabel(person) === salon) return true;
    return Boolean(person.title && option.detail.includes(person.title));
  });
  return hit ?? null;
}

function distinguishingOption(reply: string, options: readonly LabeledOption[]): LabeledOption | null {
  const text = reply.toLowerCase();
  const salon = uniqueRosterSalon(reply);
  const hits = options.filter((option) => {
    if (salon && option.detail.includes(salon)) return true;
    const words = option.detail
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4);
    return words.some((word) => text.includes(word));
  });
  return hits.length === 1 ? hits[0]! : null;
}

function ordinalIndex(reply: string): number | null {
  const text = reply.trim().toLowerCase();
  if (/\b(?:first|1st)\b/.test(text) || text === "1") return 0;
  if (/\b(?:second|2nd)\b/.test(text) || text === "2") return 1;
  if (/\b(?:third|3rd)\b/.test(text) || text === "3") return 2;
  return null;
}

/** A manual title or a policy the manager named, not a person on the roster. */
export function isDocumentOrPolicyName(name: string): boolean {
  const text = name.trim();
  if (!text) return false;
  if (namesOfficialPolicyManual(text)) return true;
  const words = text.split(/\s+/);
  if (words.length > 6) return false;
  return readCaPolicy(text).stated !== null;
}

function isSalonPhrase(name: string): boolean {
  if (readSalonMentions(name).some((mention) => mention.salonIds.length > 0)) return true;
  if (readSalonMentions(`at ${name}`).some((mention) => mention.salonIds.length > 0)) return true;
  return uniqueRosterSalon(name) !== null;
}

function salonIdForPhrase(phrase: string | null): string | null {
  if (!phrase) return null;
  const mentions = [...readSalonMentions(phrase), ...readSalonMentions(`at ${phrase}`)];
  const ids = [...new Set(mentions.flatMap((mention) => mention.salonIds))];
  if (ids.length === 1) return ids[0]!;
  const name = uniqueRosterSalon(phrase);
  if (!name) return null;
  return PRODUCTION_SALONS.find((salon) => salon.name === name)?.id ?? null;
}

function salonLabel(person: GroundedPerson): string | null {
  if (person.salonIds.length === 1) return rosterSalonName(person.salonIds[0]!) ?? null;
  if (person.primaryLocationName) return uniqueRosterSalon(person.primaryLocationName);
  return null;
}

function factSalonIds(person: GroundedPerson): string[] {
  const primary = person.primarySalonId ?? null;
  if (primary && (person.salonIds.length === 0 || person.salonIds.includes(primary))) return [primary];
  const named = person.primaryLocationName ? salonIdForPhrase(person.primaryLocationName) : null;
  if (named && (person.salonIds.length === 0 || person.salonIds.includes(named))) return [named];
  if (person.salonIds.length > 0) return [...person.salonIds];
  return [];
}

function factForProposal(
  proposal: ChatFormProposal,
  people: readonly GroundedPerson[],
  employeeId: string | null,
): GroundedPerson | null {
  if (employeeId) {
    const chosen = people.find((person) => person.id === employeeId);
    if (chosen) return chosen;
  }
  if (!proposal.employeeName) return null;
  const named = people.filter((person) => displayName(person).toLowerCase() === proposal.employeeName!.toLowerCase());
  if (named.length === 1) return named[0]!;
  if (proposal.locationId) {
    return named.find((person) => person.salonIds.includes(proposal.locationId!)) ?? null;
  }
  return null;
}

function clearEmployee(proposal: ChatFormProposal): ChatFormProposal {
  return { ...proposal, employeeName: null, status: "needs_employee", supportsInlineDraft: false };
}

function applySalon(proposal: ChatFormProposal, salonId: string | null): ChatFormProposal {
  if (!salonId || proposal.locationId) return proposal;
  return { ...proposal, locationId: salonId, locationResolution: "resolved" };
}

function withLocation(proposal: ChatFormProposal, locationId: string): ChatFormProposal {
  const wasReady = proposal.status === "ready";
  const status = proposal.employeeName ? "ready" : proposal.status;
  let inline = proposal.supportsInlineDraft;
  if (!wasReady && status === "ready") {
    inline = supportsInlineDraft(
      proposal.templateKey,
      proposal.variantKey
        ? [{ key: proposal.variantKey, label: proposal.variantKey, role: "", roleAbbr: "" }]
        : [],
    );
  }
  return { ...proposal, locationId, locationResolution: "resolved", status, supportsInlineDraft: inline };
}

function asPerson(employee: RosterEmployee): GroundedPerson {
  return { ...employee, title: null, primaryLocationName: null, primarySalonId: null };
}

function replacePhrase(text: string, phrase: string, replacement: string): string {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`\\b${escaped}\\b`, "i"), replacement);
}
