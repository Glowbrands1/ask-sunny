import { CA_POLICY_QUESTION, describedAttendanceKeys, policiesNamedIn, readCaPolicy } from "@/lib/forms/ca-policy";

/**
 * ============================================================================
 * A CORRECTIVE ACTION CARD THAT CITES NO POLICY ASKS WHICH ONE APPLIES
 * ============================================================================
 *
 * CA_NO_POLICY_ASKS_WHICH_ENABLED (ported from Ask Bubbles: QA's 17n live test there, 12 Nov 2026, 4a; QA's ruling). "create a corrective
 * action for <D>, he forgot to clsoe the register at night on 11/10" gave a card with no Policy line, and nothing said
 * so: the Action plan read "the applicable company policy" and no question asked which. The manual has no section for
 * forgetting to close the register, so no policy is picked (no AI-chosen Standards of Conduct: only a policy the
 * manager named or was shown keeps a tick), and the Issue keeps the manager's words as typed ("clsoe" stays).
 *
 * On: a Corrective Action card whose reply has no "**Policy:**" line and asks no policy question gets one paragraph,
 * after the Issue, opening with the policy question's marker ("Which policy applies?"), so the manager's next reply
 * naming a policy is read as its answer (`ai/form-proposal.ts`, `forms/chat-policy-change.ts`). Pure.
 */

export const NO_POLICY_NOTE = `**${CA_POLICY_QUESTION}** I didn't find a section of the policy manual for what you described, so I haven't picked one. Tell me which policy applies, or tick Type of Offense on the form — I won't pick one for you.`;

interface Card {
  readonly templateName?: string;
  readonly status?: string;
  readonly employeeName?: string | null;
}

/**
 * Gate-Bubbles on Ask Bubbles #848 (NO-GO, 12 Nov 2026), the same here: the note was also added to replies with no card
 * built yet (name asks, near-miss asks, "CA for <A> and <B>"), where no policy search had run. Only a BUILT card asks:
 * status "ready" and an employee named (this app's card has no Issue line).
 */
/**
 * Whether the card-time policy readers find a policy in the manager's words (Gate-Sunny-2 on Ask Sunny #914: "she was
 * 20 minutes late … on her phone" reads as Attendance with no Policy line shown, and must not be asked about). Any
 * reading — named, suggested, ambiguous, a missed event, cleaning, sales, Woven, or a described lateness or absence —
 * means the reader settled something, so the question is not asked.
 */
export function readerFindsPolicy(managerText: string): boolean {
  const text = managerText.trim();
  if (!text) return false;
  const reading = readCaPolicy(text);
  if (reading.stated || reading.suggestion || reading.ambiguous || reading.missedEvent || reading.other || reading.source) return true;
  if ((reading as { readFromApp?: unknown }).readFromApp) return true;
  if (describedAttendanceKeys(text)) return true;
  return text.split(/(?<=[.!?])\s+|\n+/).some((sentence) => policiesNamedIn(sentence.toLowerCase()).length > 0);
}

/**
 * The Sunny whole-pack diff (13 Nov 2026): "make a CA for <name>" and "create a ca for <name> at <salon>. verbal. no payroll
 * deduct" built a card that says "You haven't told me what happened yet" — no account, so "I didn't find a section … for
 * what you described" was false. Such a card never asks.
 */
const NO_ACCOUNT_YET = /\bhaven['’]t told me what happened\b|\bwhat happened\?/i;

/** A reply that already cites a manual page for the card has a policy. */
const CITES_MANUAL_PAGE = /JBA Policy Manual,?\s+pp?\.\s*\d/i;

export function withNoPolicyQuestion<T extends { content: string; formProposal?: Card | null }>(answer: T, managerText = ""): T {
  const card = answer.formProposal;
  if (!card || !/\bcorrective\s+action\b/i.test(card.templateName ?? "")) return answer;
  if (card.status !== "ready" || !card.employeeName?.trim()) return answer;
  if (/\*\*Policy:\*\*/.test(answer.content) || answer.content.includes(CA_POLICY_QUESTION)) return answer;
  // A card still waiting for the account ("You haven't told me what happened yet") has nothing to look a policy up for.
  if (NO_ACCOUNT_YET.test(answer.content)) return answer;
  // Only after the policy reader ran and found nothing (Gate-Sunny-2 on Ask Sunny #914).
  if (CITES_MANUAL_PAGE.test(answer.content) || readerFindsPolicy(managerText)) return answer;
  const parts = answer.content.split(/\n{2,}/);
  const issue = parts.findIndex((part) => /\*\*Issue:\*\*/.test(part));
  const at = issue >= 0 ? issue + 1 : Math.min(1, parts.length);
  return { ...answer, content: [...parts.slice(0, at), NO_POLICY_NOTE, ...parts.slice(at)].join("\n\n") };
}
