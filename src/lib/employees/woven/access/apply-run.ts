import "server-only";

import { revokeAuthAccess } from "@/lib/auth/revocation";
import { getSupabaseAdmin } from "@/lib/supabase/server";

import { applyAccessLifecycle, sendInviteEmail, type ApplyDeps, type ApplyOutcome } from "./apply";
import { readWovenAccessConfig } from "./config";
import { loadAccessPlan } from "./load";
import { readNewHireConfig } from "./new-hire";
import { sendNewHireInvites, type NewHireInviteOutcome } from "./new-hire-invites";

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
    // NEW_HIRE_INVITES_ENABLED: invitations wait for the hourly new-hire run. Off: as before.
    const holdInvites = readNewHireConfig(process.env, now).enabled;
    return await applyAccessLifecycle({ requestedBy, redirectTo, config, now, ...(holdInvites ? { holdInvites } : {}) }, realApplyDeps());
  } catch {
    return { status: "failed", code: "apply_failed", accessRunId: null };
  }
}

/**
 * NEW_HIRE_INVITES_ENABLED: the hourly run (`new-hire-invites.ts`) with the
 * real services. Off: `{ status: "off" }`, and nothing is read.
 */
export async function runNewHireInvites(requestedBy: string, redirectTo: string | null, now: Date = new Date()): Promise<NewHireInviteOutcome> {
  const config = readNewHireConfig(process.env, now);
  if (!config.enabled) return { status: "off", code: config.problem ? "misconfigured" : "new_hire_invites_off" };
  const deps = realApplyDeps();
  const setBy = `woven-new-hire-invites:${requestedBy}`.slice(0, 120);
  try {
    return await sendNewHireInvites(
      { config, access: readWovenAccessConfig(), now },
      { loadPlan: deps.loadPlan, send: (appUserId, email) => sendInviteEmail(appUserId, email, redirectTo, deps, setBy) },
    );
  } catch {
    return { status: "off", code: "new_hire_invites_failed" };
  }
}
