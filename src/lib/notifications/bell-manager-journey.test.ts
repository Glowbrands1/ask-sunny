import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope } from "@/types";

import type { FormsActor } from "@/lib/forms/access";

/**
 * THE MANAGER'S BELL, START TO FINISH (owner, 24 Nov 2026), against the real `hr-approval.ts` and the layout's `bellFor`:
 *
 *   "i need a bell for all users/managers for when HR send back their forms"
 *   "and also when HR approved it , need notification"
 *   "when manager send forms should have notif - u sent form for approval, HR replied back, form approved - then they
 *    view it and they can print it"
 *   "should be all for users"
 *
 * A salon manager who has never had a notification sends a form to HR, HR writes back, sends it back, the manager
 * replies, HR approves. At every step the manager has a bell, and it carries that step; every item links to the form's
 * page, which the manager may open, and the approved form is finalized, so its card offers Print and Download PDF.
 * Invented accounts and an invented employee only.
 */

const ORIGINAL = { ...process.env };

const store = {
  form_instances: [],
  form_instance_values: [],
  form_instance_events: [],
  form_template_versions: [],
  form_templates: [],
  form_template_current: [],
  form_template_assets: [],
} as unknown as FakeStore;
const extra = store as unknown as Record<string, Record<string, unknown>[]>;

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));

const { ensureTemplateLibrary } = await import("@/lib/forms/repository");
const { createInstance, loadInstance } = await import("@/lib/forms/instances");
const { sendForHrApproval, decideHrApproval, commentOnHrApproval } = await import("@/lib/forms/hr-approval");
const { mayReadHrDecision } = await import("@/lib/forms/hr-approval-rules");
const { formHref } = await import("@/lib/forms/hr-approval-bells");
const { bellFor } = await import("./bell-for");

const MANAGER = "sd-quillon";
const MANAGER_EMAIL = "quillon@example.com";
const HR = "hr-brackley";

const SALON: AccessScope = { level: "salon", primaryAreaId: "loc-larkspur", alsoCoversAreaIds: [] };
const GLOBAL: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const manager = { id: MANAGER, role: "salon_director", verified: true, scope: SALON, visibility: SALON, hrApprover: false } as FormsActor;
const hr = { id: HR, role: "district_manager", verified: true, scope: GLOBAL, visibility: GLOBAL, hrApprover: true } as FormsActor;

let minute = 0;
function tick() {
  minute += 1;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.UTC(2026, 10, 24, 15, minute)));
}

beforeEach(async () => {
  process.env.FORMS_HR_APPROVAL_ENABLED = "true";
  for (const table of Object.keys(store)) extra[table] = [];
  extra.form_hr_approvers = [{ app_user_id: HR, revoked_at: null }];
  extra.form_hr_approval_events = [];
  extra.app_notifications = [];
  extra.app_users = [
    { id: HR, email: "hr.brackley@example.com", display_name: "Brackley", status: "active" },
    { id: MANAGER, email: MANAGER_EMAIL, display_name: "Quillon", status: "active" },
  ];
  minute = 0;
  await ensureTemplateLibrary("system");
});
afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.useRealTimers();
});

/** The manager's bell as the rail gets it, newest first. */
const titles = async () => ((await bellFor({ email: MANAGER_EMAIL }))?.items ?? []).map((item) => item.title);

describe("a manager's bell, from sending a form to HR to printing it", () => {
  it("has a bell before anything happens, then each step: sent, HR's note, sent back, approved; and the approved form opens to print", async () => {
    expect(await bellFor({ email: MANAGER_EMAIL }), "no bell for a manager who never had a notification").not.toBeNull();
    expect(await titles()).toEqual([]);

    const form = await createInstance({
      templateKey: "policy-review",
      variantKey: null,
      employeeName: "Tobiah Wrenfield",
      employeeRole: "Tanning Consultant",
      locationId: "loc-larkspur",
      locationName: "Larkspur",
      createdBy: MANAGER,
      source: "manual",
      formDate: "2026-11-24",
    });

    tick();
    await sendForHrApproval(form.id, manager, "2026-12-01", { acknowledgeUnverifiedPolicy: true });
    expect(await titles(), "u sent form for approval").toEqual(["You sent a form for HR approval"]);

    tick();
    await commentOnHrApproval(form.id, hr, "Which day was the first warning?");
    expect((await titles())[0], "HR replied back").toBe("HR added a note to your form");

    tick();
    await decideHrApproval(form.id, hr, "send_back", "Add the date of the first warning.");
    expect((await titles())[0], "HR sent it back").toBe("HR sent your form back for changes");

    tick();
    await commentOnHrApproval(form.id, manager, "It was 11/10, added.");
    tick();
    const approved = await decideHrApproval(form.id, hr, "approve", undefined);
    const bell = await bellFor({ email: MANAGER_EMAIL });
    expect(bell?.items.map((item) => item.title)).toEqual([
      "HR approved your form",
      "HR sent your form back for changes",
      "HR added a note to your form",
      "You sent a form for HR approval",
    ]);
    expect(bell?.items.every((item) => !item.readAt), "every step is unread until the manager opens it").toBe(true);

    // "then they view it and they can print it": every item opens the form's page, which the manager may read, and
    // the approved form is finalized, which is when its card offers Print and Download PDF.
    expect(new Set(bell?.items.map((item) => item.href))).toEqual(new Set([formHref(form.id)]));
    const loaded = (await loadInstance(form.id))!.instance;
    expect(mayReadHrDecision(manager, loaded)).toBe(true);
    expect(approved.status).toBe("finalized");
    expect(approved.hrApprovalState).toBe("approved");
  });
});
