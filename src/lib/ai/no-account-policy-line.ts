import { noAccountNoAppPolicyEnabled } from "@/lib/config/chat-quality-flags";

import type { AskResponse } from "./types";

/**
 * ============================================================================
 * NO ACCOUNT, NO POLICY READ FROM THE REQUEST
 * (NO_ACCOUNT_NO_APP_POLICY_ENABLED, default off; QA's Sunny flip-9 live tester, 8 Nov 2026)
 * ============================================================================
 *
 * "ca for <A> not late" says only what did not happen, so the card asked "You haven't told me what happened yet"
 * (CA_ASKS_WHAT_HAPPENED, BARE_NOT_AFTER_REQUEST) and said the draft "will come back without the policy section".
 * The same card also said "**Policy:** Attendance — read from this request": AS_YOU_SAID_APP_READ's fallback took
 * the app's own policy line on the turn (the intent reader's heading for "late") as the reading, for a fault the
 * manager denied.
 *
 * With the flag on, a Corrective Action card that carries the what-happened note carries no "— read from this
 * request" Policy line. A policy the manager named ("…, as you said") is the manager's and stays. Runs after
 * `withCaWhatHappened`, outside the proposal flow; no field of the card changes. Off, the reply is as built.
 */

const ASKS_WHAT_HAPPENED = "You haven't told me what happened yet";
const APP_READ_POLICY_LINE = /^\*\*Policy:\*\*[^\n]*— read from this request\.[^\n]*$/;
const CORRECTIVE = /corrective action/i;

export function withoutNoAccountAppPolicy(response: AskResponse): AskResponse {
  if (!noAccountNoAppPolicyEnabled()) return response;
  const proposal = response.formProposal;
  if (!proposal || !(proposal.templateKey === "dpoa" || CORRECTIVE.test(proposal.templateName ?? ""))) return response;
  if (!response.content.includes(ASKS_WHAT_HAPPENED)) return response;
  const lines = response.content.split("\n");
  const kept = lines.filter((line) => !APP_READ_POLICY_LINE.test(line.trim()));
  if (kept.length === lines.length) return response;
  return { ...response, content: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim() };
}
