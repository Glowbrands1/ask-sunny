import { exitStatedOnlyEnabled, titleOfTheEmployeeEnabled } from "@/lib/config/chat-quality-flags";
import { EXIT_TEMPLATE_KEY } from "@/lib/forms/exit-library";
import { titleNamesAnotherPerson } from "@/lib/forms/title-of-another-person";

import type { AskRequest, AskResponse } from "./types";

/**
 * ============================================================================
 * THE CARD'S JOB TITLE IS THE EMPLOYEE'S — TITLE_OF_THE_EMPLOYEE_ENABLED
 * ============================================================================
 *
 * Port from the sibling app (QA, 5 Nov 2026, R2): one employee's story named
 * their district manager in passing ("When <employee> spoke with District
 * manager <name> …"), and the card's title was "District Manager". The card
 * is built where the title the manager stated is read (a protected step);
 * this runs after it, on the finished card.
 *
 * Here the card's title is only ever one the manager stated
 * (`ChatFormProposal.employeeRole`). When every place the manager's turns
 * write it stands beside another named person
 * (`forms/title-of-another-person.ts`), the manager did not state it for the
 * employee: the card has none, and the reply's "**Job title:** <title>" line
 * goes. Default off: the response as built.
 */
export function withTitleOfTheEmployee(response: AskResponse, request: Pick<AskRequest, "question" | "history">): AskResponse {
  const exitOwned = exitStatedOnlyEnabled();
  if (!titleOfTheEmployeeEnabled() && !exitOwned) return response;
  const card = response.formProposal;
  const role = card?.employeeRole?.trim();
  if (!card || !role || !card.employeeName || card.subject === "team") return response;
  const said = [...(request.history ?? []).filter((turn) => turn.role === "user").map((turn) => turn.content), request.question].join("\n");
  const another = titleOfTheEmployeeEnabled() && titleNamesAnotherPerson(said, role, card.employeeName);
  // EXIT_STATED_ONLY_ENABLED (QA, 5 Nov 2026): on an exit card, a title the manager only ever wrote as someone's
  // ("your Salon Director", "our Salon Directors") is that person's, never the employee's.
  const owned = exitOwned && card.templateKey === EXIT_TEMPLATE_KEY && onlyAsSomeonesTitle(said, role);
  if (!another && !owned) return response;
  const content = response.content
    .split("\n")
    .filter((line) => !line.trim().startsWith(`**Job title:** ${role}`) && !(owned && new RegExp(String.raw`^(?:-\s*)?\*\*Job title:\*\*\s*${escape(role)}\s*$`, "i").test(line.trim())))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    // EXIT_STATED_ONLY_ENABLED: the title taken off an exit card is one for the manager to fill.
    .replace(/(\*\*Left blank for you to review:\*\*\s*)(?!Job Title\b)/, (lead: string) => (owned ? `${lead}Job Title, ` : lead));
  return { ...response, content, formProposal: { ...card, employeeRole: null } };
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every place the manager wrote the title has a possessive before it: "your Salon Director", "our Salon Directors". */
function onlyAsSomeonesTitle(said: string, role: string): boolean {
  const all = [...said.matchAll(new RegExp(String.raw`(\S+\s+)?\b${escape(role)}s?\b`, "gi"))];
  return all.length > 0 && all.every((match) => /^(?:your|her|his|their|my|our)\s+$/i.test(match[1] ?? ""));
}
