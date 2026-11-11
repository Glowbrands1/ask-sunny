import { groupWordsNotANameEnabled } from "@/lib/config/chat-quality-flags";

import { isGroupOfPeople } from "./not-a-name";

/*
 * ============================================================================
 * "THE SAME FORM FOR MULTIPLE EMPLOYEES" ASKS WHICH EMPLOYEES (GROUP_WORDS_NOT_A_NAME_ENABLED; ported from the sibling app's Problem 19, 11 Nov 2026)
 * ============================================================================
 *
 * "create a coaching form about accountability", then "I want the same form for multiple employees": "multiple
 * employees" was read as the employee's name ("I can't find **Multiple Employees** on your roster"). With the flag on,
 * `isNotAName` turns group words down, so the card asks who it is for; this rewrites that question for a group: "Which
 * employees? Tell me their full names", with the form and its topic kept, one form at a time. Pure.
 */

const QUANTIFIED_GROUP = /\b(?:for|to|with|about)\s+((?:(?:multiple|several|many|some|all|both|these|those|my|our|the|a\s+few|few|two|three|four|five|other|more|team|staff)\s+){0,3}(?:employees|staff|people|team|teams|members|associates|workers|crew|everyone|everybody|employes|employess|emplyees))\b/gi;

/** The group of people a manager's turn names ("multiple employees", "my team"), or null when it names none. */
export function groupNamed(text: string): string | null {
  for (const match of text.matchAll(QUANTIFIED_GROUP)) {
    if (isGroupOfPeople(match[1]!)) return match[1]!.replace(/\s+/g, " ").trim();
  }
  return null;
}

const ABOUT = /\b(?:form|ca|coaching|corrective action|write[- ]?up)\b[^\n.]*?\babout\s+([^\n.,;!?]+?)\s*(?:[.,;!?]|$)/i;

/** The topic the manager gave the form ("accountability"), from the latest turn that gives one. */
export function formTopic(managerTurns: readonly string[]): string | null {
  for (const turn of [...managerTurns].reverse()) {
    const topic = ABOUT.exec(turn)?.[1]?.trim();
    if (topic && !groupNamed(`for ${topic}`)) return topic;
  }
  return null;
}

interface CardLike {
  employeeName: string | null;
  templateName?: string;
  status: string;
}

/** On the ask-who card for a turn that names a group, the question asks which employees, keeping the form's topic. */
export function withGroupWordsAsk<T extends { content: string; formProposal?: CardLike | null }>(
  answer: T,
  managerTurns: readonly string[],
): T {
  if (!groupWordsNotANameEnabled()) return answer;
  const card = answer.formProposal;
  if (!card || card.employeeName || card.status !== "needs_employee") return answer;
  const latest = managerTurns[managerTurns.length - 1] ?? "";
  if (!groupNamed(latest)) return answer;
  const form = card.templateName ?? "form";
  const topic = formTopic(managerTurns);
  return {
    ...answer,
    content: `Which employees? Tell me their full names, and I'll make the **${form}**${topic ? ` about ${topic}` : ""} for each of them, one at a time.`,
  };
}
