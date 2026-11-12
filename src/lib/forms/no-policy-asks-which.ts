import { CA_POLICY_QUESTION } from "@/lib/forms/ca-policy";

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

export function withNoPolicyQuestion<T extends { content: string; formProposal?: { templateName?: string } | null }>(answer: T): T {
  const card = answer.formProposal;
  if (!card || !/\bcorrective\s+action\b/i.test(card.templateName ?? "")) return answer;
  if (/\*\*Policy:\*\*/.test(answer.content) || answer.content.includes(CA_POLICY_QUESTION)) return answer;
  const parts = answer.content.split(/\n{2,}/);
  const issue = parts.findIndex((part) => /\*\*Issue:\*\*/.test(part));
  const at = issue >= 0 ? issue + 1 : Math.min(1, parts.length);
  return { ...answer, content: [...parts.slice(0, at), NO_POLICY_NOTE, ...parts.slice(at)].join("\n\n") };
}
