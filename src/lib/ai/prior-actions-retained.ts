import { priorActionsRetainedEnabled } from "@/lib/config/chat-quality-flags";
import { datesInTextWithYearless, priorSteps } from "@/lib/forms/form-date-answer";
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
 * them on the form too. A turn that states priors itself is read as before.
 *
 * What is NOT carried (QA-6, 26 Oct 2026):
 *   - a removal clears what was said before it, and only the kind it names:
 *     "no prior written" clears a written warning and keeps the coaching
 *     ("prior coaching 7-29-26 but no prior written"); "no prior coaching",
 *     "no priors", "remove the prior" clear them all;
 *   - a negated step ("she did not have prior coaching on 7-29-26") is never
 *     listed, and takes back a step stated earlier with the same date;
 *   - a step about somebody else ("prior coaching for <another name> 7-29-26",
 *     "<another name> had a prior verbal 6-1-26") is never put on this
 *     employee's card;
 *   - a later creation request for this form starts a new form ("create
 *     another corrective action for …"), and so does a request for another
 *     employee: the priors before it are not this one's.
 * Off, the response is returned unchanged.
 */

/** "no prior coaching", "remove the prior", "take off the previous actions", "she has never had a prior verbal". */
const REMOVES_PRIOR =
  /\b(?:(?:no|not\s+any|without|remove|delete|drop|clear|erase|scratch|strike|forget|ignore|take\s+(?:off|out|away))\s+(?:the\s+|any\s+|all\s+|her\s+|his\s+|their\s+|that\s+|those\s+)?|(?:never|not|n['’]t)\s+(?:had|have|has|got|gotten|received|been\s+given)\s+(?:a\s+|any\s+)?)(?:prior|previous|past|earlier)s?\b(?:\s+(verbal|written|final))?/gi;

/** A clause ends at a sentence, a comma, or a turn of the sentence ("… but no prior written"). */
const CLAUSE_BREAK = /[.!?;,\n]|\b(?:but|however|except|although|though)\b/gi;

/**
 * "she did not have prior coaching on 7-29-26", "was never coached", "had no
 * prior verbal on …": a negation bound to the step, not one elsewhere in the
 * clause ("she didn't finish the checklist and had prior coaching 7-29-26").
 */
const NEGATED =
  /(?:\b(?:not|never|no)\b|n['’]t\b)(?:\s+[a-z'’]+){0,2}?\s+(?:have|had|has|get|got|gotten|receive|received|given|prior|previous|past|earlier|coached|coaching|verbal|written|warning)\b/i;

/** "create another corrective action for …", "new corrective action for …": asking for the form, not mentioning it. */
const CREATION_VERB = /\b(?:create|make|start|open|do|file|write|draft|need|want|another|new|second|separate)\b/i;

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

type Kind = "verbal" | "written" | "final" | "other";

interface Item {
  readonly line: string;
  readonly iso: string;
  readonly kind: Kind;
  readonly at: number;
  readonly turnId?: string;
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
  const same = sameEmployee(proposal.employeeName);
  const start = Math.max(
    turns.length - currentRequestTurns(turns.map((turn) => turn.content), proposal.employeeName).length,
    latestRequestStart(turns, same),
  );

  /* The steps this form's turns stated, less what a later turn took back. */
  let items: Item[] = [];
  for (const turn of turns.slice(start)) {
    const text = priorShorthand(turn.content);
    const read = readTurn(text, input.today, same, turn.id);
    type Removal = (typeof read.removals)[number];
    const events: { at: number; add?: Item; remove?: Removal }[] = [
      ...read.items.map((item) => ({ at: item.at, add: item })),
      ...read.removals.map((removal) => ({ at: removal.at, remove: removal })),
    ].sort((a, b) => a.at - b.at);
    let thisTurn: Item[] = [];
    for (const event of events) {
      if (event.add) {
        thisTurn.push(event.add);
        continue;
      }
      const removal = event.remove!;
      const keep = (item: Item) =>
        removal.iso ? item.iso !== removal.iso : removal.kind !== "all" && item.kind !== removal.kind;
      items = items.filter(keep);
      thisTurn = thisTurn.filter(keep);
    }
    items = [...items, ...thisTurn];
  }

  const priors = [...new Set(items.map((item) => item.line))];
  if (priors.length === 0) return response;

  const line = `**Prior actions:** ${priors.join("; ")}, as you said. I'll list ${priors.length === 1 ? "it" : "them"} on the form — tell me if that should change.`;
  const sources = [...new Set(items.flatMap((item) => (item.turnId ? [item.turnId] : [])))];
  return {
    ...response,
    content: withPriorLine(response.content, line),
    formProposal: { ...proposal, sourceMessageIds: inConversationOrder(proposal.sourceMessageIds, sources, turns) },
  };
}

/**
 * One turn: the steps it states that belong on this card, and what it takes
 * back. Read with the same readers the card uses (`priorSteps`,
 * `statedPriorActions`); each step is then placed at its date and judged by
 * its own clause.
 */
function readTurn(
  text: string,
  today: string,
  same: (name: string) => boolean,
  turnId: string | undefined,
): { items: Item[]; removals: { at: number; kind: Kind | "all"; iso?: string }[] } {
  const steps = priorSteps(text, today);
  const lines = statedPriorActions(text, today);
  const dates = datesInTextWithYearless(text, today);
  const breaks = [...text.matchAll(CLAUSE_BREAK)].map((match) => ({ from: match.index, to: match.index + match[0].length }));
  const items: Item[] = [];
  const removals: { at: number; kind: Kind | "all"; iso?: string }[] = [];
  let after = -1;
  steps.forEach((step, index) => {
    const date = dates.find((found) => found.iso === step.iso && found.index > after) ?? dates.find((found) => found.iso === step.iso);
    const at = date?.index ?? text.length;
    after = at;
    const clauseStart = Math.max(0, ...breaks.filter((item) => item.to <= at).map((item) => item.to));
    const clauseEnd = Math.min(text.length, ...breaks.filter((item) => item.from > at).map((item) => item.from));
    const before = text.slice(clauseStart, at);
    const clause = text.slice(clauseStart, clauseEnd);
    if (NEGATED.test(before)) {
      removals.push({ at, kind: kindOf(step.named), iso: step.iso });
      return;
    }
    const names = [...extractEmployeeNames(clause), ...extractEmployeeNames(`${step.named} ${step.about ?? ""}`)];
    if (names.length > 0 && !names.some(same)) return;
    items.push({ line: lines[index] ?? "", iso: step.iso, kind: kindOf(step.named), at, ...(turnId ? { turnId } : {}) });
  });
  for (const match of text.matchAll(REMOVES_PRIOR)) {
    const covered = removals.some((removal) => removal.at >= match.index && removal.at <= match.index + match[0].length + 40);
    if (covered) continue;
    removals.push({ at: match.index, kind: (match[1]?.toLowerCase() as Kind | undefined) ?? "all" });
  }
  return { items: items.filter((item) => item.line), removals };
}

function kindOf(named: string): Kind {
  if (/\bverbal/i.test(named)) return "verbal";
  if (/\bwritten/i.test(named)) return "written";
  if (/\bfinal/i.test(named)) return "final";
  return "other";
}

function sameEmployee(employeeName: string): (name: string) => boolean {
  const card = employeeName.toLowerCase().split(/\s+/);
  return (name: string) => {
    const words = name.toLowerCase().split(/\s+/);
    return words.join(" ") === card.join(" ") || words[0] === card[0];
  };
}

/**
 * Where this form's turns start: at the latest creation request for this form
 * for this employee ("create another corrective action for …"), or just after
 * the latest request that names somebody else.
 */
function latestRequestStart(turns: readonly Turn[], same: (name: string) => boolean): number {
  let start = 0;
  turns.forEach((turn, index) => {
    const intent = detectTemplateIntent(turn.content);
    const request =
      (intent.kind === "explicit" && intent.templateKey === "dpoa" && CREATION_VERB.test(turn.content)) ||
      (intent.kind === "corrective_action" && intent.requestedCreation);
    const otherRequest = intent.kind === "explicit" && intent.templateKey !== "dpoa" && CREATION_VERB.test(turn.content);
    if (!request && !otherRequest) return;
    const names = extractEmployeeNames(turn.content);
    if (names.length > 0 && !names.some(same)) start = index + 1;
    else if (request) start = index;
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
