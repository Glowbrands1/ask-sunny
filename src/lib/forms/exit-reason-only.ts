import { readExitDetails, type YesNo } from "./exit-details";

/**
 * ============================================================================
 * AN EXIT FORM'S REASON LINE IS ONLY THE REASON
 * ============================================================================
 *
 * QA's f077 (20 Nov 2026; #1139 live): the reason line saved "job abandonment; last day 11/18, notice given 11/17". The
 * dates have their own fields, so a part of the account that only names one of them is not the reason.
 * QA2's live R3 (21 Nov 2026, #1174's case): "terminated for job abandonment; not eligible for rehire." The rehire answer
 * has its own question, so a part the exit form's own reader (`readExitDetails`) reads as a rehire answer leaves the
 * reason and is returned as that answer. Read from the loop card's account (checked against the manager's words). Pure.
 */
const EXIT_DATE_PART = /^(?:(?:her|his|their|the)\s+)?(?:last\s+day(?:\s+worked)?|notice(?:\s+(?:given|date|fulfilled))?|date\s+(?:of\s+)?notice(?:\s+was\s+given)?|effective(?:\s+date)?|termination\s+date)\s*(?:was|is|on|of|:)?\s*\d{1,2}\/\d{1,2}(?:\/\d{2,4})?$/i;

export function exitReasonOnly(account: string, today: string): { reason: string; rehire: YesNo | null } {
  const parts = account.split(/[;,.]\s*/).map((part) => part.trim()).filter(Boolean);
  let rehire: YesNo | null = null;
  const kept = parts.filter((part) => {
    if (EXIT_DATE_PART.test(part)) return false;
    const answer = readExitDetails(part, today).answers.eligible_for_rehire;
    if (!answer) return true;
    rehire = answer;
    return false;
  });
  if (kept.length === 0 || kept.length === parts.length) return { reason: account, rehire: kept.length === 0 ? null : rehire };
  const reason = kept.join("; ");
  return { reason: /[.!?]$/.test(reason) ? reason : `${reason}.`, rehire };
}
