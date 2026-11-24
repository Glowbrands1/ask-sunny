import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";

import type { FormsActor } from "./access";

/**
 * OWNER, 24 Nov 2026, in their words (the approver's name swapped for the invented HR account these tests use):
 * "when someone finaloze form thet get a note that it will be approved by hr or something and that they should get a
 * notification as well that they have sent it for approval. Also have the option to edit the form but also make ure
 * the edited form carries over to Wren as approver so she sees the updated version"
 *
 * Against the real `instances.ts` and `hr-approval.ts`, with the setup of `hr-approval-lifecycle.test.ts`. Invented
 * accounts and an invented employee.
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
const { createInstance, loadInstance, saveInstanceValues, HeldForHrError } = await import("./instances");
const { sendForHrApproval, hrApprovalViewFor, listHrQueue, mayEditWhileWithHr, recordHrEdit } = await import("./hr-approval");

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

/** As the card's PATCH route does it: who may edit past the hold, the save, then the approval history and HR's bell. */
async function saveAsRoute(actor: FormsActor, instanceId: string, values: Record<string, string>) {
  const before = (await loadInstance(instanceId))!;
  const pastHrHold = mayEditWhileWithHr(actor, before.instance);
  await saveInstanceValues(instanceId, { values, checked: {} }, actor.id, { pastHrHold });
  if (pastHrHold) await recordHrEdit(instanceId, actor);
}

describe('"they should get a notification as well that they have sent it for approval"', () => {
  it("the sender's bell says they sent it, and that HR approves it before it is final", async () => {
    const instance = await policyReview();
    await sendForHrApproval(instance.id, manager, null, { acknowledgeUnverifiedPolicy: true });

    const receipt = bells("thistle@example.com");
    expect(receipt).toHaveLength(1);
    expect(receipt[0]).toMatchObject({
      kind: "form_hr_approval_sent",
      title: "You sent a form for HR approval",
      href: `/forms/hr-approval/${instance.id}`,
    });
    expect(String(receipt[0]!.body)).toMatch(/final once HR approves it/);
    // HR still gets the request, and no receipt.
    expect(bells("hr.wren@example.com").map((bell) => bell.kind)).toEqual(["form_hr_approval_request"]);
  });
});

describe('"have the option to edit the form but also make ure the edited form carries over to Wren as approver"', () => {
  it("the manager edits the waiting form; it stays with HR, HR sees the updated version, and HR's bell rings once", async () => {
    const instance = await policyReview();
    await sendForHrApproval(instance.id, manager, null, { acknowledgeUnverifiedPolicy: true });

    // The card lets them edit, and still offers no decision.
    const view = await hrApprovalViewFor(manager, (await loadInstance(instance.id))!.instance);
    expect(view).toMatchObject({ state: "pending", canEdit: true, canDecide: false });

    await saveAsRoute(manager, instance.id, { form_date: "2026-11-20" });
    await saveAsRoute(manager, instance.id, { form_date: "2026-11-19" });

    // Still waiting for HR, and what HR opens is the updated form.
    const reread = (await loadInstance(instance.id))!;
    expect(reread.instance.hrApprovalState).toBe("pending");
    expect(reread.instance.formDate).toBe("2026-11-19");
    expect((await listHrQueue(hr)).map((row) => row.id)).toEqual([instance.id]);

    // HR's bell: one "updated" item until read, not one per save; the history records one edit by the manager.
    const updated = bells("hr.wren@example.com").filter((bell) => bell.kind === "form_hr_approval_updated");
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ title: "A form waiting for your approval was updated", href: `/forms/hr-approval/${instance.id}` });
    const hrView = await hrApprovalViewFor(hr, reread.instance);
    expect(hrView?.history.map((entry) => [entry.action, entry.by])).toEqual([
      ["submitted", "Thistle"],
      ["edited", "Thistle"],
    ]);
  });

  it("nobody else may edit it while it waits", async () => {
    const instance = await policyReview();
    await sendForHrApproval(instance.id, manager, null, { acknowledgeUnverifiedPolicy: true });
    const waiting = (await loadInstance(instance.id))!.instance;
    expect(mayEditWhileWithHr(theirDm, waiting)).toBe(false);
    await expect(saveAsRoute(theirDm, instance.id, { form_date: "2026-11-01" })).rejects.toBeInstanceOf(HeldForHrError);
    // A preview identity is not the creator, whatever id it carries.
    expect(mayEditWhileWithHr({ ...manager, verified: false }, waiting)).toBe(false);
  });
});
