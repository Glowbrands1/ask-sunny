import { managerNameNotEmployeeEnabled } from "@/lib/config/chat-quality-flags";
import type { AskRequest, AskResponse } from "./types";

/**
 * ============================================================================
 * THE MANAGER'S OWN NAME IS NEVER THE EMPLOYEE IN AN ANSWER
 * ============================================================================
 *
 * MANAGER_NAME_NOT_EMPLOYEE_ENABLED (QA, live, 1 Nov 2026; same flag in both
 * apps). "step by step take an employee off myglow" named nobody, and the
 * answer said "If <the manager's own first name> is leaving the company
 * voluntarily…": the prompt opens "You are talking to <manager>", and the
 * model used that name for the employee.
 *
 * The prompt now says the name is only for addressing them (`prompts.ts`).
 * This is the backstop: the manager's first name used as the SUBJECT of a
 * sentence ("If/When/Once <name>", "<name> is/was/has/will…", "<name>'s") is
 * "the employee". Never when the manager typed that name in this chat, nor
 * when the card is for somebody who shares it; a greeting ("Hi <name>,") is
 * left alone — it is not a subject.
 */

/** The prompt's sentence, beside "You are talking to …". */
export const MANAGER_NAME_RULE =
  "Their name is only for addressing them. It is never an employee's name: when the manager has not named an employee, say \"the employee\" (or \"the team member\"), never their name.";

function escaped(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const LEADS = "If|When|Once|Before|After|Until|Unless|Whether|Since";
const VERBS =
  "is|was|has|had|have|will|would|should|must|can|could|may|might|needs|wants|gets|got|leaves|left|quits|quit|isn't|wasn't|hasn't|won't|doesn't|didn't|does|did";

/** "the employee", capitalised where it starts a sentence or a line. */
function theEmployee(before: string, possessive: boolean): string {
  const start = before === "" || /(?:^|[.!?]\s+|\n\s*(?:[-*]|\d+\.)?\s*)$/.test(before);
  return `${start ? "The" : "the"} employee${possessive ? "'s" : ""}`;
}

export function withoutManagerNameAsEmployee(text: string, input: { managerName: string; managerTurns: readonly string[]; cardEmployee?: string | null }): string {
  const first = input.managerName.trim().split(/\s+/)[0] ?? "";
  if (first.length < 2) return text;
  const name = new RegExp(`\\b${escaped(first)}\\b`, "i");
  if (input.managerTurns.some((turn) => name.test(turn))) return text;
  if (input.cardEmployee && name.test(input.cardEmployee)) return text;
  const f = escaped(first);
  let out = text.replace(new RegExp(`\\b(${LEADS})\\s+${f}('s)?\\b`, "gi"), (_m, lead: string, s: string | undefined) => `${lead} the employee${s ?? ""}`);
  out = out.replace(new RegExp(`\\b${f}('s)?(?=\\s+(?:${VERBS})\\b)`, "g"), (_m, s: string | undefined, offset: number, all: string) =>
    theEmployee(all.slice(0, offset), Boolean(s)),
  );
  out = out.replace(new RegExp(`\\b${f}'s\\b`, "g"), (_m, offset: number, all: string) => theEmployee(all.slice(0, offset), true));
  return out;
}

export function withManagerNameGuard(response: AskResponse, request: AskRequest): AskResponse {
  if (!managerNameNotEmployeeEnabled() || !response.content) return response;
  const managerTurns = [
    ...request.history.filter((turn) => turn.role === "user").map((turn) => turn.content ?? ""),
    request.question,
  ];
  const content = withoutManagerNameAsEmployee(response.content, {
    managerName: request.context?.userName ?? "",
    managerTurns,
    cardEmployee: response.formProposal?.employeeName ?? null,
  });
  return content === response.content ? response : { ...response, content };
}
