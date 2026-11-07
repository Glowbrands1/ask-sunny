import { underPerformanceExplainedEnabled } from "@/lib/config/chat-quality-flags";

import type { AskRequest, AskResponse } from "./types";

/**
 * ============================================================================
 * UNDER PERFORMANCE ASKED FOR, THE STANDARDS OF CONDUCT CITED: SAY WHY
 * (UNDER_PERFORMANCE_EXPLAINED_ENABLED, default off; Pau, 6 Nov 2026)
 * ============================================================================
 *
 * The Sunny tester, after the flip: "it should be under performance not
 * standard of conduct". The Corrective Action Form has no Under Performance
 * box (revision 7), and CA_SALES_POLICY cites the Standards of Conduct for
 * sales performance, but the reply never said so. With the flag on, when the
 * manager's message names Under Performance and the finished reply's card
 * cites the Standards of Conduct, Pau's line is added once, after the Policy
 * line. A code line on the finished reply; no prompt changes. Off, untouched.
 */
export const UNDER_PERFORMANCE_EXPLAINED = "Under Performance isn't on the CA form. Sales performance CAs use the Standards of Conduct.";

const NAMES_UNDER_PERFORMANCE = /\bunder[- ]?perform(?:ance|ing)\b/i;
const CITES_CONDUCT = /^\*\*Policy:\*\* Standards of Conduct\b.*$/m;

export function withUnderPerformanceExplained(response: AskResponse, request: Pick<AskRequest, "question">): AskResponse {
  if (!underPerformanceExplainedEnabled()) return response;
  if (response.formProposal?.templateKey !== "dpoa" || !NAMES_UNDER_PERFORMANCE.test(request.question)) return response;
  if (response.content.includes(UNDER_PERFORMANCE_EXPLAINED)) return response;
  const policy = CITES_CONDUCT.exec(response.content);
  if (!policy) return response;
  const at = policy.index + policy[0].length;
  return { ...response, content: `${response.content.slice(0, at)}\n\n${UNDER_PERFORMANCE_EXPLAINED}${response.content.slice(at)}` };
}
