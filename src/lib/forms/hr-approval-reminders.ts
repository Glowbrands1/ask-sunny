import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

import type { FormsActor } from "./access";
import { HR_PENDING_TAB_HREF, HR_REMINDER_KIND, ringBells } from "./hr-approval-bells";
import { listHrApprovers } from "./hr-approval-approvers";
import { hrQueueSummary } from "./hr-approval";
import { hrApprovalEnabled, reminderDueAt } from "./hr-approval-rules";

export type ReminderOutcome =
  | { status: "disabled" }
  | { status: "not_due"; localDate: string }
  | { status: "sent"; localDate: string; reminded: number; alreadySent: number; nothingPending: number };

/**
 * THE 6 AM REMINDER (owner, 23 Nov 2026: "keep sending reminders to her CT only
 * during weekdays 6AM"). One bell per approver per weekday at 6 o'clock Central,
 * with how many forms wait for them and how many are overdue. Nothing waiting,
 * no bell.
 *
 * SENT ONCE A DAY, WHATEVER RUNS. The cron fires at 11:05 and 12:05 UTC so one
 * of the two is 6 AM Central in either season (`reminderDueAt`), and a retry or
 * a second run the same morning finds its `(approver, local date)` row already
 * in `form_hr_reminder_sends` and sends nothing.
 */
export async function runHrReminders(now: Date = new Date()): Promise<ReminderOutcome> {
  if (!hrApprovalEnabled()) return { status: "disabled" };
  const { due, localDate } = reminderDueAt(now);
  if (!due) return { status: "not_due", localDate };

  const approvers = await listHrApprovers();
  let reminded = 0;
  let alreadySent = 0;
  let nothingPending = 0;
  for (const approver of approvers) {
    const actor: FormsActor = { id: approver.id, role: null, verified: true, scope: null, visibility: null, hrApprover: true };
    const summary = await hrQueueSummary(actor, now);
    if (!summary || summary.pending === 0) {
      nothingPending += 1;
      continue;
    }
    const { data, error } = await getSupabaseAdmin()
      .from("form_hr_reminder_sends")
      .upsert(
        { approver_id: approver.id, local_date: localDate, pending_count: summary.pending },
        { onConflict: "approver_id,local_date", ignoreDuplicates: true },
      )
      .select("approver_id");
    if (error) throw new Error(`Could not record the reminder: ${error.message}`);
    if (!data || data.length === 0) {
      alreadySent += 1;
      continue;
    }
    await ringBells([
      {
        recipientEmail: approver.email,
        kind: HR_REMINDER_KIND,
        title: `${summary.pending} form${summary.pending === 1 ? " is" : "s are"} waiting for your approval`,
        body:
          summary.overdue > 0
            ? `${summary.overdue} ${summary.overdue === 1 ? "has" : "have"} waited more than a business day.`
            : "None is overdue yet.",
        href: HR_PENDING_TAB_HREF,
      },
    ]);
    reminded += 1;
  }
  return { status: "sent", localDate, reminded, alreadySent, nothingPending };
}
