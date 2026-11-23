import { extractText, getDocumentProxy } from "unpdf";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope } from "@/types";

import type { FormsActor } from "@/lib/forms/access";

/**
 * "of course the notes should not show in PDF" (Pau, via QA, 23 Nov 2026). A form HR approved from "sent back", with a
 * note on every step of its thread, is printed through the real PDF route (`/api/forms/instances/[id]/pdf`, the real
 * renderer): the form's own content is there, and not one word of the approval thread is. Invented people only.
 */

const ORIGINAL = { ...process.env };
const WORNALL: AccessScope = { level: "salon", primaryAreaId: "loc-wornall", alsoCoversAreaIds: [] };
const GLOBAL: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const CREATOR = "sd-marigold";
const HR = "hr-fenwick";

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
vi.mock("@/lib/auth/server", async () => {
  const { DEFAULT_PERMISSION_MATRIX, hasPermission } = await import("@/lib/permissions");
  const { AuthError } = await import("@/lib/auth/types");
  return {
    authorizeRequest: async (_request: Request, permission: string) => {
      if (!hasPermission(DEFAULT_PERMISSION_MATRIX, "salon_director" as never, permission as never)) throw new AuthError("forbidden", "No.");
      return {
        identity: { subject: CREATOR, email: "marigold@example.com", displayName: "Marigold", role: "salon_director", scope: WORNALL, verified: true },
        permission,
        provider: "supabase",
      };
    },
  };
});
vi.mock("@/lib/forms/forms-visibility", () => ({ resolveFormsVisibility: async () => WORNALL }));

const { ensureTemplateLibrary } = await import("@/lib/forms/repository");
const { createInstance, saveInstanceValues } = await import("@/lib/forms/instances");
const { sendForHrApproval, decideHrApproval, commentOnHrApproval } = await import("@/lib/forms/hr-approval");
const pdfRoute = await import("./instances/[id]/pdf/route");

const manager = { id: CREATOR, role: "salon_director", verified: true, scope: WORNALL, visibility: WORNALL, hrApprover: false } as FormsActor;
const hr = { id: HR, role: "district_manager", verified: true, scope: GLOBAL, visibility: GLOBAL, hrApprover: true } as FormsActor;

/** One distinctive word per note, so a single one surviving into the PDF is caught. */
const NOTES = {
  sent: "Zephyrine please review the second late opening",
  sentBack: "Quillon add the date of the first late opening",
  reply: "Brackwater the first one was on the twelfth",
  approved: "Tamberlyn approved thank you",
};

beforeEach(async () => {
  process.env.FORMS_HR_APPROVAL_ENABLED = "true";
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  for (const key of Object.keys(store)) (store as unknown as Record<string, unknown[]>)[key] = [];
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

let minute = 0;
function tick() {
  minute += 1;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.UTC(2026, 10, 23, 15, minute)));
}

describe("the approved form's PDF never carries the approval notes (Pau)", () => {
  it("approved from sent back, with a note on every step: the PDF has the form, and none of the thread", async () => {
    const instance = await createInstance({
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
    await saveInstanceValues(instance.id, { values: {}, checked: {} }, CREATOR);
    tick();
    await sendForHrApproval(instance.id, manager, null, { acknowledgeUnverifiedPolicy: true });
    tick();
    await commentOnHrApproval(instance.id, manager, NOTES.sent);
    tick();
    await decideHrApproval(instance.id, hr, "send_back", NOTES.sentBack);
    tick();
    await commentOnHrApproval(instance.id, manager, NOTES.reply);
    tick();
    const approved = await decideHrApproval(instance.id, hr, "approve", NOTES.approved);
    expect(approved.status).toBe("finalized");
    vi.useRealTimers();

    const response = await pdfRoute.GET(new Request(`http://localhost/api/forms/instances/${instance.id}/pdf`), {
      params: Promise.resolve({ id: instance.id }),
    });
    expect(response.status).toBe(200);
    const pdf = await getDocumentProxy(new Uint8Array(await response.arrayBuffer()));
    const { text } = await extractText(pdf, { mergePages: true });
    const printed = String(text);

    expect(printed, "the PDF does not carry the form (the test proves nothing)").toContain("Juniper Ashdown");
    for (const [step, note] of Object.entries(NOTES)) {
      expect(printed, `HR approval note (${step}) printed in the PDF`).not.toContain(note.split(" ")[0]!);
    }
    expect(printed).not.toMatch(/HR approv|sent it back|Sent back by HR|added a note/i);
  });
});
