import { approverTitleNotEmployeeEnabled, exitLetterAddresseeEnabled, exitStatedOnlyEnabled, titleOfTheEmployeeEnabled } from "@/lib/config/chat-quality-flags";
import { withoutApproverClauses } from "@/lib/forms/approver-title";
import { extractJobTitle } from "@/lib/forms/proposal";
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
  const approverOn = approverTitleNotEmployeeEnabled();
  if (!titleOfTheEmployeeEnabled() && !exitOwned && !approverOn) return response;
  const card = response.formProposal;
  const role = card?.employeeRole?.trim();
  if (!card || !role || !card.employeeName || card.subject === "team") return response;
  const said = [...(request.history ?? []).filter((turn) => turn.role === "user").map((turn) => turn.content), request.question].join("\n");
  const another = titleOfTheEmployeeEnabled() && titleNamesAnotherPerson(said, role, card.employeeName);
  // EXIT_STATED_ONLY_ENABLED (QA, 5 Nov 2026): on an exit card, a title the manager only ever wrote as someone's
  // ("your Salon Director", "our Salon Directors") is that person's, never the employee's.
  const owned = exitOwned && card.templateKey === EXIT_TEMPLATE_KEY && onlyAsSomeonesTitle(said, role);
  // APPROVER_TITLE_NOT_EMPLOYEE_ENABLED (QA's r37 live check): "once the DM approves" names who approves; with those
  // clauses out, the manager stated no title for the employee (`forms/approver-title.ts`).
  const approver = approverOn && extractJobTitle(said) === role && extractJobTitle(withoutApproverClauses(said)) === null;
  if (!another && !owned && !approver) return response;
  /*
   * EXIT_LETTER_ADDRESSEE_ENABLED (QA, the live Sunny test of rounds 7c and 8, 9 Nov 2026): a termination letter signed
   * "<C>, District Manager" left "- **Job Title:** District Manager" on the exit card's read-back: the card's role was
   * cleared as another person's, but the line below looked for "**Job title:**" and never matched the read-back's
   * "- **Job Title:**". With the flag, on an exit card the line goes as EXIT_STATED_ONLY's does, and the Job Title is
   * left for the manager.
   */
  const lineOwned = owned || (another && exitLetterAddresseeEnabled() && card.templateKey === EXIT_TEMPLATE_KEY);
  const content = response.content
    .split("\n")
    .filter((line) => !line.trim().startsWith(`**Job title:** ${role}`) && !(lineOwned && new RegExp(String.raw`^(?:-\s*)?\*\*Job title:\*\*\s*${escape(role)}\s*$`, "i").test(line.trim())))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    // EXIT_STATED_ONLY_ENABLED: the title taken off an exit card is one for the manager to fill.
    .replace(/(\*\*Left blank for you to review:\*\*\s*)(?!Job Title\b)/, (lead: string) => (lineOwned ? `${lead}Job Title, ` : lead));
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
