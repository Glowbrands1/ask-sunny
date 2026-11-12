import { teamCardNotProductEnabled } from "@/lib/config/chat-quality-flags";
import { displayName, rosterNameNamedIn, type RosterEmployee } from "@/lib/forms/employee-match";
import { allowsTeamSubject, readsAsTeamSubject, TEAM_SUBJECT_LABEL } from "@/lib/forms/team-subject";
import type { ChatFormProposal } from "@/types";

/**
 * ============================================================================
 * "A COACHING FORM FOR THE TEAM … ON SELLING SPRAY TAN KITS" IS THE TEAM'S CARD
 * (TEAM_CARD_NOT_PRODUCT_ENABLED)
 * ============================================================================
 *
 * QA's overnight scan sf-s13, 4 Nov 2026: "I need to make a coaching form for
 * the team at Kearney on selling Spray Tan Kits, not writing proper rainchecks
 * which results in inventory not being correct." → "The employee needs to be
 * left blank for now". Both cards were for "Spray Tan Kits" ("I have the
 * employee and the salon"): the capitalised product was read as a person, and
 * a named person beats the team. The instruction about the employee field was
 * appended to the card's Observation and handed to the drafting model.
 *
 * With the flag on, a coaching card whose name nobody on the manager's roster
 * answers to, in a request that puts the team as the subject (or says the
 * employee is to be left blank), and whose name the manager only ever wrote
 * after a topic word ("selling …", "on …", "about …") — never "for <name>" — is
 * the team card. A turn that only says the employee field is to be left blank
 * is no account: it leaves the card's sources. Pure.
 */

const TOPIC_LEAD = String.raw`(?:selling|sell|sells|sold|offering|pushing|on|about|regarding|with|of|the)`;
const BLANK_EMPLOYEE =
  /\b(?:employee(?:'s)?(?:\s+name)?|name)\b[^.!?\n]{0,30}\b(?:left\s+blank|leave\s+(?:it\s+)?blank|blank|empty|no\s+one|nobody)\b|\bleave\s+(?:the\s+)?(?:employee|name)(?:\s+name)?\s+(?:field\s+)?blank\b/i;

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "The employee needs to be left blank for now": about the form's Employee field, not what happened. */
export function saysEmployeeBlank(turn: string): boolean {
  return BLANK_EMPLOYEE.test(turn) && turn.trim().split(/\s+/).length <= 16;
}

/** The name was only ever written as the topic ("selling Spray Tan Kits"), never as who the form is for. */
export function writtenAsTopic(name: string, turns: readonly string[]): boolean {
  const said = new RegExp(`\\b${escaped(name).replace(/\s+/g, "\\s+")}\\b`, "i");
  const asTopic = new RegExp(`\\b${TOPIC_LEAD}\\s+${escaped(name).replace(/\s+/g, "\\s+")}\\b`, "i");
  const asSubject = new RegExp(`\\b(?:for|to)\\s+${escaped(name).replace(/\s+/g, "\\s+")}\\b`, "i");
  const naming = turns.filter((turn) => said.test(turn));
  return naming.length > 0 && naming.every((turn) => asTopic.test(turn) && !asSubject.test(turn));
}

/**
 * FORM_NAME_OFF_ROSTER_ASK_ENABLED (QA's #741 gate, 10 Nov 2026: with the roster-name set on, sf-s13's team card was lost):
 * the card's "employee" is a team card's product, written only as its topic, which the team step after the roster check
 * turns into the team card. The roster check leaves it for that step.
 */
export function teamCardProduct(card: Pick<ChatFormProposal, "employeeName" | "subject" | "templateKey">, turns: readonly string[]): boolean {
  const name = card.employeeName?.trim();
  if (!teamCardNotProductEnabled() || !name || card.subject === "team" || !allowsTeamSubject(card.templateKey)) return false;
  if (!turns.some((turn) => readsAsTeamSubject(turn)) && !turns.some(saysEmployeeBlank)) return false;
  return writtenAsTopic(name, turns);
}

export function withTeamCardNotProduct<T extends { content: string; formProposal?: ChatFormProposal | null }>(
  answer: T,
  input: {
    turns: readonly { id?: string; content: string }[];
    roster: readonly RosterEmployee[];
  },
): T {
  const card = answer.formProposal;
  if (!teamCardNotProductEnabled() || !card?.employeeName || card.subject === "team" || !allowsTeamSubject(card.templateKey)) return answer;
  const texts = input.turns.map((turn) => turn.content);
  const team = texts.some((turn) => readsAsTeamSubject(turn)) || texts.some(saysEmployeeBlank);
  if (!team) return answer;
  const name = card.employeeName;
  if (input.roster.some((person) => rosterNameNamedIn(name, [person]) !== null || displayName(person).toLowerCase() === name.toLowerCase())) return answer;
  if (!writtenAsTopic(name, texts)) return answer;
  const blankIds = new Set(input.turns.filter((turn) => turn.id && saysEmployeeBlank(turn.content)).map((turn) => turn.id!));
  const sources = card.sourceMessageIds.filter((id) => !blankIds.has(id));
  const named = new RegExp(`\\*\\*${escaped(name)}\\*\\*`, "g");
  return {
    ...answer,
    content: answer.content
      .replace(named, `**${TEAM_SUBJECT_LABEL}**`)
      .replace(/\bI have the employee and the salon\b/, "This one is for the whole team, and I have the salon")
      .replace(/\s*\bThe employee needs to be left blank[^\n]*/i, ""),
    formProposal: {
      ...card,
      employeeName: TEAM_SUBJECT_LABEL,
      employeeRole: null,
      subject: "team" as const,
      sourceMessageIds: sources.length > 0 ? sources : card.sourceMessageIds,
    },
  };
}

/**
 * THE CONVERSATION CREATE CHECKS, READ AS THE CHAT READ IT: on the team card,
 * a capitalised run written as the topic ("selling Spray Tan Kits") is read in
 * lower case, so no name reader takes it for a person. Any other card, or
 * flag off: as sent.
 */
export function teamTopicReadConversation<T extends { readonly role: string; readonly content: string }>(turns: T[], employeeName: string): T[] {
  if (!teamCardNotProductEnabled() || employeeName.trim() !== TEAM_SUBJECT_LABEL) return turns;
  const users = turns.filter((turn) => turn.role === "user").map((turn) => turn.content);
  if (!users.some((turn) => readsAsTeamSubject(turn)) && !users.some(saysEmployeeBlank)) return turns;
  const topic = new RegExp(String.raw`\b(${TOPIC_LEAD})\s+((?:[A-Z][\w'-]*)(?:\s+[A-Z][\w'-]*){0,3})`, "g");
  return turns.map((turn) =>
    turn.role !== "user" ? turn : { ...turn, content: turn.content.replace(topic, (_all, lead: string, run: string) => `${lead} ${run.toLowerCase()}`) },
  );
}
