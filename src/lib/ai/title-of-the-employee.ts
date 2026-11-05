import { titleOfTheEmployeeEnabled } from "@/lib/config/chat-quality-flags";
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
  if (!titleOfTheEmployeeEnabled()) return response;
  const card = response.formProposal;
  const role = card?.employeeRole?.trim();
  if (!card || !role || !card.employeeName || card.subject === "team") return response;
  const said = [...(request.history ?? []).filter((turn) => turn.role === "user").map((turn) => turn.content), request.question].join("\n");
  if (!titleNamesAnotherPerson(said, role, card.employeeName)) return response;
  const content = response.content
    .split("\n")
    .filter((line) => !line.trim().startsWith(`**Job title:** ${role}`))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { ...response, content, formProposal: { ...card, employeeRole: null } };
}
