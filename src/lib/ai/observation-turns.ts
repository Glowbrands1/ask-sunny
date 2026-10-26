import { incidentSplitFixEnabled } from "@/lib/config/chat-quality-flags";

import { readTurnEdit } from "./edit-date-rules";
import { accountSentences } from "./remap-incident";

/**
 * INCIDENT_SPLIT_FIX_ENABLED: which manager turns the Observation of Offense
 * is read from.
 *
 * QA, 25 Oct 2026 (Ask Bubbles' Issue had it; the same reading here): after
 * the request gave the account, a later "Policy violated: Standards of
 * Conduct", a one-line correction ("not attendance, late opening") or a
 * pasted policy paragraph ("The employee who failed to open will then be
 * required to reimburse The Company $25") was added to the Observation as if
 * it were the incident; and "she works at our kearney, ne salon" was cut at
 * the comma, so "ne salon as a tc and was late today" became the account.
 *
 * On: pasted policy text never counts; once the request gave the account, a
 * short correction of what the form is about ("not attendance, late opening")
 * does not count either; any other later turn adds to the account as on main. A turn that edits the
 * Observation ("change observation of offense to: …") is always kept for the
 * edit rules. "<place>, <state>" before a word is read without the comma. Which clauses of
 * a kept turn are the account is not changed here. Off, every turn is passed
 * on as it is.
 *
 * The same rule as Ask Bubbles' `forms/incident-issue.ts`.
 */

const STATE_AFTER_PLACE = /\b([A-Za-z][\w'-]*),\s*(ne|ks|mo|ia|sd|nd|mn|wi|il|tx)\b(?=\s+[A-Za-z])/gi;
/** A short correction of what the form is about: "not attendance, late opening". */
const CORRECTION = /^\s*(?:no[,.]?\s+|actually,?\s+)?not\s+[\w\s'-]{1,30},\s*[\w\s'-]{1,40}[.!]?\s*$/i;
const CREATE_REQUEST =
  /\b(?:create|make|need|needs|draft|write|do|start|prepare|issue|give)\b[^.]*?\b(?:ca|c\/a|dpoa|corrective\s+action|write[- ]?up|warning|coaching(?:\s+(?:form|document))?)\b/i;
const POLICY_TEXT =
  /^(?:policy(?:\s+violated)?|issue|section|direct\s+policy|violation\s+of\s+company\s+policies)\s*:|\bthe\s+company\b|\bemployees?\s+(?:must|shall|will\s+be|are|is)\s+(?:required|expected|not\s+allowed)|\bwho\s+failed\s+to\s+open\s+will\b/i;

export function observationTurns(turns: readonly string[], employeeName: string | null): readonly string[] {
  if (!incidentSplitFixEnabled()) return turns;
  const unsplit = turns.map((turn) => turn.replace(STATE_AFTER_PLACE, "$1 $2"));
  let start = 0;
  for (let index = unsplit.length - 1; index >= 0; index -= 1) {
    if (CREATE_REQUEST.test(unsplit[index]!)) {
      start = index;
      break;
    }
  }
  const told = accountSentences([unsplit[start]!], employeeName).length > 0;
  return unsplit.filter((turn, index) => {
    if (index <= start) return true;
    if (readTurnEdit(turn)) return true;
    if (POLICY_TEXT.test(turn)) return false;
    // A later fact ("i will listen to at least 10 check-ins …") still adds to the account.
    return !(told && CORRECTION.test(turn));
  });
}
