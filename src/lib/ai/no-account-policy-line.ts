import { noAccountNoAppPolicyEnabled } from "@/lib/config/chat-quality-flags";

import type { AskResponse } from "./types";

/**
 * ============================================================================
 * NO ACCOUNT, NO POLICY CITED ON THE CARD
 * (NO_ACCOUNT_NO_APP_POLICY_ENABLED, default off; QA's Sunny flip-9 live tester, 8 Nov 2026)
 * ============================================================================
 *
 * "ca for <A> not late" says only what did not happen, so the card asked "You haven't told me what happened yet"
 * (CA_ASKS_WHAT_HAPPENED, BARE_NOT_AFTER_REQUEST) and said "I can't cite the policy manual — the draft will come back
 * without the policy section and page". The same card cited Attendance three times:
 *   - "**Policy:** Attendance — read from this request": AS_YOU_SAID_APP_READ's fallback took the app's own policy
 *     line on the turn (the intent reader's heading for "late") as the reading, for a fault the manager denied;
 *   - "Attendance Policy, JBA Policy Manual p.14": the section retrieval found for "late";
 *   - "**Action Plan:** Management will review the Attendance policy with <first>.": built from that citation.
 *
 * QA's rule (8 Nov 2026): no account, so no policy is cited anywhere on that card; a policy the manager named stays.
 * With the flag on, a Corrective Action card that carries the what-happened note and no Policy line the manager
 * named ("…, as you said") loses the read-from-request Policy line, any line that is only a manual citation, and the
 * reply's citations; its Action Plan names "the applicable company policy" instead. Runs after `withCaWhatHappened`,
 * outside the proposal flow; no field of the card changes. Off, the reply is as built.
 */

const ASKS_WHAT_HAPPENED = "You haven't told me what happened yet";
const APP_READ_POLICY_LINE = /^\*\*Policy:\*\*[^\n]*— read from this request\.[^\n]*$/;
/** The manager named the policy: the reading is theirs, and so are the citation and the plan. */
const MANAGER_NAMED_POLICY_LINE = /^\*\*Policy:\*\*[^\n]*, as you said\b/m;
/** "Attendance Policy, JBA Policy Manual p.14" — one or more, separated by "; " — and nothing else on the line. */
const CITATION = String.raw`[^\n;*]+, JBA Policy Manual(?: p\.\s?\d+)?`;
const CITATION_ONLY_LINE = new RegExp(String.raw`^${CITATION}(?:;\s*${CITATION})*\.?$`);
/** "Management will review the Attendance policy with" → "the applicable company policy". */
const PLAN_NAMES_POLICY = /(\*\*Action Plan:\*\*[^\n]*?Management will review the )(?!applicable company policy\b)(.+?)( polic(?:y|ies))( with)/i;
const CORRECTIVE = /corrective action/i;

export function withoutNoAccountAppPolicy(response: AskResponse): AskResponse {
  if (!noAccountNoAppPolicyEnabled()) return response;
  const proposal = response.formProposal;
  if (!proposal || !(proposal.templateKey === "dpoa" || CORRECTIVE.test(proposal.templateName ?? ""))) return response;
  if (!response.content.includes(ASKS_WHAT_HAPPENED) || MANAGER_NAMED_POLICY_LINE.test(response.content)) return response;
  const kept = response.content
    .split("\n")
    .filter((line) => !APP_READ_POLICY_LINE.test(line.trim()) && !CITATION_ONLY_LINE.test(line.trim()))
    .join("\n")
    .replace(PLAN_NAMES_POLICY, "$1applicable company policy$4")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const citations = response.citations ?? [];
  if (kept === response.content.trim() && citations.length === 0) return response;
  return { ...response, content: kept, citations: [] };
}
