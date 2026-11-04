import { caSalesPolicyEnabled } from "@/lib/config/chat-quality-flags";

import { isSalesPolicyReading, STANDARDS_OF_CONDUCT, type CaPolicyReading } from "./ca-policy";
import { managerIssueWords } from "./other-write-in";

/**
 * ============================================================================
 * THE STANDARDS OF CONDUCT NEEDS A REASON IN THE MANAGER'S WORDS
 * (CA_SALES_POLICY_ENABLED, default off; Pau, 4 Nov 2026, 16:50 UTC)
 * ============================================================================
 *
 * "make a corrective action for <name>, the bathrooms were left dirty at
 * close" came back with Standards of Conduct ticked and cited (p.12, "Failing
 * to follow the policies and procedures"): the drafting model reads cleaning
 * as unfinished assigned work, and revision 7 left the Standards of Conduct
 * as the only conduct box. Pau: a cleaning Corrective Action does not cite
 * the Standards of Conduct by default.
 *
 * So, with the flag on, a Standards of Conduct tick stands only on a reason
 * the existing readers find in the manager's words:
 *   - a policy the manager named, the card's section, or a manual section
 *     their account describes (`stated`, passed by the route);
 *   - the sales / MSB reading (`isSalesPolicyReading`);
 *   - a conduct topic other than the general "task" one (a direction not
 *     followed, a deadline, cash, an acknowledgement — `readCaPolicy`).
 * The general "task" suggestion ("did not complete daily cleaning duties") is
 * no reason here, as it is none for the chat offer and card (sf-s15). Without
 * a reason the tick moves to Other, with what happened in the manager's own
 * words beside it (`managerIssueWords`), so Policy Violated cites no Standards
 * of Conduct. The prompt is unchanged. Off, or on a version with no Other box,
 * nothing changes.
 */

const OTHER = "other";
const OTHER_WRITE_IN = "other_offense";

/** True when the manager's words give the Standards of Conduct a reason. */
export function conductHasReason(reading: CaPolicyReading, stated: boolean): boolean {
  return stated || isSalesPolicyReading(reading) || reading.topics.some((topic) => topic !== "task");
}

/**
 * The draft with an unreasoned Standards of Conduct tick moved to Other, or
 * null when nothing changes.
 */
export function withoutUnreasonedConduct<T extends { values: Record<string, string>; checked: Record<string, string[]> }>(input: {
  readonly draft: T;
  readonly reading: CaPolicyReading | null;
  readonly stated: boolean;
  readonly offered: readonly string[];
  readonly notes: string;
}): T | null {
  if (!caSalesPolicyEnabled() || !input.reading) return null;
  const ticked = input.draft.checked.offense_type ?? [];
  if (!ticked.includes(STANDARDS_OF_CONDUCT) || !input.offered.includes(OTHER)) return null;
  if (conductHasReason(input.reading, input.stated)) return null;
  const rest = ticked.filter((key) => key !== STANDARDS_OF_CONDUCT);
  const words = managerIssueWords(input.notes);
  const written = (input.draft.values[OTHER_WRITE_IN] ?? "").trim() !== "";
  return {
    ...input.draft,
    checked: { ...input.draft.checked, offense_type: rest.includes(OTHER) ? rest : [...rest, OTHER] },
    values: words && !written ? { ...input.draft.values, [OTHER_WRITE_IN]: words } : input.draft.values,
  };
}
