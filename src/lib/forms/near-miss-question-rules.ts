import type { AskRequest, AskResponse } from "@/lib/ai/types";
import { nearMissQuestionRulesEnabled, nearMissTurnedDownEverywhereEnabled } from "@/lib/config/chat-quality-flags";

import { statedPayrollDeduct } from "./payroll-deduct-answer";
import { ASK_WHO } from "./roster-only-names";

/**
 * ============================================================================
 * "IS THIS FOR <NAME>?" — "NO" TURNS IT DOWN, AND A CARD IS NEVER REPLACED BY IT
 * ============================================================================
 *
 * NEAR_MISS_QUESTION_RULES_ENABLED (QA's Sunny round-4 gate on b2f66960, 8 Nov 2026; ships with the name set).
 *
 * (a) nov7-near-miss-details-{corvina,delphine}-turned-down: after "Is this for **<roster name>**? Tell me if that
 * should change.", the reply "no, verbal warning, no payroll deduct, …" still drafted for the name turned down: the
 * name readers read the first turn's typed name again and seated its roster near-miss. A reply that opens by turning
 * the name down ("no", "nope", "wrong", "not …"; not when that opening clause is itself the payroll answer, "no payroll
 * deduct") never gets a card for that name: the card keeps the details and waits for the employee, and the reply asks
 * who. Nor is the same question asked again about it (the sibling app's Corvina chat: "no, …" → "Is this for
 * **<that name>**?" once more): the reply asks who. A full name given in the same reply ("no, it's <name>") is read as
 * before (`ai/first-name-suggest.ts`), so only the name turned down is ever taken off.
 *
 * (b) is in `roster-only-names.ts`: it needs the card on screen (`cardEmployee`, entered by the chat route).
 */

const ASKED = /^Is this for \*\*([^*\n]+)\*\*\? Tell me if that should change\.\s*$/;
const TURNS_DOWN = /^\s*(?:no|nope|wrong|not)\b/i;

/**
 * The reply's own line about the card on screen: its first line ("I'll draft a **Corrective Action Form** for
 * **<name>** …"), or the reply that left it as it was ("I haven't changed the **Corrective Action Form** for **<name>**
 * — …"; QA's round-4 gate, sun-msb-format turn 3, came after that reply).
 */
const CARD_LEAD = /^(?:I'll draft an?|I haven't changed the) \*\*[^*\n]+\*\* for \*\*([^*\n]+)\*\*/m;

function lastReply(request: Pick<AskRequest, "history">): string {
  return String([...(request.history ?? [])].reverse().find((turn) => turn.role === "assistant")?.content ?? "").trim();
}

/**
 * (b) The employee of the card on screen: the one the reply before this turn drafted, or the open form it answered
 * about (sun-msb-format: the draft was created, and turn 3 replaced it with the bare question); null otherwise.
 */
export function cardEmployee(request: Pick<AskRequest, "history" | "activeFormInstanceId">): string | null {
  return CARD_LEAD.exec(lastReply(request))?.[1]?.trim() || null;
}

/** (a) The name the reply before this turn asked about, when this turn turns it down; null otherwise. */
/*
 * NEAR_MISS_TURNED_DOWN_EVERYWHERE_ENABLED (QA, 11 Nov 2026): "no call no show on 11/3, verbal warning" answering "Is this
 * for **<name>**?" is an account that keeps the name, not a "no". With the flag, "no"/"nope" turn the name down only on
 * their own or with their own punctuation ("no", "no,", "no."); "wrong" and "not" read as before.
 */
const NO_THEN_WORDS = /^\s*(?:no|nope)\b(?![,.;:!]|\s*$)/i;

export function turnedDownName(request: Pick<AskRequest, "history" | "question">): string | null {
  const asked = ASKED.exec(lastReply(request))?.[1]?.trim();
  if (!asked || !TURNS_DOWN.test(request.question)) return null;
  if (nearMissTurnedDownEverywhereEnabled() && NO_THEN_WORDS.test(request.question)) return null;
  const opening = request.question.trim().split(/[,.;!\n]/)[0] ?? "";
  return statedPayrollDeduct(opening) === null ? asked : null;
}

/** (a) The reply to a turn that turned the asked name down never drafts for that name. */
export function withoutTurnedDownName(answer: AskResponse, request: Pick<AskRequest, "history" | "question">): AskResponse {
  if (!nearMissQuestionRulesEnabled()) return answer;
  const name = turnedDownName(request);
  if (!name) return answer;
  const again = ASKED.exec(answer.content.trim())?.[1]?.trim();
  if (!answer.formProposal && again && again.toLowerCase() === name.toLowerCase()) return { ...answer, content: ASK_WHO };
  const card = answer.formProposal;
  if (!card || (card.employeeName ?? "").trim().toLowerCase() !== name.toLowerCase()) return answer;
  const content = answer.content
    .replace(new RegExp(String.raw`\s+for\s+\*\*${escape(name)}\*\*`, "g"), "")
    .split(`**${name}**`)
    .join("the employee")
    .replace(/^Create the draft here when you're ready[^\n]*$/m, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const cleared = nearMissTurnedDownEverywhereEnabled() ? withoutNameInPlan(withoutTurnDownLead(content), name) : content;
  return {
    ...answer,
    content: cleared.includes(ASK_WHO) ? cleared : `${cleared}\n\n${ASK_WHO}`,
    formProposal: { ...card, employeeName: null, status: "needs_employee", supportsInlineDraft: false },
  };
}

/*
 * NEAR_MISS_TURNED_DOWN_EVERYWHERE_ENABLED (QA, 10 Nov 2026): the name turned down also leaves the Action Plan line
 * ("Management will review … with Corvina." → "… with the employee."), which names the person by first name, and the
 * "no," that turned it down is not the account ("**Observation of Offense:** no, verbal warning …"). Only inside
 * withoutTurnedDownName, so only right after the near-miss question, and only "no" with its own punctuation: "no call
 * no show" is an account and is never touched. "not" stays: "not following the dress code" is an account.
 */
const ACCOUNT_LEAD = /^(\*\*(?:Observation of Offense|Issue|What happened):\*\*[ \t]*)(?:no|nope|wrong)[,.;:!][ \t]*/gim;

function withoutTurnDownLead(content: string): string {
  return content.replace(ACCOUNT_LEAD, (_line, label: string) => label);
}

function withoutNameInPlan(content: string, name: string): string {
  const first = name.split(/\s+/)[0] ?? name;
  const who = new RegExp(String.raw`\b(?:${escape(name)}|${escape(first)})\b`, "g");
  return content.replace(/^\*\*Action Plan:\*\*[^\n]*$/gim, (line) =>
    line.replace(who, (_match, at: number, whole: string) => (/(?:^|[.!?]\s+|:\*\*\s*)$/.test(whole.slice(0, at)) ? "The employee" : "the employee")),
  );
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
