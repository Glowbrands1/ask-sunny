import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";

import type { FormsActor } from "./access";

/**
 * HR APPROVAL, THE WHOLE ROUND TRIP (owner request, 23 Nov 2026), against the real `instances.ts` and `hr-approval.ts`:
 *
 *   the manager presses "Finalize and send for approval"   → still a draft, pending; HR's bell rings
 *   the manager tries to change it                          → refused while HR has it
 *   HR edits it                                             → saved, in the approval history only
 *   HR sends it back without a note                         → refused: a note is required
 *   HR sends it back with a note                            → the manager's bell rings; they may edit and send again
 *   HR approves                                             → finalized, approved; the form's own history names the
 *                                                             manager, never HR
 *
 * Invented accounts and an invented employee.
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
const { createInstance, loadInstance, saveInstanceValues, finalizeInstance, HeldForHrError } = await import("./instances");
const { sendForHrApproval, decideHrApproval, commentOnHrApproval, hrApprovalViewFor, finalizeGoesToHr, listHrQueue, readHrApprovalsFor, recordHrEdit, HrApprovalError } =
  await import("./hr-approval");

const CREATOR = "sd-thistle";
const HR = "hr-wren-oakfield";

const manager: FormsActor = { id: CREATOR, role: "salon_director", verified: true, scope: null, visibility: null, hrApprover: false };
const hr: FormsActor = { id: HR, role: "district_manager", verified: true, scope: null, visibility: null, hrApprover: true };
const theirDm: FormsActor = { id: "dm-bramble", role: "district_manager", verified: true, scope: null, visibility: null, hrApprover: false };

beforeEach(async () => {
  process.env.FORMS_HR_APPROVAL_ENABLED = "true";
  store.form_instances = [];
  store.form_instance_values = [];
  store.form_instance_events = [];
  store.form_template_versions = [];
  store.form_templates = [];
  store.form_template_current = [];
  store.form_template_assets = [];
  extra.form_hr_approvers = [{ app_user_id: HR, revoked_at: null }];
  extra.form_hr_approval_events = [];
  extra.app_notifications = [];
  extra.app_users = [
    { id: HR, email: "hr.wren@example.com", display_name: "Wren", status: "active" },
    { id: CREATOR, email: "thistle@example.com", display_name: "Thistle", status: "active" },
  ];
  await ensureTemplateLibrary("system");
});
afterEach(() => {
  process.env = { ...ORIGINAL };
});

async function policyReview() {
  return createInstance({
    templateKey: "policy-review",
    variantKey: null,
    employeeName: "Juniper Calloway",
    employeeRole: "Tanning Consultant",
    locationId: "loc-wornall",
    locationName: "KC Wornall",
    createdBy: CREATOR,
    source: "manual",
    formDate: "2026-11-23",
  });
}

const bells = (to: string) => extra.app_notifications!.filter((row) => row.recipient_email === to);

describe("which Finalize goes to HR", () => {
  it("a manager's Policy Review does; their Coaching Form does not; HR's own form does not; with no approver, or off, nothing does", async () => {
    const instance = await policyReview();
    expect(await finalizeGoesToHr(manager, instance)).toBe(true);
    const coaching = await createInstance({
      templateKey: "coaching", variantKey: null, employeeName: "Juniper Calloway", employeeRole: null,
      locationId: "loc-wornall", locationName: "KC Wornall", createdBy: CREATOR, source: "manual", formDate: "2026-11-23",
    });
    expect(await finalizeGoesToHr(manager, coaching)).toBe(false);
    expect(await finalizeGoesToHr(hr, instance)).toBe(false);
    // No active approver: nobody could approve it, so Finalize finalizes as before (owner, 23 Nov 2026).
    extra.form_hr_approvers = [{ app_user_id: HR, revoked_at: "2026-11-23T00:00:00Z" }];
    expect(await finalizeGoesToHr(manager, instance)).toBe(false);
    extra.form_hr_approvers = [];
    expect(await finalizeGoesToHr(manager, instance)).toBe(false);
    extra.form_hr_approvers = [{ app_user_id: HR, revoked_at: null }];
    delete process.env.FORMS_HR_APPROVAL_ENABLED;
    expect(await finalizeGoesToHr(manager, instance)).toBe(false);
  });
});

describe("the round trip", () => {
  it("send, hold, HR edit, send back, resend, approve", async () => {
    const instance = await policyReview();

    // 1. Sent: still a draft, pending; HR's bell rings with the form, never another manager's.
    const sent = await sendForHrApproval(instance.id, manager, "2026-12-01", { acknowledgeUnverifiedPolicy: true });
    expect(sent.status).toBe("draft");
    expect(sent.hrApprovalState).toBe("pending");
    expect(bells("hr.wren@example.com")).toHaveLength(1);
    expect(bells("hr.wren@example.com")[0]).toMatchObject({ kind: "form_hr_approval_request", href: `/forms/hr-approval/${instance.id}` });
    await expect(sendForHrApproval(instance.id, manager, null)).rejects.toThrow(/already waiting/);

    // 2. The manager cannot change it, and plain Finalize cannot freeze it, while HR has it.
    await expect(saveInstanceValues(instance.id, { values: {}, checked: {} }, CREATOR)).rejects.toBeInstanceOf(HeldForHrError);
    await expect(finalizeInstance(instance.id, CREATOR, null)).rejects.toBeInstanceOf(HeldForHrError);

    // 3. HR's queue has it; a District Manager reads nothing about it.
    expect((await listHrQueue(hr)).map((row) => row.id)).toEqual([instance.id]);
    expect(await listHrQueue(theirDm)).toEqual([]);
    expect(await hrApprovalViewFor(theirDm, (await loadInstance(instance.id))!.instance)).toBeNull();

    // 4. HR edits it: saved through the one path past the hold, recorded in the approval history only.
    const eventsBefore = store.form_instance_events!.length;
    // As the PATCH route does it: the save, then the approval history's "edited".
    await saveInstanceValues(instance.id, { values: { form_date: "2026-11-22" }, checked: {} }, HR, { asHrApprover: true });
    await recordHrEdit(instance.id, hr);
    expect((await loadInstance(instance.id))!.instance.formDate).toBe("2026-11-22");
    expect(store.form_instance_events!.length, "HR's edit reached the form's general history").toBe(eventsBefore);

    // 5. Send back needs a note; with one, the manager's bell rings and they may change it again.
    await expect(decideHrApproval(instance.id, hr, "send_back", "  ")).rejects.toBeInstanceOf(HrApprovalError);
    await expect(decideHrApproval(instance.id, manager, "approve", null)).rejects.toThrow(/Only HR/);
    const back = await decideHrApproval(instance.id, hr, "send_back", "Please add the date she was told.");
    expect(back.hrApprovalState).toBe("changes_requested");
    expect(bells("thistle@example.com")[0]).toMatchObject({ kind: "form_hr_approval_decision", title: "HR sent your form back for changes" });
    await saveInstanceValues(instance.id, { values: { form_date: "2026-11-21" }, checked: {} }, CREATOR);

    // 6. The manager's reply and HR's note: only the two of them read the history.
    await commentOnHrApproval(instance.id, manager, "Added it.");
    const view = await hrApprovalViewFor(manager, (await loadInstance(instance.id))!.instance);
    expect(view?.history.map((entry) => [entry.action, entry.by])).toEqual([
      ["submitted", "You"],
      ["edited", "HR"],
      ["changes_requested", "HR"],
      ["commented", "You"],
    ]);
    expect(view?.history.find((entry) => entry.action === "changes_requested")?.note).toBe("Please add the date she was told.");
    expect((await readHrApprovalsFor(CREATOR, true)).kind).toBe("manager");

    // 7. Sent again, then approved: finalized and approved in one write; the general history names the manager.
    await sendForHrApproval(instance.id, manager, "2026-12-01", { acknowledgeUnverifiedPolicy: true });
    const approved = await decideHrApproval(instance.id, hr, "approve", null);
    expect(approved.status).toBe("finalized");
    const row = store.form_instances!.find((entry) => entry.id === instance.id)!;
    expect(row).toMatchObject({ hr_approval_state: "approved", hr_approval_decided_by: HR, follow_up_date: "2026-12-01" });
    const finalized = store.form_instance_events!.filter((event) => event.instance_id === instance.id && event.kind === "finalized");
    expect(finalized.map((event) => event.actor)).toEqual([CREATOR]);
    expect(JSON.stringify(store.form_instance_events)).not.toContain(HR);
    expect(bells("thistle@example.com").map((bell) => bell.title)).toContain("HR approved your form");
    // HR's request bells for it are read once decided.
    expect(bells("hr.wren@example.com").filter((bell) => bell.kind === "form_hr_approval_request" && !bell.read_at)).toHaveLength(0);
  });

  it("reject needs a note too, and only a pending form can be decided", async () => {
    const instance = await policyReview();
    await expect(decideHrApproval(instance.id, hr, "approve", null)).rejects.toThrow(/not waiting/);
    await sendForHrApproval(instance.id, manager, null, { acknowledgeUnverifiedPolicy: true });
    await expect(decideHrApproval(instance.id, hr, "reject", "")).rejects.toThrow(/why the form is rejected/);
    const rejected = await decideHrApproval(instance.id, hr, "reject", "This is not a policy review matter.");
    expect(rejected.hrApprovalState).toBe("rejected");
    expect(rejected.status).toBe("draft");
  });

  it("only the manager who created the form sends it", async () => {
    const instance = await policyReview();
    await expect(sendForHrApproval(instance.id, theirDm, null, { acknowledgeUnverifiedPolicy: true })).rejects.toThrow(/Only the manager who created/);
  });
});
