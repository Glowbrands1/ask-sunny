import { agentLoopEnabled } from "@/lib/config/chat-quality-flags";

/**
 * ============================================================================
 * WHO GETS THE TOOL LOOP (AGENT_LOOP_ENABLED, AGENT_LOOP_USERS)
 * ============================================================================
 *
 *   AGENT_LOOP_ENABLED off            nobody: every turn as before.
 *   on, AGENT_LOOP_USERS unset/empty  NOBODY (Pau via QA, 14 Nov 2026: a
 *                                     missing or empty list must never turn
 *                                     the loop on for every manager).
 *   on, AGENT_LOOP_USERS "a@x,b@y"    only those emails (case and spaces
 *                                     ignored); everyone else as before.
 *   on, AGENT_LOOP_USERS "*"          every signed-in user (QA, 14 Nov 2026:
 *                                     pilot to everyone with one env change).
 *                                     A "*" mixed with emails ("*,a@x") is
 *                                     rejected: nobody, with a log line.
 *
 * QA sets the real list in Vercel. Tests use invented addresses only.
 */
export function agentLoopUsers(): string[] {
  return (process.env.AGENT_LOOP_USERS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== "");
}

export function agentLoopFor(email: string | null | undefined): boolean {
  if (!agentLoopEnabled()) return false;
  const users = agentLoopUsers();
  if (users.length === 0) return false;
  const signedIn = (email ?? "").trim().toLowerCase();
  if (users.includes("*")) {
    if (users.length > 1) {
      console.warn("AGENT_LOOP_USERS mixes \"*\" with emails; nobody gets the agent loop until it is one or the other.");
      return false;
    }
    return signedIn !== "";
  }
  return signedIn !== "" && users.includes(signedIn);
}

export const AGENT_LOOP_DEFAULT_STEPS = 6;
export const AGENT_LOOP_MAX_STEPS = 10;

/** The step limit: AGENT_LOOP_MAX_STEPS sets it, 1 to 10; default 6. */
export function agentLoopStepLimit(): number {
  const raw = Number(process.env.AGENT_LOOP_MAX_STEPS);
  if (!process.env.AGENT_LOOP_MAX_STEPS || !Number.isFinite(raw)) return AGENT_LOOP_DEFAULT_STEPS;
  return Math.min(AGENT_LOOP_MAX_STEPS, Math.max(1, Math.round(raw)));
}

/**
 * ============================================================================
 * TURNS THE LOOP DOES NOT TAKE YET (QA, batch F5, 15 Nov 2026)
 * ============================================================================
 *
 * The loop's branch in the chat route passes the question, history, open form and conversation id. A turn that also
 * carries one of these would lose it in the loop, so it goes to today's path instead, and the trace says why
 * (`slots.agent_loop_skipped`). Each is a TODO in `docs/agent-loop/parity-matrix.md`.
 *
 * NOT `continueProposalTemplateKey`: the browser sends it on nearly every turn after a card (`continuationFor`
 * returns the latest card's template), and the loop reads that card from the history itself. Skipping on it would take
 * most of the loop's card follow-ups ("make it a written", the payroll answer) to today's path, so it is only noted
 * (`loopCarriedOnly`), never a reason to skip.
 */
export type AgentLoopSkipReason = "attachments" | "report_context" | "pending_copy" | "answer_mode";

export function agentLoopSkipReason(request: {
  readonly attachedDocumentIds?: readonly string[];
  readonly reportContext?: unknown;
  readonly pendingCopyFromInstanceId?: string;
  readonly mode?: string;
}): AgentLoopSkipReason | null {
  if ((request.attachedDocumentIds?.length ?? 0) > 0) return "attachments";
  if (request.reportContext) return "report_context";
  if (request.pendingCopyFromInstanceId) return "pending_copy";
  if (request.mode && request.mode !== "standard") return "answer_mode";
  return null;
}

/** What a loop turn carries that the loop reads another way (noted in the trace, never a reason to skip). */
export function loopCarriedOnly(request: { readonly continueProposalTemplateKey?: string }): string[] {
  return request.continueProposalTemplateKey ? ["continue_proposal"] : [];
}
