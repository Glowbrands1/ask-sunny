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
 * On: the request turn's account stands; a later turn counts only when the
 * request told nothing, and never pasted policy text. A turn that edits the
 * Observation ("change observation of offense to: …") is always kept for the
 * edit rules. "<place>, <state>" is read without the comma. Which clauses of
 * a kept turn are the account is not changed here. Off, every turn is passed
 * on as it is.
 *
 * The same rule as Ask Bubbles' `forms/incident-issue.ts`.
 */

const STATE_AFTER_PLACE = /\b([A-Za-z][\w'-]*),\s*(ne|ks|mo|ia|sd|nd|mn|wi|il|tx)\b/gi;
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
    if (told) return false;
    return !POLICY_TEXT.test(turn);
  });
}
