import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope } from "@/types";

import type { FormsActor } from "./access";
import { approvableFromSentBack } from "./hr-approval-rules";

/**
 * APPROVE FROM "SENT BACK", ONCE THE MANAGER HAS REPLIED (Pau, via QA, 23 Nov 2026), against the real `instances.ts`
 * and `hr-approval.ts`:
 *
 *   "when manager replies in note, there should be approve button here please and notify manager, then it will show in
 *    form monitoring for that manager only for her salon but of course [the person who sees every salon] will be able
 *    to see all. then the manager once sent back, will have option to print and save as PDF"
 *
 * The screen: a form "Sent back by HR for changes", its thread (sent for approval with a note, HR sent it back with a
 * note, the manager replied with a note), then a Note box with Add note. HR now has Approve beside Add note; approving
 * finalizes the form as it is, records "HR approved it", and rings the manager's bell. Afterwards the form is an
 * ordinary finalized form: its own salon's managers and every-salon accounts see it in Form Monitoring, another salon's
 * manager never does. Invented accounts and an invented employee only.
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
const { createInstance, loadInstance, saveInstanceValues } = await import("./instances");
const { sendForHrApproval, decideHrApproval, commentOnHrApproval, hrApprovalViewFor, HrApprovalError, listHrQueue, hrQueueSummary, needsHrDecision, recordHrEdit } =
  await import("./hr-approval");
const { actorMaySeeInstance } = await import("./instance-scope");

const CREATOR = "sd-marigold";
const HR = "hr-fenwick";

const WORNALL: AccessScope = { level: "salon", primaryAreaId: "loc-wornall", alsoCoversAreaIds: [] };
const OTHER_SALON: AccessScope = { level: "salon", primaryAreaId: "loc-other", alsoCoversAreaIds: [] };
const GLOBAL: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

const manager: FormsActor = { id: CREATOR, role: "salon_director", verified: true, scope: WORNALL, visibility: WORNALL, hrApprover: false } as FormsActor;
const hr: FormsActor = { id: HR, role: "district_manager", verified: true, scope: GLOBAL, visibility: GLOBAL, hrApprover: true } as FormsActor;

const SENT_NOTE = "Please review — second late opening this month.";
const SEND_BACK_NOTE = "Add the date of the first late opening.";
const REPLY_NOTE = "The first one was 11/12, I added it.";

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
    { id: HR, email: "hr.fenwick@example.com", display_name: "Fenwick", status: "active" },
    { id: CREATOR, email: "marigold@example.com", display_name: "Marigold", status: "active" },
  ];
  await ensureTemplateLibrary("system");
});
afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.useRealTimers();
});

async function policyReview() {
  return createInstance({
    templateKey: "policy-review",
    variantKey: null,
    employeeName: "Juniper Ashdown",
    employeeRole: "Tanning Consultant",
    locationId: "loc-wornall",
    locationName: "KC Wornall",
    createdBy: CREATOR,
    source: "manual",
    formDate: "2026-11-23",
  });
}

/** Each step a minute apart, so the approval history's order is the order things happened. */
let minute = 0;
function tick() {
  minute += 1;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.UTC(2026, 10, 23, 15, minute)));
}

/** The screen's thread: sent with a note, sent back with a note, and (when `replied`) the manager's reply. */
async function sentBack(replied: boolean) {
  minute = 0;
  const instance = await policyReview();
  tick();
  await sendForHrApproval(instance.id, manager, "2026-12-01", { acknowledgeUnverifiedPolicy: true });
  tick();
  await commentOnHrApproval(instance.id, manager, SENT_NOTE);
  tick();
  await decideHrApproval(instance.id, hr, "send_back", SEND_BACK_NOTE);
  if (replied) {
    tick();
    await commentOnHrApproval(instance.id, manager, REPLY_NOTE);
  }
  tick();
  return (await loadInstance(instance.id))!.instance;
}

const bells = (to: string) => extra.app_notifications!.filter((row) => row.recipient_email === to);

describe("HR approves a form it sent back, once the manager has replied (Pau)", () => {
  it("Approve sits beside Add note for HR only, and only after the manager's reply", async () => {
    const waiting = await sentBack(false);
    expect((await hrApprovalViewFor(hr, waiting))?.canApproveSentBack, "no reply yet").toBe(false);

    await commentOnHrApproval(waiting.id, manager, REPLY_NOTE);
    const replied = (await loadInstance(waiting.id))!.instance;
    const hrView = await hrApprovalViewFor(hr, replied);
    expect(hrView?.label).toBe("Sent back by HR for changes");
    expect(hrView?.canApproveSentBack).toBe(true);
    // Send back and Reject stay for a form waiting for HR; this one is sent back.
    expect(hrView?.canDecide).toBe(false);
    expect((await hrApprovalViewFor(manager, replied))?.canApproveSentBack, "the manager never sees Approve").toBe(false);
  });

  it("approving it finalizes the form as it is, records HR's approval in the thread, and rings the manager's bell", async () => {
    const replied = await sentBack(true);
    const before = bells("marigold@example.com").length;

    const approved = await decideHrApproval(replied.id, hr, "approve", undefined);
    expect(approved.status).toBe("finalized");
    expect(approved.hrApprovalState).toBe("approved");

    const thread = await hrApprovalViewFor(manager, approved);
    expect(thread?.history.map((entry) => [entry.by, entry.action])).toEqual([
      ["You", "submitted"],
      ["You", "commented"],
      ["HR", "changes_requested"],
      ["You", "commented"],
      ["HR", "approved"],
    ]);
    const rung = bells("marigold@example.com").slice(before);
    expect(rung).toHaveLength(1);
    expect(rung[0]).toMatchObject({ title: "HR approved your form", href: `/forms/hr-approval/${replied.id}` });
  });

  it("refused before the manager replies, and for anyone but HR", async () => {
    const waiting = await sentBack(false);
    await expect(decideHrApproval(waiting.id, hr, "approve", undefined)).rejects.toThrow(/once the manager replies/);
    await commentOnHrApproval(waiting.id, manager, REPLY_NOTE);
    await expect(decideHrApproval(waiting.id, manager, "approve", undefined)).rejects.toBeInstanceOf(HrApprovalError);
    expect((await loadInstance(waiting.id))!.instance.status).toBe("draft");
  });

  /*
   * EDITING ALONE IS THE MANAGER'S REPLY. Asked "Do you want editing alone to count as a reply too? Then HR would get
   * Approve as soon as the manager changes anything on a sent-back form", the owner answered (24 Nov 2026): "yeh".
   */
  it.each([
    ["on the card", {}],
    ["in chat", { via: "chat" as const }],
  ])("the manager edits the sent-back form %s, without a note: \"Manager replied to changes\", HR is told, and HR can approve it", async (_where, options) => {
    const waiting = await sentBack(false);
    await saveInstanceValues(waiting.id, { values: { form_date: "2026-11-21" }, checked: {} }, CREATOR, options);
    expect((await listHrQueue(hr)).map((row) => [row.id, row.managerReplied])).toEqual([[waiting.id, true]]);
    expect((await hrQueueSummary(hr))!.pending).toBe(1);
    expect((await hrApprovalViewFor(hr, (await loadInstance(waiting.id))!.instance))?.canApproveSentBack).toBe(true);
    const updated = bells("hr.fenwick@example.com").filter((row) => row.kind === "form_hr_approval_updated");
    expect(updated.map((row) => row.title)).toEqual(["A form you sent back was updated"]);
    expect(String(updated[0]!.body)).toMatch(/changed by Marigold\. You can approve it now, or send it back again\.$/);
    const approved = await decideHrApproval(waiting.id, hr, "approve", undefined);
    expect(approved).toMatchObject({ status: "finalized", hrApprovalState: "approved" });
  });

  it("control: a save that changes nothing, or HR's own edit, is not the manager's reply", async () => {
    const waiting = await sentBack(false);
    const stored = (await loadInstance(waiting.id))!.values.find((row) => row.fieldKey === "form_date")?.value ?? "";
    await saveInstanceValues(waiting.id, { values: { form_date: stored }, checked: {} }, CREATOR);
    await recordHrEdit(waiting.id, hr);
    expect((await hrApprovalViewFor(hr, (await loadInstance(waiting.id))!.instance))?.canApproveSentBack).toBe(false);
    await expect(decideHrApproval(waiting.id, hr, "approve", undefined)).rejects.toThrow(/once the manager replies with a note, edits it, or sends it again/);
  });

  it("control: HR's own note after sending it back is not the manager's reply", async () => {
    const waiting = await sentBack(false);
    await commentOnHrApproval(waiting.id, hr, "Any update?");
    expect((await hrApprovalViewFor(hr, (await loadInstance(waiting.id))!.instance))?.canApproveSentBack).toBe(false);
    await expect(decideHrApproval(waiting.id, hr, "approve", undefined)).rejects.toThrow(/once the manager replies/);
  });

  /*
   * CHANGED ON PURPOSE (QA, 23 Nov 2026): from the manager-replied stage HR gets Approve AND Send back again (with a
   * note), not Reject — HR may still need more changes after the reply.
   */
  it("after the reply, HR may send it back again with a note: it waits on the manager again and the manager's bell rings", async () => {
    const replied = await sentBack(true);
    expect((await hrApprovalViewFor(hr, replied))?.canApproveSentBack).toBe(true);
    await expect(decideHrApproval(replied.id, hr, "send_back", undefined), "a note is required").rejects.toThrow(/Add a note/);
    const before = bells("marigold@example.com").length;

    const again = await decideHrApproval(replied.id, hr, "send_back", "Also add the second date.");
    expect(again.status).toBe("draft");
    expect(again.hrApprovalState).toBe("changes_requested");
    const rung = bells("marigold@example.com").slice(before);
    expect(rung).toHaveLength(1);
    expect(rung[0]).toMatchObject({ title: "HR sent your form back for changes" });
    expect(String(rung[0]!.body)).toContain("Also add the second date.");

    // Back to "Waiting on the manager": not counted, no Approve until the manager replies again.
    const [row] = await listHrQueue(hr);
    expect(row).toMatchObject({ id: replied.id, state: "changes_requested", managerReplied: false });
    expect((await hrQueueSummary(hr))?.pending).toBe(0);
    expect((await hrApprovalViewFor(hr, again))?.canApproveSentBack).toBe(false);
    await expect(decideHrApproval(replied.id, hr, "approve", undefined)).rejects.toThrow(/once the manager replies/);
  });

  it("control: reject still needs the form to be waiting for HR", async () => {
    const replied = await sentBack(true);
    await expect(decideHrApproval(replied.id, hr, "reject", "No")).rejects.toThrow(/not waiting for HR approval/);
  });

  it("control: a sent-back form with no reply cannot be sent back again", async () => {
    const waiting = await sentBack(false);
    await expect(decideHrApproval(waiting.id, hr, "send_back", "Again")).rejects.toThrow(/once the manager replies/);
  });
});

describe("after approval, Form Monitoring shows it by salon, as any finalized form (Pau)", () => {
  it("the manager of its salon and an every-salon account see it; another salon's manager never does", async () => {
    const replied = await sentBack(true);
    const approved = await decideHrApproval(replied.id, hr, "approve", undefined);
    const otherSalonManager = { ...manager, id: "sd-larkspur", scope: OTHER_SALON, visibility: OTHER_SALON } as FormsActor;
    const sameSalonManager = { ...manager, id: "asd-wornall", role: "assistant_salon_director", scope: WORNALL, visibility: WORNALL } as FormsActor;
    const everySalon = { ...manager, id: "admin-rowan", role: "admin", scope: GLOBAL, visibility: GLOBAL } as FormsActor;
    expect(actorMaySeeInstance(manager, approved)).toBe(true);
    expect(actorMaySeeInstance(sameSalonManager, approved)).toBe(true);
    expect(actorMaySeeInstance(everySalon, approved)).toBe(true);
    expect(actorMaySeeInstance(otherSalonManager, approved), "another salon's manager sees it").toBe(false);
    // Who approved it and every note stay with its creator, its senders and HR (the owner's rule, unchanged).
    expect(await hrApprovalViewFor(sameSalonManager, approved)).toBeNull();
    expect(await hrApprovalViewFor(everySalon, approved)).toBeNull();
  });
});

describe("approvableFromSentBack (the rule)", () => {
  const instance = { createdBy: CREATOR, hrApprovalState: "changes_requested" as const, hrApprovalRequestedBy: CREATOR, hrApprovalSenders: [CREATOR] };
  const at = (minuteOf: number) => new Date(Date.UTC(2026, 10, 23, 15, minuteOf)).toISOString();

  it("a reply from the creator or a sender after the latest send-back", () => {
    expect(approvableFromSentBack(instance, [
      { action: "submitted", actor: CREATOR, at: at(1) },
      { action: "changes_requested", actor: HR, at: at(2) },
      { action: "commented", actor: CREATOR, at: at(3) },
    ])).toBe(true);
  });

  it("not a reply older than the latest send-back", () => {
    expect(approvableFromSentBack(instance, [
      { action: "changes_requested", actor: HR, at: at(2) },
      { action: "commented", actor: CREATOR, at: at(3) },
      { action: "submitted", actor: CREATOR, at: at(4) },
      { action: "changes_requested", actor: HR, at: at(5) },
    ])).toBe(false);
  });

  it("not a rejected form, and not a waiting one", () => {
    const events = [{ action: "changes_requested", actor: HR, at: at(2) }, { action: "commented", actor: CREATOR, at: at(3) }];
    expect(approvableFromSentBack({ ...instance, hrApprovalState: "rejected" }, events)).toBe(false);
    expect(approvableFromSentBack({ ...instance, hrApprovalState: "pending" }, events)).toBe(false);
  });
});

describe("HR's list: \"Manager replied to changes\", and the count matches the rows that need HR (Pau)", () => {
  it("one form in each state: waiting, sent back, sent back and replied to, rejected", async () => {
    const waiting = await policyReview();
    tick();
    await sendForHrApproval(waiting.id, manager, null, { acknowledgeUnverifiedPolicy: true });
    const noReply = await sentBack(false);
    const replied = await sentBack(true);
    const rejected = await policyReview();
    tick();
    await sendForHrApproval(rejected.id, manager, null, { acknowledgeUnverifiedPolicy: true });
    tick();
    await decideHrApproval(rejected.id, hr, "reject", "Not a policy review.");
    tick();
    await commentOnHrApproval(rejected.id, manager, "Understood.");

    const rows = await listHrQueue(hr);
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(waiting.id)).toMatchObject({ state: "pending", managerReplied: false });
    expect(byId.get(noReply.id)).toMatchObject({ state: "changes_requested", managerReplied: false });
    expect(byId.get(replied.id)).toMatchObject({ state: "changes_requested", managerReplied: true });
    // A rejected form is not approvable from a reply (Pau named only "sent back").
    expect(byId.get(rejected.id)).toMatchObject({ state: "rejected", managerReplied: false });

    // The ones needing HR come first: waiting, then replied to; then the ones waiting on the manager.
    expect(rows.slice(0, 2).map((row) => row.id)).toEqual([waiting.id, replied.id]);
    const summary = await hrQueueSummary(hr);
    expect(summary?.pending, "Pending HR approval (N) is not the rows that need HR").toBe(rows.filter(needsHrDecision).length);
    expect(summary?.pending).toBe(2);
  });

  it("Pau's report: one sent-back form, the manager replied — the tab counts it (it read 0 with the row listed)", async () => {
    await sentBack(true);
    const rows = await listHrQueue(hr);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.managerReplied).toBe(true);
    expect((await hrQueueSummary(hr))?.pending).toBe(1);
  });

  it("control: sent back with no reply is listed for HR but not counted; once HR approves it, it leaves the list", async () => {
    const waiting = await sentBack(false);
    expect((await listHrQueue(hr)).map((row) => row.id)).toEqual([waiting.id]);
    expect((await hrQueueSummary(hr))?.pending).toBe(0);
    await commentOnHrApproval(waiting.id, manager, REPLY_NOTE);
    expect((await hrQueueSummary(hr))?.pending).toBe(1);
    await decideHrApproval(waiting.id, hr, "approve", undefined);
    expect(await listHrQueue(hr)).toEqual([]);
    expect((await hrQueueSummary(hr))?.pending).toBe(0);
  });
});
