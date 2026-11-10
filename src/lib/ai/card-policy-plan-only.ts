import { cardPolicyPlanOnlyEnabled } from "@/lib/config/chat-quality-flags";

import type { AskResponse } from "./types";

/**
 * ============================================================================
 * THE ACTION PLAN AND THE SOURCES NAME ONLY THE CARD'S POLICY
 * (CARD_POLICY_PLAN_ONLY_ENABLED, default off; QA, 8 Nov 2026)
 * ============================================================================
 *
 * "put together a corrective action for <A> due to under performance in salon metrics for the month of october"
 * sometimes (3/64 before flip 7; 2/4 in QA's replays of 1f5850e6) gave "**Policy:** Standards of Conduct — …" but
 * "**Action Plan:** Management will review the Standards of Conduct and Evaluations and Raises policies with <A>",
 * with a second source, "Evaluations and Raises" p.34. A second retrieved section added itself to the plan and the
 * sources while the card cited one policy.
 *
 * With the flag on, on a Corrective Action card whose Policy line names a policy, the Action Plan's policy list,
 * the lines that are only a manual citation, and the reply's citations keep only the policy (or policies) that line
 * names. When nothing would be left, or the card has no Policy line, they stay as they were. Text-level, last on the
 * reply; no field of the card changes. Off, the reply is as built.
 */

const CORRECTIVE = /corrective action/i;
const POLICY_LINE = /^\*\*Policy:\*\*\s*(.+)$/m;
const PLAN = /(Management will review the )(.+?)( polic(?:y|ies))( with)/i;
const CITATION_ONLY_LINE = /^([^\n;*]+?), JBA Policy Manual(?: p\.\s?\d+)?\.?$/;

/** "Standards of Conduct Policy" / "the Standards of Conduct" → "standards of conduct". */
function plain(name: string): string {
  return name
    .replace(/\*\*/g, "")
    .replace(/^\s*(?:the|this reads as)\s+/i, "")
    .replace(/\s+polic(?:y|ies)\s*$/i, "")
    .trim()
    .toLowerCase();
}

/** The policy (or policies) the card's Policy line names: the words before its first " — ", "," or ".". */
function cardPolicies(content: string): string[] {
  const line = POLICY_LINE.exec(content)?.[1];
  if (!line) return [];
  const named = plain(line.replace(/^this reads as\s+/i, "").split(/\s+—\s+|,|\.\s/)[0] ?? "");
  if (!named || /^(?:none|no policy|not yet)/.test(named)) return [];
  return named.split(/\s*;\s*/).filter(Boolean);
}

function namesOnly(text: string, policies: readonly string[]): boolean {
  const said = plain(text);
  return policies.some((policy) => said === policy || said.startsWith(`${policy} `) || said.includes(policy));
}

export function withCardPolicyPlanOnly(response: AskResponse): AskResponse {
  if (!cardPolicyPlanOnlyEnabled()) return response;
  const proposal = response.formProposal;
  if (!proposal || !(proposal.templateKey === "dpoa" || CORRECTIVE.test(proposal.templateName ?? ""))) return response;
  const policies = cardPolicies(response.content);
  if (policies.length === 0) return response;

  let content = response.content.replace(PLAN, (whole, lead: string, list: string, _noun: string, tail: string) => {
    const kept = policies.filter((policy) => plain(list).includes(policy));
    if (kept.length === 0 || plain(list) === kept.join(" and ")) return whole;
    const shown = kept.map((policy) => list.match(new RegExp(policy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"))?.[0] ?? policy);
    return `${lead}${shown.join(" and ")} ${kept.length > 1 ? "policies" : "policy"}${tail}`;
  });

  const lines = content.split("\n");
  const citationLines = lines.filter((line) => CITATION_ONLY_LINE.test(line.trim()));
  if (citationLines.some((line) => namesOnly(CITATION_ONLY_LINE.exec(line.trim())![1]!, policies))) {
    content = lines
      .filter((line) => !CITATION_ONLY_LINE.test(line.trim()) || namesOnly(CITATION_ONLY_LINE.exec(line.trim())![1]!, policies))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
  }

  const citations = response.citations ?? [];
  const heading = (citation: (typeof citations)[number]) =>
    [citation.excerpt?.split(".")[0] ?? "", (citation as { section?: string | null }).section ?? "", citation.locator ?? ""].join(" ");
  const keptCitations = citations.filter((citation) => namesOnly(heading(citation), policies));
  const nextCitations = keptCitations.length > 0 ? keptCitations : citations;

  if (content === response.content && nextCitations.length === citations.length) return response;
  return { ...response, content, ...(response.citations ? { citations: nextCitations } : {}) };
}
