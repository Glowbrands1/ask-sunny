import "server-only";

import { redirect } from "next/navigation";

import { canEditAiTraining } from "@/lib/ai-training/editors";
import { pageAuthorizationEnforced } from "@/lib/auth/page";
import type { AuthenticatedIdentity } from "@/lib/auth/types";

/** Whether the reader of an AI Training page may edit it: the named editors only. */
export function viewerIsAdmin(identity: AuthenticatedIdentity | null): boolean {
  return canEditAiTraining(identity);
}

/**
 * The second check on the Manage screens, after `requirePagePermission`. Anyone
 * not on the editor list is sent back to the training itself rather than shown
 * an error.
 */
export function ensureAiTrainingEditor(identity: AuthenticatedIdentity | null): void {
  if (!pageAuthorizationEnforced()) return;
  // Unreachable when enforcing (requirePagePermission redirects), but a null must never read as "allowed".
  if (!identity) redirect("/login");
  if (!canEditAiTraining(identity)) redirect("/ai-training?denied=manage_ai_training");
}

/**
 * Runs a read, turning a failure into a message for the screen instead of an
 * error page — the usual one being the tables not existing yet because the
 * migration has not been applied to this environment.
 */
export async function readOrExplain<T>(read: () => Promise<T>): Promise<{ data: T; problem: null } | { data: null; problem: string }> {
  try {
    return { data: await read(), problem: null };
  } catch (error) {
    console.error("[ai-training] read failed", error);
    return {
      data: null,
      problem: "AI Training could not be loaded. If this is a new deployment, its database tables may not have been created yet.",
    };
  }
}
