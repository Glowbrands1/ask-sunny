import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope } from "@/types";

import type { FormsActor } from "./access";

/**
 * ARCHIVING WAS REMOVED (Pau, 23 Nov 2026), on purpose, so the rule this file held ("an archived form is out of HR's
 * queue, its count and the reminder bell", QA, 23 Nov 2026, #1300) is moot: nothing is archived after the unarchive
 * migration. What QA wanted is kept: a duplicate pending draft that is taken away (deleted from Form Monitoring, the
 * only way left) is absent from HR's queue, its count and the 6 AM reminder. The "archive clears the bell" and
 * "restoring brings it back" tests went with the action. Against the real `instances.ts`, `hr-approval.ts` and
 * `hr-approval-reminders.ts`; invented accounts and an invented employee only.
 */

const ORIGINAL = { ...process.env };

const store: FakeStore = {
  form_instances: [],
  form_instance_values: [],
  form_instance_events: [],
  form_template_versions: [],
  form_templates: [],
  form_template_current: [],
  form_template_assets: [],
} as FakeStore;
const extra = store as unknown as Record<string, Record<string, unknown>[]>;

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));

const { ensureTemplateLibrary } = await import("./repository");
const { createInstance, deleteInstance } = await import("./instances");
const { sendForHrApproval, listHrQueue, hrQueueSummary, listMyFormsWithHr, readHrApprovalsFor } = await import("./hr-approval");
const { runHrReminders } = await import("./hr-approval-reminders");
const { HR_REMINDER_KIND } = await import("./hr-approval-bells");

const CREATOR = "sd-tamsin";
const HR = "hr-orrin";
const WORNALL: AccessScope = { level: "salon", primaryAreaId: "loc-wornall", alsoCoversAreaIds: [] };
const GLOBAL: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const manager = { id: CREATOR, role: "salon_director", verified: true, scope: WORNALL, visibility: WORNALL, hrApprover: false } as FormsActor;
const hr = { id: HR, role: "district_manager", verified: true, scope: GLOBAL, visibility: GLOBAL, hrApprover: true } as FormsActor;

/** Monday 23 Nov 2026, 12:05 UTC: 6:05 AM Central, when the weekday reminder goes out. */
const SIX_AM_CENTRAL = new Date(Date.UTC(2026, 10, 23, 12, 5));

beforeEach(async () => {
  process.env.FORMS_HR_APPROVAL_ENABLED = "true";
  for (const table of Object.keys(store)) (store as unknown as Record<string, unknown[]>)[table] = [];
  extra.form_hr_approvers = [{ app_user_id: HR, revoked_at: null }];
  extra.form_hr_approval_events = [];
  extra.form_hr_reminder_sends = [];
  extra.app_notifications = [];
  extra.app_users = [
    { id: HR, email: "hr.orrin@example.com", display_name: "Orrin", status: "active" },
    { id: CREATOR, email: "tamsin@example.com", display_name: "Tamsin", status: "active" },
  ];
  await ensureTemplateLibrary("system");
});
afterEach(() => {
  process.env = { ...ORIGINAL };
});

/** A draft sent to HR and still waiting for them. */
async function pendingDraft(employeeName: string) {
  const instance = await createInstance({
    templateKey: "policy-review",
    variantKey: null,
    employeeName,
    employeeRole: "Tanning Consultant",
    locationId: "loc-wornall",
    locationName: "KC Wornall",
    createdBy: CREATOR,
    source: "manual",
    formDate: "2026-11-23",
  });
  await sendForHrApproval(instance.id, manager, "2026-12-01", { acknowledgeUnverifiedPolicy: true });
  return instance.id;
}

describe("a removed duplicate is out of HR's queue (QA, 23 Nov 2026; archiving removed the same day)", () => {
  it("a deleted pending form is absent from the queue and the count", async () => {
    const kept = await pendingDraft("Wren Halloway");
    const duplicate = await pendingDraft("Wren Halloway");
    expect((await listHrQueue(hr)).map((row) => row.id).sort()).toEqual([kept, duplicate].sort());
    expect((await hrQueueSummary(hr))?.pending).toBe(2);

    await deleteInstance(duplicate);

    expect((await listHrQueue(hr)).map((row) => row.id)).toEqual([kept]);
    expect((await hrQueueSummary(hr))?.pending).toBe(1);
  });

  it("the only pending form deleted: the count is 0 and the 6 AM reminder rings no bell", async () => {
    const only = await pendingDraft("Wren Halloway");
    await deleteInstance(only);

    expect(await hrQueueSummary(hr, SIX_AM_CENTRAL)).toEqual({ pending: 0, overdue: 0 });
    const outcome = await runHrReminders(SIX_AM_CENTRAL);
    expect(outcome).toMatchObject({ status: "sent", reminded: 0, nothingPending: 1 });
    expect(extra.app_notifications!.filter((row) => row.kind === HR_REMINDER_KIND)).toEqual([]);
  });

  it("the manager's own list and the chat's reader leave the deleted form out too", async () => {
    const kept = await pendingDraft("Wren Halloway");
    const duplicate = await pendingDraft("Wren Halloway");
    await deleteInstance(duplicate);

    expect((await listMyFormsWithHr(manager)).map((row) => row.id)).toEqual([kept]);
    const forHr = await readHrApprovalsFor(HR, true);
    expect(forHr.kind === "hr" ? forHr.queue.map((row) => row.id) : forHr).toEqual([kept]);
  });
});
