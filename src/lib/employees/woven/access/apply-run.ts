import "server-only";

import { revokeAuthAccess } from "@/lib/auth/revocation";
import { getSupabaseAdmin } from "@/lib/supabase/server";

import { applyAccessLifecycle, type ApplyDeps, type ApplyOutcome } from "./apply";
import { readWovenAccessConfig } from "./config";
import { loadAccessPlan } from "./load";

/**
 * The account lifecycle with the real services: the plan from the database,
 * the migration's functions over PostgREST, the Supabase Auth Admin API and
 * the hardened revocation. Only in `WOVEN_ACCESS_MODE=apply`; returns
 * `{ status: "off" }` otherwise without touching anything.
 */
export function realApplyDeps(): ApplyDeps {
  const admin = getSupabaseAdmin();
  return {
    loadPlan: (now) => loadAccessPlan(now),
    rpc: (fn, args) => admin.rpc(fn, args) as unknown as PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>,
    auth: {
      createUser: (attributes) => admin.auth.admin.createUser(attributes) as never,
      inviteUserByEmail: (email, options) => admin.auth.admin.inviteUserByEmail(email, options) as never,
      getUserById: (id) => admin.auth.admin.getUserById(id) as never,
    },
    revokeAuthAccess: (userId) => revokeAuthAccess(userId),
  };
}

export async function runAccessLifecycle(requestedBy: string, redirectTo: string | null, now: Date = new Date()): Promise<ApplyOutcome> {
  const config = readWovenAccessConfig();
  if (config.mode !== "apply") return { status: "off" };
  try {
    return await applyAccessLifecycle({ requestedBy, redirectTo, config, now }, realApplyDeps());
  } catch {
    return { status: "failed", code: "apply_failed", accessRunId: null };
  }
}
