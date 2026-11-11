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

/* What may follow a group: the end, punctuation, or a word that starts the rest of the sentence — never another noun. */
const GROUP_END = String.raw`(?=\s*(?:$|[.,;:!?)]|(?:for|about|who|that|on|in|because|regarding|and|with|to|today|yesterday|this|next|last|please)\b))`;
/* "multiple employees", "several team members", "all staff", "my employees" (plural-people quantifier + plural noun). */
const PEOPLE_GROUP = new RegExp(
  String.raw`\b(?:for|to|with|about)\s+((?:multiple|several|many|some|all|both|these|those|my|our|a\s+few|few|two|three|four|five|other|more)\s+(?:(?:team|staff)\s+)?(?:employees|people|members|associates|workers|staff|employes|employess|emplyees))` + GROUP_END,
  "gi",
);
/* "the same form for my team": team words count only when the turn repeats a form. */
const REPEATS_A_FORM = /\b(?:the\s+same|this|that)\s+(?:form|one|card|coaching(?:\s+form)?|ca|write[- ]?up)\b/i;
const TEAM_GROUP = new RegExp(String.raw`\b(?:for|to|with)\s+((?:my|our|the)\s+(?:whole\s+|entire\s+)?team|everyone|everybody)` + GROUP_END, "gi");

/**
 * The group of people a manager's turn names, or null when it names none (Gate-Bubbles-2, 11 Nov 2026): a plural-people
 * quantifier ("multiple employees", "all staff"), or team words in a turn that repeats a form ("I want the same form
 * for my team"). Never "the team at <store>" or another whole-team coaching request, and never a group word that leads
 * another noun ("about the team meeting").
 */
export function groupNamed(text: string): string | null {
  for (const match of text.matchAll(PEOPLE_GROUP)) {
    if (isGroupOfPeople(match[1]!)) return match[1]!.replace(/\s+/g, " ").trim();
  }
  if (REPEATS_A_FORM.test(text)) {
    for (const match of text.matchAll(TEAM_GROUP)) return match[1]!.replace(/\s+/g, " ").trim();
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
  subject?: string;
}

/** On the ask-who card for a turn that names a group, the question asks which employees, keeping the form's topic. */
export function withGroupWordsAsk<T extends { content: string; formProposal?: CardLike | null }>(
  answer: T,
  managerTurns: readonly string[],
): T {
  if (!groupWordsNotANameEnabled()) return answer;
  const card = answer.formProposal;
  if (!card || card.employeeName || card.status !== "needs_employee" || card.subject === "team") return answer;
  const latest = managerTurns[managerTurns.length - 1] ?? "";
  if (!groupNamed(latest)) return answer;
  const form = card.templateName ?? "form";
  const topic = formTopic(managerTurns);
  return {
    ...answer,
    content: `Which employees? Tell me their full names, and I'll make the **${form}**${topic ? ` about ${topic}` : ""} for each of them, one at a time.`,
  };
}
