import "server-only";

import { businessToday } from "@/lib/business-date";
import { getSupabaseAdmin } from "@/lib/supabase/server";

import { accountEmail } from "./hr-approval-approvers";
import { ringBells } from "./hr-approval-bells";
import { isDemoInstance, listAllOutstandingFollowUps, type InstanceRow } from "./instances";
import { configuredExcludedNames, isProductionRecord } from "./production-records";

/**
 * FOLLOW-UP NOTICES (Pau, 26 Nov 2026): "for the follow up, this is when the manager will follo up with the person,
 * when its due and overdue pls add a notification whoever created the form".
 *
 * Once a day (`/api/forms/follow-up/cron`) the person who CREATED a form gets a bell:
 *   - "Follow-up due today" on the follow-up date, and
 *   - "Follow-up overdue" once the date has passed without "Mark followed up".
 * Each is sent once per form and date (`form_follow_up_notice_sends`); a moved date is announced again, and a form
 * marked followed up gets nothing more. Only the live finalized version counts (a revised form's follow-up is carried
 * by its revision; a draft has not been issued). Test records (`isProductionRecord`) and demo forms are left out, as
 * they are from the follow-up counts.
 */
export const FOLLOW_UP_DUE_KIND = "form_follow_up_due";
export const FOLLOW_UP_OVERDUE_KIND = "form_follow_up_overdue";

export type FollowUpNoticeStage = "due" | "overdue";

type NoticeFacts = Pick<InstanceRow, "status" | "followUpDate" | "followedUpAt">;

/** Which notice, if any, a form is owed today. */
export function followUpNoticeStage(form: NoticeFacts, today: string): FollowUpNoticeStage | null {
  if (form.followedUpAt || !form.followUpDate || form.status !== "finalized") return null;
  if (form.followUpDate === today) return "due";
  if (form.followUpDate < today) return "overdue";
  return null;
}

function shortDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

/** The bell's wording. It names the employee and the form, never anything else from it. */
export function followUpNotice(
  form: Pick<InstanceRow, "id" | "employeeName" | "templateShortName" | "followUpDate">,
  stage: FollowUpNoticeStage,
): { kind: string; title: string; body: string; href: string } {
  const what = `${form.templateShortName || "form"} for ${form.employeeName}`;
  return stage === "due"
    ? {
        kind: FOLLOW_UP_DUE_KIND,
        title: "Follow-up due today",
        body: `Your follow-up on the ${what} is due today. Mark it followed up in Form Monitoring once it is done.`,
        href: `/forms/monitoring?followup=open&form=${form.id}`,
      }
    : {
        kind: FOLLOW_UP_OVERDUE_KIND,
        title: "Follow-up overdue",
        body: `Your follow-up on the ${what} was due ${shortDate(form.followUpDate ?? "")} and is not marked done yet.`,
        href: `/forms/monitoring?followup=overdue&form=${form.id}`,
      };
}

export interface FollowUpNoticeDeps {
  list: () => Promise<InstanceRow[]>;
  /** Claims the send; false when it was already sent. */
  claim: (row: { instanceId: string; stage: FollowUpNoticeStage; followUpDate: string; recipientEmail: string }) => Promise<boolean>;
  emailOf: (appUserId: string) => Promise<string | null>;
  ring: typeof ringBells;
  excludedNames?: Set<string>;
}

async function claimSend(row: { instanceId: string; stage: FollowUpNoticeStage; followUpDate: string; recipientEmail: string }): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from("form_follow_up_notice_sends")
    .upsert(
      { instance_id: row.instanceId, stage: row.stage, follow_up_date: row.followUpDate, recipient_email: row.recipientEmail },
      { onConflict: "instance_id,stage,follow_up_date", ignoreDuplicates: true },
    )
    .select("instance_id");
  if (error) throw new Error(`Could not record the follow-up notice: ${error.message}`);
  return !!data && data.length > 0;
}

const DEFAULT_DEPS: FollowUpNoticeDeps = {
  list: () => listAllOutstandingFollowUps(),
  claim: claimSend,
  emailOf: accountEmail,
  ring: ringBells,
};

export interface FollowUpNoticeOutcome {
  today: string;
  due: number;
  overdue: number;
  alreadySent: number;
  noRecipient: number;
}

/** Counts only, never a name, an email or a form: the cron route returns this as is. */
export async function runFollowUpNotices(now: Date = new Date(), deps: FollowUpNoticeDeps = DEFAULT_DEPS): Promise<FollowUpNoticeOutcome> {
  const today = businessToday(now);
  const excludedNames = deps.excludedNames ?? configuredExcludedNames();
  const outcome: FollowUpNoticeOutcome = { today, due: 0, overdue: 0, alreadySent: 0, noRecipient: 0 };
  for (const form of await deps.list()) {
    const stage = followUpNoticeStage(form, today);
    if (!stage || !form.followUpDate || isDemoInstance(form)) continue;
    if (!isProductionRecord({ employeeName: form.employeeName, locationName: form.locationName, locationId: form.locationId }, { excludedNames })) continue;
    const email = await deps.emailOf(form.createdBy);
    if (!email) {
      outcome.noRecipient += 1;
      continue;
    }
    if (!(await deps.claim({ instanceId: form.id, stage, followUpDate: form.followUpDate, recipientEmail: email }))) {
      outcome.alreadySent += 1;
      continue;
    }
    const notice = followUpNotice(form, stage);
    await deps.ring([{ recipientEmail: email, ...notice }]);
    outcome[stage] += 1;
  }
  return outcome;
}
