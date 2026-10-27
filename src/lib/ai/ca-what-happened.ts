import { caAsksWhatHappenedEnabled } from "@/lib/config/chat-quality-flags";
import {
  NO_INCIDENT_NOTE,
  answeredWhatHappened,
  describesIncident,
  describesMoreThanTheRequest,
} from "@/lib/forms/corrective-action-intake";
import type { ChatFormProposal } from "@/types";

import type { AskRequest, AskResponse } from "./types";

/**
 * CA_ASKS_WHAT_HAPPENED_ENABLED (QA P1, 26 Oct 2026; the meeting complaint):
 * "create corrective action form for <name>, Salon Director" / "<name>, Salon
 * Director" gave no account, yet the Corrective Action card said "I'll draft
 * a Corrective Action Form … from what you've described" and asked only the
 * payroll question; the draft came back with no policy (and, before
 * JOB_TITLE_NOT_INCIDENT, the job title as what happened). The card's own
 * "You haven't told me what happened yet" note did not show: the protected
 * proposal reader counts the title as an account. With the flag on, a
 * Corrective Action card for a named person with no account in the manager's
 * turns for it carries that note (the same words), once per card. The
 * account test is the coaching card's (`coaching-what-happened.ts`, the
 * sibling PR): a clause that says what the employee did, not only what did
 * not happen, and not about somebody else; the person's name, job title and
 * salon are not an account.
 *
 * After the reply is built, outside the proposal flow; no field of the card
 * changes. Off, the reply is as built.
 */

const CORRECTIVE = /corrective action/i;

/** The sentences the intent read writes in front of a turn ("The employee is ….", "Incident: …."): the app's, not the manager's. */
const STATE_LEAD =
  /^\s*(?:(?:The form is the|The employee is|Job title:|It happened at|It happened on|Warning level:|Payroll amount:|Policy reference:|Incident:|The account continues)[^\n]*?\.(?=\s|$)\s*|(?:Payroll deduct applies|No payroll deduction)\.\s*)+/i;

function withoutStateLead(turn: string): string {
  return turn.replace(STATE_LEAD, "");
}

/** The marker `answeredWhatHappened` reads, so the next reply is taken as the account and never asked again. */
const MARKER = "You haven't told me what happened yet";

interface Turn {
  readonly role: string;
  readonly content: string;
  readonly formProposal?: ChatFormProposal | null;
}

/** The manager's turns for this form: after the last card for a different form. */
function turnsForThisForm(history: readonly Turn[], templateKey: string): readonly Turn[] {
  let start = 0;
  for (const [index, turn] of history.entries()) {
    const key = turn.role === "assistant" ? turn.formProposal?.templateKey : null;
    if (key && key !== templateKey) start = index + 1;
  }
  return history.slice(start);
}

/** Only what did not happen: "she was not late", "nothing happened", "no incident", "she didn't do anything wrong". */
const NEGATED = /\b(?:not|never|nothing|no\s+(?:incident|issue|problems?|concerns?))\b|n['’]t\b/i;

const NOT_A_PERSON = new Set(["she", "he", "they", "the", "a", "an", "her", "his", "their", "our", "my", "this", "that", "it", "i", "we", "you", "and", "also", "then"]);

/** "rory vance was late today": somebody else did it. */
function aboutSomebodyElse(clause: string, name: string): boolean {
  const said = /^([a-z'’-]+)\s+([a-z'’-]+)\s+(?:was|is|were|did|didn['’]?t|has|had|left|came|showed|missed|skipped|forgot|called|got|took|clocked)\b/i.exec(clause.trim());
  if (!said) return false;
  const own = new Set(name.toLowerCase().split(/\s+/));
  const words = [said[1]!.toLowerCase(), said[2]!.toLowerCase()];
  return !words.some((word) => NOT_A_PERSON.has(word) || own.has(word));
}

/** A clause that says what this employee did. */
function hasAccount(said: string, name: string, ignore: readonly string[]): boolean {
  return said
    .split(/[\n.;,]+|\s+and\s+/i)
    .map((clause) => clause.trim())
    .filter(Boolean)
    .some(
      (clause) =>
        !NEGATED.test(clause) &&
        !aboutSomebodyElse(clause, name) &&
        (describesIncident(clause) || describesMoreThanTheRequest(clause, { ignore })),
    );
}

export function withCaWhatHappened(response: AskResponse, request: AskRequest): AskResponse {
  if (!caAsksWhatHappenedEnabled()) return response;
  return askCaWhatHappened(response, request.question, request.history as readonly Turn[]);
}

export function askCaWhatHappened(response: AskResponse, question: string, history: readonly Turn[]): AskResponse {
  const proposal = response.formProposal;
  if (!proposal || !(proposal.templateKey === "dpoa" || CORRECTIVE.test(proposal.templateName ?? ""))) return response;
  const name = proposal.employeeName?.trim();
  if (!name || response.content.includes(MARKER)) return response;
  const turns = turnsForThisForm(history, proposal.templateKey);
  // Once per card: asked before, never again, whatever the reply.
  if (turns.some((turn) => turn.role === "assistant" && turn.content.includes(MARKER))) return response;
  const said = [...turns.filter((turn) => turn.role === "user").map((turn) => turn.content), question].map(withoutStateLead).join("\n");
  const ignore = [name, proposal.employeeRole ?? "", proposal.locationName ?? ""];
  if (hasAccount(said, name, ignore)) return response;
  if (answeredWhatHappened([...history, { role: "user", content: question }])) return response;
  const lines = response.content.split("\n");
  // Second, after the card's opening line, where the card puts it on a name alone.
  lines.splice(Math.min(1, lines.length), 0, "", NO_INCIDENT_NOTE);
  return { ...response, content: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() };
}
