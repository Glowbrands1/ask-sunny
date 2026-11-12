import { approverTitleNotEmployeeEnabled } from "@/lib/config/chat-quality-flags";

/*
 * ============================================================================
 * "ONCE THE DM APPROVES" NAMES WHO APPROVES, NOT THE EMPLOYEE'S TITLE (APPROVER_TITLE_NOT_EMPLOYEE_ENABLED)
 * ============================================================================
 *
 * QA's Ask Sunny r37 live check (12 Nov 2026, main 7e8dcdb6; names invented): "CA for <A>, probably termination once the
 * DM approves" put "Job title: District Manager" on the card. A title in a clause about who approves, signs off or is
 * waited on is that approver's. These clauses are taken out before the title is read again (`ai/title-of-the-employee.ts`).
 * Pure; off, the text as given.
 */
const WHO = String.raw`(?:the|my|our|your|a|an)\s+(?:[\p{L}/&.-]+\s+){0,2}?[\p{L}/&.-]+`;
const APPROVER_CLAUSES: readonly RegExp[] = [
  // "once the DM approves", "after my district manager signs off", "until the DM okays it", "when the SD reviews it"
  new RegExp(String.raw`\b(?:once|after|when|until|till|unless|if|before|pending)\s+${WHO}\s+(?:approves?|approved|signs?\s+off|signed\s+off|ok(?:ay)?s|ok(?:ay)?ed|agrees?|reviews?|confirms?|decides?|gives\s+(?:the\s+)?(?:ok|okay|go[- ]ahead))\b`, "giu"),
  // "the DM's approval", "my district manager's sign-off"
  new RegExp(String.raw`\b${WHO}['’]s\s+(?:approval|sign[- ]?off|ok(?:ay)?|go[- ]ahead|decision|review)\b`, "giu"),
  // "waiting on the DM", "pending the DM", "needs the DM to approve", "with the DM's approval"
  new RegExp(String.raw`\b(?:waiting\s+(?:on|for)|pending|needs?|need\s+to\s+get|run\s+(?:it\s+)?by|check\s+with)\s+${WHO}(?:\s+to\s+(?:approve|sign\s+off|ok(?:ay)?|review))?\b`, "giu"),
  // "DM approval", "DM sign-off"
  /\b(?:dm|sd|district\s+manager|salon\s+director)\s+(?:approval|sign[- ]?off)\b/giu,
];

/** The text with every approver clause taken out (flag on); as given otherwise. */
export function withoutApproverClauses(text: string): string {
  if (!approverTitleNotEmployeeEnabled()) return text;
  return APPROVER_CLAUSES.reduce((rest, clause) => rest.replace(clause, " "), text ?? "");
}
