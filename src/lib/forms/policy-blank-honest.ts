import type { AskResponse, OpenFormSummary } from "@/lib/ai/types";
import { policyBlankHonestReplyEnabled } from "@/lib/config/chat-quality-flags";

/**
 * ============================================================================
 * A BLANK POLICY IS NEVER CALLED QUOTED OR CHECKED (POLICY_BLANK_HONEST_REPLY_ENABLED, default off)
 * ============================================================================
 *
 * QA's live round-24 test, 11 Nov 2026 (conv_mwbbelez2wy6r5j; the person invented here): a Corrective Action draft
 * named "Attendance Policy, JBA Policy Manual p.14" and its Direct policy field was blank.
 *
 *   "did you check the policy on this form?"  → "Yes — the policy on the form is the Attendance Policy, which I pulled from
 *                                               the current manual: … That's the section quoted on <A>'s draft."
 *   "is the policy verified?"                 → "**Nothing on the form has changed yet.** Say **make that update** …"
 *
 * The draft quotes nothing. With the flag on, while the open draft has an EMPTY policy text field:
 *
 *   A QUESTION WHETHER THE POLICY WAS CHECKED OR VERIFIED is answered from the form, in plain words, never as an edit:
 *   the field is empty, nothing from the manual is quoted on it, and the policy the form only names; how to have it
 *   quoted.
 *   ANY OTHER ANSWER loses a line that says a section is quoted on the draft or was pulled from the manual for it, and
 *   says what is true instead.
 *
 * Pure apart from the flag; the route passes the open form's summary (`open-form-summary.ts`).
 */

const POLICY_WORD = String.raw`(?:the\s+|this\s+|that\s+|my\s+|its\s+)?(?:direct\s+)?polic(?:y|ies)(?:\s+(?:on|in)\s+(?:the|this|my)\s+(?:form|draft|card|ca))?`;
const CHECK_WORD = String.raw`(?:check(?:ed)?|verif(?:y|ied)|confirm(?:ed)?|validat(?:e|ed)|correct|right|accurate|from\s+the\s+manual)`;

/** "did you check the policy on this form?", "is the policy verified?", "was the policy checked", "is it verified". */
export function asksPolicyChecked(question: string): boolean {
  const text = question.trim().toLowerCase().replace(/[?.!]+$/, "");
  if (text.length > 160) return false;
  return (
    new RegExp(String.raw`^(?:so\s+|and\s+|ok(?:ay)?\s+)?(?:did|have|has|do)\s+(?:you|it|they|ask sunny|ask bubbles|someone)\s+(?:already\s+)?${CHECK_WORD}\s+${POLICY_WORD}\b`).test(text) ||
    new RegExp(String.raw`^(?:so\s+|and\s+|ok(?:ay)?\s+)?(?:is|was|are|were|has|have)\s+${POLICY_WORD}\s+(?:been\s+)?${CHECK_WORD}\b`).test(text) ||
    /^(?:so\s+|and\s+)?(?:is|was)\s+(?:it|that)\s+(?:been\s+)?(?:checked|verified|confirmed)$/.test(text)
  );
}

/** A line claiming the policy text is ON the draft, or was taken from the manual for it. */
const QUOTED_CLAIM =
  /\b(?:section|policy|wording|text|language)\s+(?:is\s+|was\s+|that'?s\s+)?quoted\b|\bquoted\s+(?:it\s+)?(?:on|onto|in)\s+(?:the|this|her|his|their|\w+'s)\s+(?:draft|form|card)\b|\bthe\s+section\s+quoted\b|\bpulled\s+(?:it\s+|that\s+)?from\s+the\s+(?:current\s+|official\s+)?(?:policy\s+)?manual\b|\b(?:is|was|has\s+been)\s+(?:checked|verified|confirmed)\s+against\s+the\s+(?:official\s+)?manual\b/i;

function emptyStatement(open: OpenFormSummary): string {
  const empty = open.emptyPolicy!;
  const fields = empty.labels.map((label) => `**${label}**`).join(" and ");
  const named = empty.policyNamed ? ` The form names **${empty.policyNamed}**, but its wording is not on the draft.` : "";
  return `No. The ${fields} field on ${open.employeeName}'s ${open.templateName} is empty, so nothing from the manual is quoted on it and nothing on it was checked.${named}`;
}

function howToQuote(open: OpenFormSummary): string {
  const name = open.emptyPolicy?.policyNamed?.replace(/,.*$/, "").replace(/\s+policy$/i, "").trim();
  return name
    ? `To have it quoted word for word, say "add the ${name} policy", or type it on the card and press **Save changes**.`
    : `To have a policy quoted word for word, name its section — for example "add the Attendance policy" — or type it on the card and press **Save changes**.`;
}

/** The answer with the blank policy said truthfully; the answer unchanged when there is nothing to correct. */
export function withBlankPolicyHonesty<T extends AskResponse>(answer: T, open: OpenFormSummary | null, question: string): { answer: T; handled: boolean } {
  if (!policyBlankHonestReplyEnabled() || !open || open.status !== "draft" || !open.emptyPolicy) return { answer, handled: false };
  if (asksPolicyChecked(question)) {
    return { answer: { ...answer, content: `${emptyStatement(open)}\n\n${howToQuote(open)}`, citations: [] }, handled: true };
  }
  const lines = answer.content.split("\n");
  if (!lines.some((line) => QUOTED_CLAIM.test(line))) return { answer, handled: false };
  const kept = lines.filter((line) => !QUOTED_CLAIM.test(line)).join("\n").trim();
  const fields = open.emptyPolicy.labels.map((label) => `**${label}**`).join(" and ");
  const truth = `The ${fields} field on the draft is empty: nothing from the manual is quoted on it yet. ${howToQuote(open)}`;
  return { answer: { ...answer, content: [kept, truth].filter(Boolean).join("\n\n") }, handled: true };
}
