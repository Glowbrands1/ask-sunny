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
  | { status: "completed"; sent: number; failed: number; skipped: number; waiting: number; stoppedBy: string | null };

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

  /*
   * ONE PERSON NEVER HOLDS UP THE REST (QA, 28 Oct 2026). An account refused
   * before the mailer was asked — already confirmed, banned, or its credential
   * could not be read — is skipped and the next one is tried, at no cost to
   * the hour's sends; each refusal counts as an attempt, so after
   * MAX_AUTOMATIC_INVITE_ATTEMPTS it is no longer waiting at all. A failure
   * the mailer gave uses a send; its limit stops the hour; a missing redirect
   * stops the run before anybody's attempts are spent on it. At most MAX_TRIED
   * accounts are looked at per run.
   */
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let used = 0;
  let stoppedBy: string | null = null;
  for (const row of waiting.slice(0, MAX_TRIED)) {
    if (used >= config.perHour) break;
    const outcome = await deps.send(row.account!.appUserId, row.account!.email);
    if (outcome.ok) {
      sent += 1;
      used += 1;
      continue;
    }
    if (outcome.code === "email_rate_limited" || outcome.code === "redirect_not_configured") {
      failed += 1;
      stoppedBy = outcome.code;
      break;
    }
    if (REFUSED_BEFORE_SENDING.has(outcome.code)) {
      skipped += 1;
      continue;
    }
    failed += 1;
    used += 1;
  }
  return { status: "completed", sent, failed, skipped, waiting: waiting.length - sent, stoppedBy };
}

/** Accounts looked at in one run, however many are refused before sending. */
const MAX_TRIED = 25;

/** `sendInviteEmail` refusals raised before the mailer was asked: they cost no send. */
const REFUSED_BEFORE_SENDING: ReadonlySet<string> = new Set(["already_confirmed", "auth_user_banned", "auth_lookup_failed"]);
