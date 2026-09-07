import "server-only";

import { randomUUID } from "node:crypto";

import {
  buildProposal,
  managerContext,
  type ManagerContext,
} from "@/lib/forms/proposal";
import { detectTemplateIntent, type TemplateIntent } from "@/lib/forms/template-intent";
import { listTemplateSummaries, type TemplateSummary } from "@/lib/forms/repository";
import { DEFAULT_PERMISSION_MATRIX, hasPermission } from "@/lib/permissions";
import type { AccessScope, ChatFormProposal, ChatMessage, Permission, Role } from "@/types";
import type { AskResponse } from "./types";

/**
 * ============================================================================
 * A FORM PROPOSAL, ASSEMBLED SERVER-SIDE
 * ============================================================================
 *
 * `proposal.ts` reads a conversation; this file decides whether the thing it
 * read corresponds to a form this person may actually create. Three checks, in
 * this order, and a failure at any of them produces a QUESTION rather than a
 * proposal:
 *
 *   1. IS IT A REAL TEMPLATE?      resolved against `form_templates`, not
 *                                  against a keyword map. A key the sentence
 *                                  suggested is an intent; a published, active
 *                                  template with a published current version is
 *                                  a fact.
 *
 *   2. MAY THIS PERSON CREATE IT?  the TEMPLATE's own `required_permission`,
 *                                  applied through the server's matrix. No role
 *                                  list is written here, and nothing is
 *                                  broadened: a Salon Director who cannot
 *                                  create a DPOA in Forms cannot obtain one by
 *                                  asking Sunny for it.
 *
 *   3. WHAT IS ACTUALLY KNOWN?     employee from the manager's own turns, salon
 *                                  from the authenticated scope. Whatever is
 *                                  missing is named as missing.
 *
 * ============================================================================
 * THE PROPOSAL IS NOT THE HR RECORD
 * ============================================================================
 *
 * Nothing in this file writes. There is no `form_instances` insert, no template
 * version pinned, no field value, no follow-up date, no PDF. A proposal is a
 * statement of what Sunny WOULD create and what it still needs — and it stays
 * that way until a manager confirms it, which is not built yet and is not
 * pretended to be.
 */

/**
 * The authenticated caller, as chat needs it.
 *
 * A SEPARATE ARGUMENT FROM `AskRequest`, DELIBERATELY. `AskRequest` is parsed
 * from the request body; anything on it is something the browser could send. A
 * role and a scope are exactly the two values a caller must never be able to
 * assert about itself, so they travel on their own parameter, filled by the
 * route from the authorized context.
 */
export interface ChatActor {
  role: Role | null;
  /** `null` when no identity provider vouched for a scope. Never enforced against. */
  scope: AccessScope | null;
}

export interface ProposalTurn {
  history: Pick<ChatMessage, "id" | "role" | "content" | "error">[];
  question: string;
  /**
   * Browser-local id of the manager's turn being answered. Provenance only —
   * see `ManagerContext`. Absent when the client did not send one.
   */
  questionMessageId?: string;
  actor: ChatActor;
}

/** A template a real person may actually start today. */
function isCreatable(summary: TemplateSummary): boolean {
  return summary.active && summary.currentVersion?.status === "published";
}

function permits(actor: ChatActor, summary: TemplateSummary): boolean {
  if (!actor.role) return false;
  return hasPermission(
    DEFAULT_PERMISSION_MATRIX,
    actor.role,
    summary.requiredPermission as Permission,
  );
}

function bulletList(names: string[]): string {
  return names.map((name) => `- ${name}`).join("\n");
}

/** Every response from this module is a proposal turn, not a knowledge answer. */
function turn(content: string, formProposal?: ChatFormProposal): AskResponse {
  return {
    content,
    // A proposal is not an answer drawn from the knowledge base, so it carries
    // no citations and coverage is not a meaningful question about it.
    // "The knowledge base does not cover this" would be a misleading thing to
    // show under a question Sunny answered correctly.
    citations: [],
    coverage: "not_applicable",
    recommendedVideoIds: [],
    formProposal,
  };
}

/**
 * Reads a form request and returns either a proposal or the question that has
 * to be answered before one exists.
 *
 * @returns `null` when the turn is not a form request, so the caller falls
 *          through to the ordinary grounded-answer path.
 */
export async function proposeFormForTurn(input: ProposalTurn): Promise<AskResponse | null> {
  const intent: TemplateIntent = detectTemplateIntent(input.question);
  if (intent.kind === "none") return null;

  const summaries = await listTemplateSummaries();
  const available = summaries.filter(isCreatable).filter((summary) => permits(input.actor, summary));

  if (intent.kind === "ambiguous") {
    return turn(ambiguousContent(available));
  }

  const match = summaries.find((summary) => summary.key === intent.templateKey);

  /*
   * NAMED SOMETHING THE LIBRARY DOES NOT PUBLISH.
   *
   * Not an error and not a silent substitution. The prototype's answer to this
   * situation was the Coaching Form; the answer here is to say so and list what
   * this deployment actually has.
   */
  if (!match || !isCreatable(match)) {
    return turn(
      [
        "That form is not published in Ask Sunny yet, so I will not stand in for it with a different one.",
        "",
        available.length > 0
          ? `Here is what you can start today:\n\n${bulletList(available.map((summary) => summary.name))}`
          : "There are no published forms available to you right now — an administrator publishes them under Form Templates.",
      ].join("\n"),
    );
  }

  /*
   * THE TEMPLATE'S OWN PERMISSION, NOT A ROLE LIST WRITTEN IN CHAT.
   *
   * `required_permission` is data on the template row, which is why a Salon
   * Director may be offered a Coaching Form and refused a Disciplinary Plan of
   * Action without either rule appearing here.
   */
  if (!permits(input.actor, match)) {
    return turn(
      [
        `Your role cannot create a **${match.name}**, so I will not propose one.`,
        "",
        available.length > 0
          ? `You can start these:\n\n${bulletList(available.map((summary) => summary.name))}`
          : "Ask your district manager which forms your role should cover.",
      ].join("\n"),
    );
  }

  const context = managerContext(input.history, {
    id: input.questionMessageId,
    content: input.question,
  });

  const proposal = buildProposal({
    /*
     * SERVER-GENERATED, never taken from the request. A proposal id is how a
     * later confirmation step will name the thing being confirmed; a
     * caller-chosen one would let a caller name somebody else's.
     */
    proposalId: randomUUID(),
    templateKey: match.key,
    templateName: match.name,
    context,
    scope: input.actor.scope,
  });

  return turn(proposalContent(proposal, context), proposal);
}

/* -------------------------------------------------------------- wording -- */

function ambiguousContent(available: TemplateSummary[]): string {
  if (available.length === 0) {
    return "I can't tell which form you need, and there are no published forms available to you right now. An administrator publishes them under Form Templates.";
  }
  return [
    "Which form do you need? I won't pick one for you — the wrong form in someone's file is harder to undo than asking.",
    "",
    bulletList(available.map((summary) => `**${summary.name}** — ${summary.description}`)),
  ].join("\n");
}

/**
 * The prose beside the proposal card.
 *
 * NO DRAFTED CONTENT, and no invitation to a control that does not exist. It
 * states which form, what is established, what is missing, and that nothing has
 * been created — because at this phase nothing has.
 */
function proposalContent(proposal: ChatFormProposal, context: ManagerContext): string {
  const lines: string[] = [`Here is what I would put on a **${proposal.templateName}**.`, ""];

  if (proposal.status === "needs_employee") {
    lines.push(
      "I don't yet know who this form is about. Tell me their name and I'll put it on the proposal — I won't guess at it.",
    );
  } else if (proposal.status === "needs_location") {
    lines.push(locationQuestion(proposal));
  } else {
    lines.push(
      `Everything I need is here, drawn from ${context.messages.length === 1 ? "your message" : "your messages"} above.`,
    );
  }

  lines.push(
    "",
    "**Nothing has been created.** This is a proposal, not a form — no record exists until you confirm one, and confirming from chat is not built yet. To file a form today, use Create a Form.",
  );

  return lines.join("\n");
}

function locationQuestion(proposal: ChatFormProposal): string {
  if (proposal.locationResolution === "needs_selection") {
    // Deliberately says nothing about HOW MANY salons the actor covers: this
    // branch is reached both by a manager assigned to several and by a global
    // actor whose salons cannot be enumerated at all.
    return "I won't choose which salon this belongs to. Which salon is this about?";
  }
  return "I can't confirm which salon this would be filed against, so the proposal has none. A form can only name a salon Ask Sunny can verify you're assigned to.";
}
