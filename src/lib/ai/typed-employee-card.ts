import { keepFormEmployeeEnabled } from "@/lib/config/chat-quality-flags";
import { typedEmployeeName } from "@/lib/forms/typed-employee-name";

import type { AskResponse } from "./types";

/**
 * ============================================================================
 * THE CARD KEEPS THE NAME THE MANAGER TYPED (KEEP_FORM_EMPLOYEE_ENABLED)
 * ============================================================================
 *
 * QA, 25 Oct 2026: "Create an exit form for Test Employee at Lawrence, she
 * resigned …" put **Test** on the card. The proposal's sentence reader
 * (forms/proposal.ts) ends a capitalised name at a form word, and "Employee"
 * is one ("Employee Performance Plan"), so it reads "Test". On the intent
 * path the typed name reaches the card through the stored employee line and
 * the slot keeper (`holdFilledSlots`); with intent extraction off nothing
 * carries it, so the card is set here, last.
 *
 * Only when the manager's words type "<First> Employee" as the person (see
 * `typedEmployeeName`) and the card's employee is exactly that first word:
 * the card and the reply's bold name lines then carry the full name. A card
 * for anybody else, a lower-case "an employee", and flag off: unchanged.
 */
export function withTypedEmployeeOnCard(response: AskResponse, managerText: string): AskResponse {
  const proposal = response.formProposal;
  if (!keepFormEmployeeEnabled() || !proposal?.employeeName) return response;
  const typed = typedEmployeeName(managerText);
  if (!typed) return response;
  const first = typed.split(" ")[0]!;
  const shown = proposal.employeeName.trim();
  if (shown.toLowerCase() !== first.toLowerCase()) return response;
  const escaped = shown.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const content = response.content
    // "for **Test**", "**Test**'s"
    .replace(new RegExp(`\\*\\*${escaped}\\*\\*`, "g"), `**${typed}**`)
    // "**Name:** Test", "**Employee:** Test" at the end of the line or before a comma.
    .replace(
      new RegExp(`(\\*\\*(?:Employee(?: name)?|Name):\\*\\*\\s*)${escaped}(?=\\s*(?:$|[,.;(]))`, "gim"),
      `$1${typed}`,
    );
  return { ...response, content, formProposal: { ...proposal, employeeName: typed } };
}
