import { priorActionsRetainedEnabled } from "@/lib/config/chat-quality-flags";
import { statedPriorActions } from "@/lib/forms/prior-actions";
import { extractEmployeeNames } from "@/lib/forms/proposal";
import { detectTemplateIntent } from "@/lib/forms/template-intent";

import { currentRequestTurns, priorShorthand } from "./remap-incident";
import type { AskResponse } from "./types";

/**
 * ============================================================================
 * PRIOR_ACTIONS_RETAINED_ENABLED — THE PRIORS STAY THROUGH A SLOT ANSWER
 * ============================================================================
 *
 * Sunny tester, 26 Oct 2026, 18 live runs (conv_mvopmg322bsgexf):
 *
 *   T1 "create a verbal corrective action for mara quill for missing the
 *       10-15-26 woven deadline"
 *   T2 "prior coaching JBA Policy Manual 7-29-26"  → "Prior actions: Coaching
 *       — JBA Policy Manual — 07/29/2026, as you said"
 *   T3 "no payroll deduct"  → the Prior actions line was gone, and the reply
 *       said "You'll set any prior coaching or corrective action on the form
 *       — I won't guess at it."
 *
 * The intent read puts the stored slots ahead of each turn ("The form is the
 * Corrective Action Form. The employee is mara quill. … Policy reference:
 * Standards of Conduct, JBA Policy Manual p.12."). The proposal reads that as
 * a new request for this employee that says more than the request, so this
 * form's turns start again at the latest one, and the prior actions are read
 * from "no payroll deduct" alone. The stored slots carry no prior actions.
 *
 * On, a Corrective Action card that lists no prior actions gets back the ones
 * the manager stated earlier for this form, read from the manager's own turns
 * (never the app's lines): the same "Prior actions: …, as you said" line, and
 * the turns they were stated in go back on the card's sources, so Create lists
 * them on the form too. A turn that says "no prior coaching" or "remove the
 * prior" clears what was said before it. A turn that states priors itself is
 * read as before. A later request for another employee, or a new request with
 * its own incident, starts a new form, and the priors before it are not this
 * one's. Off, the response is returned unchanged.
 */

/** "no prior coaching", "remove the prior", "take off the previous actions". */
const REMOVES_PRIOR =
  /\b(?:no|not\s+any|without|remove|delete|drop|clear|erase|scratch|strike|forget|ignore|take\s+(?:off|out|away))\s+(?:the\s+|any\s+|all\s+|her\s+|his\s+|their\s+|that\s+|those\s+)?(?:prior|previous|past|earlier)\b/gi;

const PRIOR_LINE = /\*\*Prior actions:\*\*/i;
const PRIORS_ONLY_HOLD = /^You'll set any prior coaching or corrective action on the form — I won't guess at it\.$/;
const BOTH_HOLD =
  /^You'll set the verbal\/written warning level and any prior coaching or corrective action on the form — I won't guess at them\.$/;
const LEVEL_ONLY_HOLD = "You'll set the verbal/written warning level on the form — I won't guess at it.";

interface Turn {
  readonly id?: string;
  readonly role: string;
  readonly content: string;
}

export function withRetainedPriorActions(
  response: AskResponse,
  input: { readonly question: string; readonly questionMessageId?: string; readonly history: readonly Turn[]; readonly today: string },
): AskResponse {
  if (!priorActionsRetainedEnabled()) return response;
  const proposal = response.formProposal;
  if (!proposal || proposal.templateKey !== "dpoa" || !proposal.employeeName) return response;
  if (PRIOR_LINE.test(response.content)) return response;

  const turns: Turn[] = [
    ...input.history.filter((turn) => turn.role === "user" && turn.content.trim() !== ""),
    { id: input.questionMessageId, role: "user", content: input.question },
  ];
  const start = Math.max(
    turns.length - currentRequestTurns(turns.map((turn) => turn.content), proposal.employeeName).length,
    afterRequestForSomebodyElse(turns, proposal.employeeName),
  );

  /* What each turn of this form says of the priors, from the last "no prior …" on. */
  let said: { turn: Turn; text: string }[] = [];
  for (const turn of turns.slice(start)) {
    const removals = [...turn.content.matchAll(REMOVES_PRIOR)];
    const last = removals.at(-1);
    if (last) said = [];
    const text = last ? turn.content.slice(last.index + last[0].length) : turn.content;
    said.push({ turn, text });
  }
  const priors = statedPriorActions(priorShorthand(said.map((item) => item.text).join("\n")), input.today);
  if (priors.length === 0) return response;

  const line = `**Prior actions:** ${priors.join("; ")}, as you said. I'll list ${priors.length === 1 ? "it" : "them"} on the form — tell me if that should change.`;
  const sources = said
    .filter((item) => item.turn.id && statedPriorActions(priorShorthand(item.text), input.today).length > 0)
    .map((item) => item.turn.id!);
  return {
    ...response,
    content: withPriorLine(response.content, line),
    formProposal: { ...proposal, sourceMessageIds: inConversationOrder(proposal.sourceMessageIds, sources, turns) },
  };
}

/** Just after the latest request for a form that names somebody other than this employee. */
function afterRequestForSomebodyElse(turns: readonly Turn[], employeeName: string): number {
  const card = employeeName.toLowerCase().split(/\s+/);
  const same = (name: string) => {
    const words = name.toLowerCase().split(/\s+/);
    return words.join(" ") === card.join(" ") || words[0] === card[0];
  };
  let start = 0;
  turns.forEach((turn, index) => {
    const intent = detectTemplateIntent(turn.content);
    const request = intent.kind === "explicit" || (intent.kind === "corrective_action" && intent.requestedCreation);
    if (!request) return;
    const names = extractEmployeeNames(turn.content);
    if (names.length > 0 && !names.some(same)) start = index + 1;
  });
  return start;
}

/** The line where the reply said the priors were the manager's to set, or after the Type of Warning. */
function withPriorLine(content: string, line: string): string {
  const paragraphs = content.split("\n\n");
  const hold = paragraphs.findIndex((paragraph) => PRIORS_ONLY_HOLD.test(paragraph.trim()));
  if (hold >= 0) {
    paragraphs[hold] = line;
    return paragraphs.join("\n\n");
  }
  const both = paragraphs.findIndex((paragraph) => BOTH_HOLD.test(paragraph.trim()));
  if (both >= 0) {
    paragraphs.splice(both, 1, line, LEVEL_ONLY_HOLD);
    return paragraphs.join("\n\n");
  }
  const level = paragraphs.findIndex((paragraph) => paragraph.trim().startsWith("**Type of Warning:**"));
  paragraphs.splice(level >= 0 ? level + 1 : Math.min(1, paragraphs.length), 0, line);
  return paragraphs.join("\n\n");
}

function inConversationOrder(current: readonly string[], added: readonly string[], turns: readonly Turn[]): string[] {
  const order = new Map(turns.flatMap((turn, index) => (turn.id ? [[turn.id, index] as const] : [])));
  const unique = [...new Set([...added, ...current])];
  return unique
    .map((id, index) => ({ id, at: order.get(id) ?? turns.length + index }))
    .sort((a, b) => a.at - b.at)
    .map((item) => item.id);
}
