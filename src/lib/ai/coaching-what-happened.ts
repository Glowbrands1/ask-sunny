import { coachingAsksWhatHappenedEnabled } from "@/lib/config/chat-quality-flags";
import { answeredWhatHappened, describesIncident, describesMoreThanTheRequest } from "@/lib/forms/corrective-action-intake";
import type { ChatFormProposal } from "@/types";

import type { AskRequest, AskResponse } from "./types";

/**
 * COACHING_ASKS_WHAT_HAPPENED_ENABLED (QA, 26 Oct 2026; the sibling app's
 * tester on path B, and the same here): "coaching for devon harlan" with no
 * account was answered "Everything I need is here" (or asked only the job
 * title) and never asked what happened, where a Corrective Action says "You
 * haven't told me what happened yet". A coaching card for a named person with
 * no account in the manager's turns for it now asks what happened, in the
 * same words as the Corrective Action, and no longer says everything is
 * there. An account in any words, or an answer to the question, ends it.
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
function turnsForThisForm(history: readonly Turn[], question: string, templateKey: string): string[] {
  let start = 0;
  for (const [index, turn] of history.entries()) {
    const key = turn.role === "assistant" ? turn.formProposal?.templateKey : null;
    if (key && key !== templateKey) start = index + 1;
  }
  return [...history.slice(start).filter((turn) => turn.role === "user").map((turn) => turn.content), question];
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
  const said = turnsForThisForm(history, question, proposal.templateKey).join("\n");
  const ignore = [name, proposal.employeeRole ?? "", proposal.locationName ?? ""];
  if (describesIncident(said) || describesMoreThanTheRequest(said, { ignore })) return response;
  if (answeredWhatHappened([...history, { role: "user", content: question }])) return response;
  const lines = response.content.split("\n").filter((line) => !EVERYTHING_HERE.test(line.trim()));
  // Second, after the card's opening line, as the Corrective Action says it.
  const at = Math.min(1, lines.length);
  lines.splice(at, 0, "", note(name));
  return { ...response, content: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() };
}
