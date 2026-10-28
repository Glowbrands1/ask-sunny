import { MAX_AUTOMATIC_INVITE_ATTEMPTS } from "./lifecycle";
import type { AccessPlan } from "./build";
import type { WovenAccessConfig } from "./config";
import { isNewHire, type NewHireConfig } from "./new-hire";
import type { PlannedRow } from "./types";

/**
 * ============================================================================
 * THE HOURLY NEW-HIRE INVITATION — NEW_HIRE_INVITES_ENABLED
 * ============================================================================
 *
 * One run an hour (`/api/employees/woven/invites/cron`). It sends the
 * invitation to at most NEW_HIRE_INVITES_PER_HOUR (1 or 2) new hires whose
 * account the lifecycle created and who have not been invited yet — oldest
 * hire date first — and stops at the first rate-limit answer, so a mailer
 * that allows two emails an hour is never asked for more. The rest wait for
 * the next hour.
 *
 * It sends ONLY when all of these are on: NEW_HIRE_INVITES_ENABLED (with
 * NEW_HIRE_INVITE_SINCE), WOVEN_ACCESS_MODE=apply, and SEND_INVITE in
 * WOVEN_ACCESS_APPLY_ACTIONS; only while the access guards allow changes;
 * only for people active in Woven, in the approved batch
 * (WOVEN_ACCESS_APPLY_EMPLOYEE_IDS, when set), hired on or after the set date.
 * Each send is the lifecycle's own (`sendInviteEmail`): Supabase emails the
 * link to the person, it is recorded, and it is never returned or logged.
 */

export interface NewHireInviteDeps {
  loadPlan(now: Date): Promise<AccessPlan>;
  /** The lifecycle's invitation for one account. */
  send(appUserId: string, email: string): Promise<{ ok: boolean; code: string }>;
}

export type NewHireInviteOutcome =
  | { status: "off"; code: string }
  | { status: "blocked"; code: "guards" }
  | { status: "completed"; sent: number; failed: number; waiting: number; stoppedBy: string | null };

/** Created by the lifecycle, invited, never sent (or failed under the attempt limit), active in Woven. */
function waitingForInvite(row: PlannedRow): boolean {
  const account = row.account;
  const invite = account?.invite;
  return Boolean(
    account &&
      account.via === "link" &&
      account.linkMethod === "provisioned" &&
      account.status === "invited" &&
      invite &&
      invite.status !== "sent" &&
      invite.attempts < MAX_AUTOMATIC_INVITE_ATTEMPTS &&
      row.wovenStatus === "active",
  );
}

export async function sendNewHireInvites(
  input: { config: NewHireConfig; access: WovenAccessConfig; now: Date },
  deps: NewHireInviteDeps,
): Promise<NewHireInviteOutcome> {
  const { config, access, now } = input;
  if (!config.enabled || !config.rule) return { status: "off", code: config.problem ? "misconfigured" : "new_hire_invites_off" };
  if (access.mode !== "apply" || !access.applyActions.includes("SEND_INVITE")) return { status: "off", code: "lifecycle_invites_off" };

  const plan = await deps.loadPlan(now);
  if (!plan.guard.mutationsAllowed) return { status: "blocked", code: "guards" };
  const rule = config.rule;
  const inBatch = (row: PlannedRow) =>
    access.employeeAllowlist === null || (row.externalEmployeeId !== null && access.employeeAllowlist.includes(row.externalEmployeeId));
  const waiting = plan.rows
    .filter((row) => waitingForInvite(row) && inBatch(row) && isNewHire(row.hireDate, rule))
    .sort((a, b) => (a.hireDate ?? "").localeCompare(b.hireDate ?? "") || a.key.localeCompare(b.key));

  let sent = 0;
  let failed = 0;
  let stoppedBy: string | null = null;
  for (const row of waiting.slice(0, config.perHour)) {
    const outcome = await deps.send(row.account!.appUserId, row.account!.email);
    if (outcome.ok) sent += 1;
    else failed += 1;
    // The mailer's limit: nobody else is tried this hour.
    if (!outcome.ok && outcome.code === "email_rate_limited") {
      stoppedBy = "email_rate_limited";
      break;
    }
  }
  return { status: "completed", sent, failed, waiting: waiting.length - sent, stoppedBy };
}
