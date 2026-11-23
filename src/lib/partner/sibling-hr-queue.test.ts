import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";

import {
  SIBLING_HR_HEADERS,
  SIBLING_HR_SHARED_VECTOR,
  signSiblingHrRequest,
  verifySiblingHrRequest,
} from "./sibling-hr-signature";

/**
 * HR'S QUEUE ACROSS THE TWO APPS. Owner, 23 Nov 2026: "can we pls add both views sunny/bubbles for colene so she doesnt
 * have to go back and forth just make a 1 tab for sunny 1 tab for bubbles". Each app answers the sibling's signed
 * request with the forms waiting for that approver, and asks the sibling for the same. Invented accounts and people.
 */

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
const { createInstance } = await import("@/lib/forms/instances");
const { hrQueueForPartner, fetchSiblingHrQueue, parseSiblingHrAnswer } = await import("./sibling-hr-queue");
const { SIBLING_HR_APP } = await import("@/lib/config/app-switcher");

const HR = "hr-wren-oakfield";
const MANAGER = "lm-thistle";
const SECRET = "sibling-secret-0123456789abcdef0123456789";
const ORIGINAL = { ...process.env };

beforeEach(async () => {
  process.env.FORMS_HR_APPROVAL_ENABLED = "true";
  for (const key of Object.keys(store)) (store as unknown as Record<string, unknown[]>)[key] = [];
  extra.form_hr_approvers = [{ app_user_id: HR, revoked_at: null }];
  extra.form_hr_approval_events = [];
  extra.app_users = [
    { id: HR, email: "Hr.Wren@Example.com", display_name: "Wren", status: "active" },
    { id: MANAGER, email: "thistle@example.com", display_name: "Thistle", status: "active" },
  ];
  await ensureTemplateLibrary("system");
});
afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.unstubAllGlobals();
});

async function waitingForm(): Promise<string> {
  const instance = await createInstance({
    templateKey: "policy-review",
    variantKey: null,
    employeeName: "Juniper Calloway",
    employeeRole: "Team Member Part Time",
    locationId: "loc-a",
    locationName: "Invented Place",
    createdBy: MANAGER,
    source: "manual",
    formDate: "2026-11-23",
  });
  const row = store.form_instances.find((candidate) => (candidate as { id: string }).id === instance.id) as Record<string, unknown>;
  row.hr_approval_state = "pending";
  row.hr_approval_requested_at = "2026-11-23T14:00:00Z";
  return instance.id;
}

describe("the signature both apps share", () => {
  it("is the same fixed value in both repositories", () => {
    const v = SIBLING_HR_SHARED_VECTOR;
    expect(signSiblingHrRequest(v.secret, v.caller, v.timestamp, v.body)).toBe("58965059f2b46699a27b0929e3f9e4c1a94d8b2e071ac7da8a99398789152bd9");
  });

  it("is refused for another caller, an old request, a short secret or a changed body", () => {
    const v = SIBLING_HR_SHARED_VECTOR;
    const signature = signSiblingHrRequest(v.secret, v.caller, v.timestamp, v.body);
    const base = { secret: v.secret, expectedCaller: v.caller, caller: v.caller, timestamp: v.timestamp, signature, body: v.body, now: Number(v.timestamp) };
    expect(verifySiblingHrRequest(base)).toBe(true);
    expect(verifySiblingHrRequest({ ...base, expectedCaller: "someone-else" })).toBe(false);
    expect(verifySiblingHrRequest({ ...base, now: Number(v.timestamp) + 6 * 60_000 })).toBe(false);
    expect(verifySiblingHrRequest({ ...base, secret: "short" })).toBe(false);
    expect(verifySiblingHrRequest({ ...base, body: v.body.replace("hr@", "other@") })).toBe(false);
  });
});

describe("what this app answers the sibling", () => {
  it("the approver (by email, any case) gets the waiting form: the line, who sent it, the state and the review path, nothing else", async () => {
    const id = await waitingForm();
    const answer = await hrQueueForPartner("hr.wren@example.com", new Date("2026-11-23T15:00:00Z"));
    expect(answer.approver).toBe(true);
    expect(answer.forms).toHaveLength(1);
    expect(answer.forms[0]).toEqual({
      line: expect.stringMatching(/for Juniper Calloway at Invented Place$/),
      from: "Thistle",
      state: "pending",
      requestedAt: "2026-11-23T14:00:00Z",
      waiting: "Sent today",
      overdue: false,
      managerReplied: false,
      path: `/forms/hr-approval/${id}`,
    });
    // No account id, no value of the form.
    expect(JSON.stringify(answer)).not.toContain(MANAGER);
  });

  it("anybody else, an unknown email, a revoked approver, or HR approval off: an empty answer", async () => {
    await waitingForm();
    expect((await hrQueueForPartner("thistle@example.com")).forms).toEqual([]);
    expect((await hrQueueForPartner("nobody@example.com")).approver).toBe(false);
    expect((await hrQueueForPartner(42)).approver).toBe(false);
    extra.form_hr_approvers = [{ app_user_id: HR, revoked_at: "2026-11-23T00:00:00Z" }];
    expect((await hrQueueForPartner("hr.wren@example.com")).approver).toBe(false);
    extra.form_hr_approvers = [{ app_user_id: HR, revoked_at: null }];
    delete process.env.FORMS_HR_APPROVAL_ENABLED;
    expect((await hrQueueForPartner("hr.wren@example.com")).approver).toBe(false);
  });

  it("an email with LIKE wildcards matches nobody else", async () => {
    await waitingForm();
    expect((await hrQueueForPartner("%@example.com")).approver).toBe(false);
    expect((await hrQueueForPartner("hr_wren@example.com")).approver).toBe(false);
  });
});

describe("a form the manager replied to after HR sent it back, in the sibling's answer", () => {
  it("is read as sent, so this app's tab counts it; an older sibling's answer reads as not replied", () => {
    const path = "/forms/hr-approval/0b6f1c1e-2a8d-4c55-9a10-5f3b6c7d8e9f";
    const parsed = parseSiblingHrAnswer(
      { app: "Sibling App", approver: true, forms: [{ line: "replied", state: "changes_requested", managerReplied: true, path }, { line: "older sibling", state: "changes_requested", path }] },
      "https://sibling.test",
    );
    expect(parsed.status === "ok" && parsed.forms.map((form) => form.managerReplied)).toEqual([true, false]);
  });
});

describe("what this app asks the sibling", () => {
  it("without SIBLING_HR_SECRET: off, and nothing is sent", async () => {
    const fetchImpl = vi.fn();
    expect(await fetchSiblingHrQueue("hr.wren@example.com", { fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ status: "off" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("signs the request as this app, sends only the email, and links each form to the sibling's own review page", async () => {
    process.env.SIBLING_HR_SECRET = SECRET;
    const fetchImpl = vi.fn(async () =>
      Response.json({
        app: "Sibling App",
        approver: true,
        forms: [
          { line: "Exit Form for Marlowe Fenwick", from: "Ines", state: "pending", requestedAt: null, waiting: "Sent today", overdue: false, path: "/forms/hr-approval/0b6f1c1e-2a8d-4c55-9a10-5f3b6c7d8e9f" },
        ],
      }),
    );
    const result = await fetchSiblingHrQueue("Hr.Wren@Example.com", { fetchImpl: fetchImpl as unknown as typeof fetch, now: 1_795_600_000_000 });
    expect(result.status).toBe("ok");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/partner\/hr-queue$/);
    const headers = init.headers as Record<string, string>;
    const body = String(init.body);
    expect(JSON.parse(body)).toMatchObject({ approverEmail: "hr.wren@example.com" });
    expect(Object.keys(JSON.parse(body)).sort()).toEqual(["approverEmail", "nonce"]);
    expect(
      verifySiblingHrRequest({
        secret: SECRET,
        expectedCaller: SIBLING_HR_APP.thisAppId,
        caller: headers[SIBLING_HR_HEADERS.caller]!,
        timestamp: headers[SIBLING_HR_HEADERS.timestamp]!,
        signature: headers[SIBLING_HR_HEADERS.signature]!,
        body,
        now: 1_795_600_000_000,
      }),
    ).toBe(true);
    if (result.status === "ok") {
      expect(result.app).toBe("Sibling App");
      expect(result.forms[0]!.href).toMatch(/^https:\/\/[^/]+\/forms\/hr-approval\/0b6f1c1e-2a8d-4c55-9a10-5f3b6c7d8e9f$/);
    }
  });

  it("a failed or malformed answer is an error, never shown as a list", async () => {
    process.env.SIBLING_HR_SECRET = SECRET;
    const down = vi.fn(async () => new Response("nope", { status: 503 }));
    expect(await fetchSiblingHrQueue("hr@example.com", { fetchImpl: down as unknown as typeof fetch })).toEqual({ status: "error" });
    const throws = vi.fn(async () => {
      throw new Error("timeout");
    });
    expect(await fetchSiblingHrQueue("hr@example.com", { fetchImpl: throws as unknown as typeof fetch })).toEqual({ status: "error" });
    expect(parseSiblingHrAnswer({ forms: [] }, "https://sibling.test")).toEqual({ status: "error" });
  });

  it("drops any row that does not point at a review page in the sibling: an outside link is never rendered", () => {
    const parsed = parseSiblingHrAnswer(
      {
        app: "Sibling App",
        approver: true,
        forms: [
          { line: "ok", state: "pending", path: "/forms/hr-approval/0b6f1c1e-2a8d-4c55-9a10-5f3b6c7d8e9f" },
          { line: "outside", state: "pending", path: "https://evil.test/forms/hr-approval/0b6f1c1e-2a8d-4c55-9a10-5f3b6c7d8e9f" },
          { line: "other page", state: "pending", path: "/admin/users" },
          { line: "bad id", state: "pending", path: "/forms/hr-approval/../../admin" },
          { line: "bad state", state: "deleted", path: "/forms/hr-approval/0b6f1c1e-2a8d-4c55-9a10-5f3b6c7d8e9f" },
        ],
      },
      "https://sibling.test",
    );
    expect(parsed.status).toBe("ok");
    if (parsed.status === "ok") expect(parsed.forms.map((form) => form.line)).toEqual(["ok"]);
  });
});
