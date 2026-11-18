import "server-only";

import type { AuthenticatedIdentity } from "@/lib/auth/types";
import { canAccessAdminConsole } from "@/lib/permissions";

/** Whether the reader of an AI Training page may edit it: the admin console roles. */
export function viewerIsAdmin(identity: AuthenticatedIdentity | null): boolean {
  return identity ? canAccessAdminConsole(identity.role) : false;
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
