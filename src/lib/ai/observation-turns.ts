import { incidentSplitFixEnabled } from "@/lib/config/chat-quality-flags";

import { withoutAppLines } from "./app-sentences";
import { readTurnEdit } from "./edit-date-rules";
import { accountSentences } from "./remap-incident";

/**
 * INCIDENT_SPLIT_FIX_ENABLED: which manager turns the Observation of Offense
 * is read from (QA's October triage of #257, 10 Nov 2026).
 *
 * After the request gave the account ("create a ca for <name>. on 10-21-26
 * <first> opened the salon 20 minutes late."), a later one-line correction of
 * what the form is about ("not attendance, late opening") or a pasted policy
 * paragraph ("… The employee who failed to open will then be required to
 * reimburse The Company $25") was added to the Observation as if it were the
 * incident.
 *
 * On: pasted policy text never counts; once the request turn gave the
 * account, a short "not X, Y" correction does not count either; any other
 * later turn adds to the account as before ("i will listen to at least 10
 * check-ins on the next shift we overlap."). A turn that edits the Observation
 * ("change observation of offense to: …") is always kept for the edit rules.
 * Which clauses of a kept turn are the account is not changed here. Off,
 * every turn is passed on as it is.
 */

/** A short correction of what the form is about: "not attendance, late opening". */
const CORRECTION = /^\s*(?:no[,.]?\s+|actually,?\s+)?not\s+[\w\s'-]{1,30},\s*[\w\s'-]{1,40}[.!]?\s*$/i;
const CREATE_REQUEST =
  /\b(?:create|make|need|needs|draft|write|do|start|prepare|issue|give)\b[^.]*?\b(?:ca|c\/a|dpoa|corrective\s+action|write[- ]?up|warning|coaching(?:\s+(?:form|document))?)\b/i;
const POLICY_TEXT =
  /^(?:policy(?:\s+violated)?|issue|section|direct\s+policy|violation\s+of\s+company\s+policies)\s*:|\bthe\s+company\b|\bemployees?\s+(?:must|shall|will\s+be|are|is)\s+(?:required|expected|not\s+allowed)|\bwho\s+failed\s+to\s+open\s+will\b/i;

export function observationTurns(turns: readonly string[], employeeName: string | null): readonly string[] {
  if (!incidentSplitFixEnabled()) return turns;
  // The intent read writes its own lines ("The form is …", "Incident: Late Opening.") in front of a turn; only the manager's words are read.
  const own = turns.map((turn) => withoutAppLines(turn).trim());
  let start = 0;
  for (let index = own.length - 1; index >= 0; index -= 1) {
    if (CREATE_REQUEST.test(own[index]!)) {
      start = index;
      break;
    }
  }
  const told = own.length > 0 && accountSentences([own[start]!], employeeName).length > 0;
  return turns.filter((turn, index) => {
    if (index <= start) return true;
    if (readTurnEdit(turn)) return true;
    if (POLICY_TEXT.test(own[index]!)) return false;
    // A later fact ("i will listen to at least 10 check-ins …") still adds to the account.
    return !(told && CORRECTION.test(own[index]!));
  });
}
