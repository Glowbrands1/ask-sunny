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
