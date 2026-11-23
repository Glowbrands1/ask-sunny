import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope } from "@/types";

import type { FormsActor } from "./access";

/**
 * AN ARCHIVED FORM IS OUT OF HR'S QUEUE (QA, 23 Nov 2026). A duplicate exit draft was archived while it still waited
 * for HR ("pending"), and it kept showing in HR's "Needs your decision": the queue, its count and the 6 AM reminder
 * read every pending draft, archived or not. Now none of them reads an archived form. Archiving changes nothing stored:
 * the form stays "pending", and restoring it puts it back in the queue. Against the real `instances.ts`,
 * `hr-approval.ts` and `hr-approval-reminders.ts`; invented accounts and an invented employee only.
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
const { createInstance, archiveInstance, loadInstance } = await import("./instances");
const { sendForHrApproval, listHrQueue, hrQueueSummary, listMyFormsWithHr, readHrApprovalsFor } = await import("./hr-approval");
const { runHrReminders } = await import("./hr-approval-reminders");
const { HR_REMINDER_KIND, HR_REQUEST_KIND } = await import("./hr-approval-bells");

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

describe("an archived form is out of HR's queue (QA, 23 Nov 2026)", () => {
  it("an archived pending form is absent from the queue and the count; it stays pending, and restoring brings it back", async () => {
    const kept = await pendingDraft("Wren Halloway");
    const duplicate = await pendingDraft("Wren Halloway");
    expect((await listHrQueue(hr)).map((row) => row.id).sort()).toEqual([kept, duplicate].sort());
    expect((await hrQueueSummary(hr))?.pending).toBe(2);

    await archiveInstance(duplicate, HR, true);

    expect((await listHrQueue(hr)).map((row) => row.id)).toEqual([kept]);
    expect((await hrQueueSummary(hr))?.pending).toBe(1);
    // Nothing stored changes: the archived form still says it waits for HR.
    expect((await loadInstance(duplicate))!.instance.hrApprovalState).toBe("pending");

    await archiveInstance(duplicate, HR, false);
    expect((await listHrQueue(hr)).map((row) => row.id).sort()).toEqual([kept, duplicate].sort());
  });

  it("the only pending form archived: the count is 0 and the 6 AM reminder rings no bell", async () => {
    const only = await pendingDraft("Wren Halloway");
    await archiveInstance(only, HR, true);

    expect(await hrQueueSummary(hr, SIX_AM_CENTRAL)).toEqual({ pending: 0, overdue: 0 });
    const outcome = await runHrReminders(SIX_AM_CENTRAL);
    expect(outcome).toMatchObject({ status: "sent", reminded: 0, nothingPending: 1 });
    expect(extra.app_notifications!.filter((row) => row.kind === HR_REMINDER_KIND)).toEqual([]);
  });

  it("archiving a form waiting for HR clears HR's bell for it; restoring it does not ring again", async () => {
    const kept = await pendingDraft("Wren Halloway");
    const duplicate = await pendingDraft("Wren Halloway");
    const unread = () =>
      extra.app_notifications!.filter((row) => row.kind === HR_REQUEST_KIND && row.recipient_email === "hr.orrin@example.com" && !row.read_at);
    expect(unread().map((row) => row.href).sort()).toEqual([`/forms/hr-approval/${kept}`, `/forms/hr-approval/${duplicate}`].sort());

    await archiveInstance(duplicate, HR, true);
    expect(unread().map((row) => row.href), "the bell still points at the archived form").toEqual([`/forms/hr-approval/${kept}`]);

    const before = extra.app_notifications!.length;
    await archiveInstance(duplicate, HR, false);
    expect(extra.app_notifications!.length, "restoring it rang a bell").toBe(before);
    expect(unread().map((row) => row.href)).toEqual([`/forms/hr-approval/${kept}`]);
  });

  it("the manager's own list and the chat's reader leave the archived form out too", async () => {
    const kept = await pendingDraft("Wren Halloway");
    const duplicate = await pendingDraft("Wren Halloway");
    await archiveInstance(duplicate, CREATOR, true);

    expect((await listMyFormsWithHr(manager)).map((row) => row.id)).toEqual([kept]);
    const forHr = await readHrApprovalsFor(HR, true);
    expect(forHr.kind === "hr" ? forHr.queue.map((row) => row.id) : forHr).toEqual([kept]);
  });
});
