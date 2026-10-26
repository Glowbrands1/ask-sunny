import { coachingAsksWhatHappenedEnabled } from "@/lib/config/chat-quality-flags";
import { answeredWhatHappened, describesIncident, describesMoreThanTheRequest } from "@/lib/forms/corrective-action-intake";
import type { ChatFormProposal } from "@/types";

import { withoutStateLead } from "./remap-incident";
import type { AskRequest, AskResponse } from "./types";

/**
 * COACHING_ASKS_WHAT_HAPPENED_ENABLED (QA, 26 Oct 2026; the sibling app's
 * tester on path B, and the same here): "coaching for devon harlan" with no
 * account was answered "Everything I need is here" (or asked only the job
 * title) and never asked what happened, where a Corrective Action says "You
 * haven't told me what happened yet". A coaching card for a named person with
 * no account in the manager's turns for it now asks what happened, in the
 * same words as the Corrective Action, and no longer says everything is
 * there. It asks ONCE per card: whatever the reply ("ok", "idk", an
 * account), it is never asked again (QA-4/QA-6, 26 Oct 2026).
 *
 * WHAT COUNTS AS AN ACCOUNT, clause by clause: a clause that says what the
 * employee did. Not an account: a clause that only says what did NOT happen
 * ("she was not late", "nothing happened", "no incident", "she didn't do
 * anything wrong"), and a clause about somebody else ("rory vance was late
 * today"). A card whose turns hold only those asks.
 *
 * After the reply is built, outside the proposal flow; no field of the card
 * changes. Off, the reply is as built. The same file in both apps.
 */

const COACHING_TEMPLATES = new Set(["coaching", "follow-up-coaching"]);

/** The marker `answeredWhatHappened` reads, so the next reply is taken as the account and never asked again. */
const MARKER = "You haven't told me what happened yet";

const EVERYTHING_HERE = /^Everything I need is here, drawn from (?:your message|your messages) above\.\s*$/;

function note(name: string): string {
  return `**${MARKER}** — what did **${name}** do or not do, or what does this coaching cover? Tell me here and I'll put it on the form in your words, or create it now and fill it in yourself.`;
}

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

export function withCoachingWhatHappened(response: AskResponse, request: AskRequest): AskResponse {
  if (!coachingAsksWhatHappenedEnabled()) return response;
  return askWhatHappened(response, request.question, request.history as readonly Turn[]);
}

export function askWhatHappened(response: AskResponse, question: string, history: readonly Turn[]): AskResponse {
  const proposal = response.formProposal;
  if (!proposal || !COACHING_TEMPLATES.has(proposal.templateKey) || proposal.subject === "team") return response;
  const name = proposal.employeeName?.trim();
  if (!name || response.content.includes(MARKER)) return response;
  const turns = turnsForThisForm(history, proposal.templateKey);
  // Once per card: asked before, never again, whatever the reply.
  if (turns.some((turn) => turn.role === "assistant" && turn.content.includes(MARKER))) return response;
  // The intent read's own sentences in front of a turn ("Incident: …") are not the manager's account.
  const said = [...turns.filter((turn) => turn.role === "user").map((turn) => turn.content), question].map(withoutStateLead).join("\n");
  const ignore = [name, proposal.employeeRole ?? "", proposal.locationName ?? ""];
  if (hasAccount(said, name, ignore)) return response;
  if (answeredWhatHappened([...history, { role: "user", content: question }])) return response;
  const lines = response.content.split("\n").filter((line) => !EVERYTHING_HERE.test(line.trim()));
  // Second, after the card's opening line, as the Corrective Action says it.
  const at = Math.min(1, lines.length);
  lines.splice(at, 0, "", note(name));
  return { ...response, content: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() };
}
