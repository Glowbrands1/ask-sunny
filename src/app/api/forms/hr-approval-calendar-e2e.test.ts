import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import PRODUCTION_FLAGS from "@/config/production-flags.json";
import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope } from "@/types";

/**
 * ============================================================================
 * HR APPROVAL, END TO END: FILED → HR'S QUEUE AND BELL → THE CALENDAR → THE FORM → DECIDED
 * ============================================================================
 *
 * Task (H), 27 Nov 2026: prove that a form a manager files reaches HR, sits on the Calendar on its due date for HR,
 * opens to the form, and leaves the calendar and the queue once HR approves it; and what a sent-back or rejected form
 * does. Production's flags (`src/config/production-flags.json`), the real routes
 * (POST /api/forms/instances, PATCH and POST /api/forms/instances/[id], GET /api/forms/instances/[id]), the real HR
 * approver list (`form_hr_approvers` read by `resolveHrApprover`), the real bell table (`app_notifications`), the real
 * calendar loader the /calendar page and the AI's read_calendar use (`loadCalendarFor`) and the real
 * /forms/hr-approval/[id] page the entry links to. Only the identity provider and the database are stand-ins (the
 * in-memory Supabase fake the forms suite uses). Invented people, salon ids and employee only.
 */

const store: FakeStore = {
  form_instances: [],
  form_instance_values: [],
  form_instance_events: [],
  form_template_versions: [],
  form_templates: [],
  form_template_current: [],
  form_template_assets: [],
};
const extra = store as unknown as Record<string, Record<string, unknown>[]>;

const SALON: AccessScope = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: [] };
const GLOBAL: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

/** Every account in this test, invented. HR is a District Manager on the approver list. */
const PEOPLE = {
  manager: { subject: "sd-corvin-ashmere", email: "corvin.ashmere@example.test", displayName: "Corvin Ashmere", role: "salon_director", scope: SALON },
  hr: { subject: "hr-thessaly-brundage", email: "thessaly.brundage@example.test", displayName: "Thessaly Brundage", role: "district_manager", scope: GLOBAL },
  admin: { subject: "admin-pell-ostergaard", email: "pell.ostergaard@example.test", displayName: "Pell Ostergaard", role: "admin", scope: GLOBAL },
  dm: { subject: "dm-ingram-vale", email: "ingram.vale@example.test", displayName: "Ingram Vale", role: "district_manager", scope: GLOBAL },
} as const;
type Who = keyof typeof PEOPLE;

const state = vi.hoisted(() => ({ who: "manager" as string }));

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));

vi.mock("@/lib/api/respond", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/respond")>();
  return { ...actual, assertLiveMode: () => {}, assertNoConfigurationProblems: () => {}, assertWithinRateLimit: () => {} };
});

function identityOf(who: string) {
  const person = PEOPLE[who as Who];
  return { subject: person.subject, email: person.email, displayName: person.displayName, role: person.role, scope: person.scope, verified: true };
}

vi.mock("@/lib/auth/server", async () => {
  const { AuthError } = await import("@/lib/auth/types");
  const { DEFAULT_PERMISSION_MATRIX, hasPermission } = await import("@/lib/permissions");
  return {
    authorizeRequest: async (_request: Request, permission: string) => {
      const identity = identityOf(state.who);
      if (!hasPermission(DEFAULT_PERMISSION_MATRIX, identity.role as never, permission as never)) {
        throw new AuthError("forbidden", "Your role does not have permission to do that.");
      }
      return { identity, permission, provider: "supabase" };
    },
  };
});

// The page guard: the same permission check, as the signed-in person.
vi.mock("@/lib/auth/page", async () => {
  const { DEFAULT_PERMISSION_MATRIX, hasPermission } = await import("@/lib/permissions");
  return {
    requirePagePermission: async (permission: string) => {
      const identity = identityOf(state.who);
      if (!hasPermission(DEFAULT_PERMISSION_MATRIX, identity.role as never, permission as never)) throw new Error("NEXT_REDIRECT");
      return identity;
    },
  };
});

/* Production's flags. */
const PRODUCTION = [...PRODUCTION_FLAGS.on, ...PRODUCTION_FLAGS.assumedOn];
const SAVED = new Map(PRODUCTION.map((name) => [name, process.env[name]] as const));
for (const name of PRODUCTION) process.env[name] = "true";
for (const name of PRODUCTION_FLAGS.off) delete process.env[name];
process.env.NEXT_PUBLIC_DEMO_MODE = "false";
afterAll(() => {
  for (const [name, value] of SAVED) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const { ensureTemplateLibrary } = await import("@/lib/forms/repository");
const { loadInstance } = await import("@/lib/forms/instances");
const { blocksForVariant, parseFormDocument } = await import("@/lib/forms/document");
const instancesRoute = await import("./instances/route");
const instanceRoute = await import("./instances/[id]/route");
const { loadCalendarFor } = await import("@/lib/calendar/load.server");
const { listHrQueue, hrQueueSummary } = await import("@/lib/forms/hr-approval");
const { resolveHrApprover } = await import("@/lib/forms/hr-approval-approvers");
const { listNotifications } = await import("@/lib/notifications/repository");
const { HR_REQUEST_KIND, HR_DECISION_KIND } = await import("@/lib/forms/hr-approval-bells");
const hrPage = (await import("@/app/(app)/forms/hr-approval/[id]/page")).default;

/** The view's join the fake does not model (as in exit-form-e2e.test.ts). */
function joinOverview() {
  for (const row of store.form_instances ?? []) {
    const template = store.form_templates!.find((entry) => entry.id === row.template_id);
    const version = store.form_template_versions.find((entry) => entry.id === row.template_version_id);
    Object.assign(row, { template_key: template?.key, template_name: template?.name, layout_family: template?.layout_family, template_version: version?.version });
  }
}

async function as<T>(who: Who, run: () => Promise<T>): Promise<T> {
  const before = state.who;
  state.who = who;
  try {
    return await run();
  } finally {
    state.who = before;
  }
}

async function send(who: Who, id: string, method: "POST" | "PATCH" | "GET", body?: unknown) {
  return as(who, async () => {
    const request = new Request(`https://app.test/api/forms/instances/${id}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    });
    const handler = method === "POST" ? instanceRoute.POST : method === "PATCH" ? instanceRoute.PATCH : instanceRoute.GET;
    const response = await handler(request, { params: Promise.resolve({ id }) });
    joinOverview();
    return { status: response.status, body: (await response.json()) as Record<string, unknown> & { error?: string } };
  });
}

/** Every line of the Resignation/Exit Form a manager fills before Finalize (production requires every field). */
const EXIT_VALUES: Record<string, string> = {
  last_day_worked: "2026-11-20",
  notice_given_date: "2026-11-06",
  notice_fulfilled_date: "2026-11-20",
  permanent_address: "12 Invented Lane, Lincoln, NE 68508",
  details: "Marisol Quenby gave two weeks notice on 11/6 and worked out the notice.",
};

/** The manager files a Resignation/Exit Form through the routes, the way the forms page does. */
async function fileExitForm(): Promise<string> {
  const created = await as("manager", async () => {
    const response = await instancesRoute.POST(
      new Request("https://app.test/api/forms/instances", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          templateKey: "stc-exit",
          employeeName: "Marisol Quenby",
          employeeRole: "Tanning Consultant",
          locationId: "loc-0310",
          locationName: "Example Salon North",
          source: "manual",
          formDate: "2026-11-25",
        }),
      }),
    );
    joinOverview();
    return { status: response.status, body: (await response.json()) as { instance?: { id: string }; error?: string } };
  });
  expect(created.status, created.body.error).toBeLessThan(300);
  // The fake numbers its rows "fake-N"; the /forms/hr-approval/[id] page only opens a UUID, as the database issues.
  const fakeId = created.body.instance!.id;
  const id = randomUUID();
  for (const table of Object.values(extra)) {
    for (const row of table) {
      if (row.id === fakeId) row.id = id;
      if (row.instance_id === fakeId) row.instance_id = id;
    }
  }
  return id;
}

async function fillEveryRequiredLine(id: string) {
  const loaded = await loadInstance(id);
  const values: Record<string, string> = {};
  const checked: Record<string, string[]> = {};
  const fill = (field: { key: string; input: string; responsibility: string }) => {
    if (["manual", "employee", "signature"].includes(field.responsibility)) return;
    values[field.key] = EXIT_VALUES[field.key] ?? (field.input === "date" ? "2026-11-20" : "Not applicable");
  };
  for (const block of blocksForVariant(parseFormDocument(loaded!.version.document), loaded!.instance.variantKey)) {
    if (block.kind === "field") fill(block.field);
    else if (block.kind === "field_row") block.fields.forEach(fill);
    else if (block.kind === "checkbox_group" && !["manual", "employee", "signature"].includes(block.responsibility)) checked[block.key] = [block.options[0]!.key];
  }
  const saved = await send("manager", id, "PATCH", { values, checked });
  expect(saved.status, saved.body.error).toBe(200);
}

const NOW = new Date("2026-11-25T15:00:00Z"); // Wednesday, 9 AM Central
const DUE = "2026-11-26"; // one business day after it was sent (`overdueFrom`)
const RANGE = { from: "2026-11-01", to: "2026-12-12" };

async function calendarOf(who: Who) {
  const result = await loadCalendarFor(identityOf(who) as never, RANGE, { origin: "", includeHub: false, now: NOW });
  expect(result.ok).toBe(true);
  return result.ok ? result.view.events.filter((event) => event.kind === "hr-approval") : [];
}

/*
 * KNOWN GAP, REPORTED, NOT FIXED HERE (27 Nov 2026). Once HR sends a form back or rejects it, it waits on the manager,
 * not on HR: it leaves HR's pending count and HR's bell item is cleared. HR's CALENDAR still shows it, as
 * "Approve: …" on the day it was first due, because the calendar loader (src/lib/calendar/load.server.ts) takes every
 * row of HR's tab (`listHrQueue`: pending, sent back, rejected) rather than the rows that need HR's decision
 * (`needsHrDecision`). The calendar code belongs to the Shared Calendar work in flight, so this test pins what it does
 * today; when the loader keeps only `needsHrDecision` rows, change this to expect false.
 */
async function stillOnHrCalendar(id: string): Promise<boolean> {
  const entries = await calendarOf("hr");
  const entry = entries.find((e) => e.href === `/forms/hr-approval/${encodeURIComponent(id)}`);
  if (entry) expect(entry.title).toMatch(/^Approve: /);
  return entry !== undefined;
}

const actorOf = (who: Who, hrApprover: boolean) => ({ id: PEOPLE[who].subject, role: PEOPLE[who].role, verified: true, scope: null, visibility: null, hrApprover }) as never;

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  extra.form_hr_approvers = [{ app_user_id: PEOPLE.hr.subject, revoked_at: null }];
  extra.form_hr_approval_events = [];
  extra.app_notifications = [];
  extra.app_users = Object.values(PEOPLE).map((p) => ({ id: p.subject, email: p.email, display_name: p.displayName, status: "active" }));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  await ensureTemplateLibrary("system");
});

describe("HR approval, filed to decided, with production's flags", () => {
  it("production has the HR approval step on", () => {
    expect(PRODUCTION).toContain("FORMS_HR_APPROVAL_ENABLED");
  });

  it("a Resignation/Exit Form reaches HR's queue and bell, sits on HR's calendar on its due day, opens to the form for HR and admins only, and leaves both once approved", async () => {
    const id = await fileExitForm();
    await fillEveryRequiredLine(id);

    // The manager presses "Finalize and send for approval".
    const sent = await send("manager", id, "POST", { action: "finalize", acknowledgeUnverifiedPolicy: true });
    expect(sent.status, sent.body.error).toBe(200);
    expect(sent.body.sentToHr).toBe(true);
    expect(sent.body.instance).toMatchObject({ status: "draft" });

    // 1. IT REACHES HR: the approver list, the queue, the count, the bell.
    expect(await resolveHrApprover(PEOPLE.hr.subject)).toBe(true);
    expect(await resolveHrApprover(PEOPLE.admin.subject)).toBe(false);
    const queue = await listHrQueue(actorOf("hr", true), NOW);
    expect(queue.map((row) => [row.id, row.state, row.createdByName])).toEqual([[id, "pending", "Corvin Ashmere"]]);
    expect(queue[0]!.line).toContain("Marisol Quenby");
    expect(await hrQueueSummary(actorOf("hr", true), NOW)).toEqual({ pending: 1, overdue: 0 });
    const bell = await listNotifications(PEOPLE.hr.email);
    const request = bell.items.find((item) => item.kind === HR_REQUEST_KIND);
    expect(request, JSON.stringify(bell.items)).toBeDefined();
    expect(request!.href).toBe(`/forms/hr-approval/${id}`);
    expect(request!.readAt ?? null).toBeNull();

    // 2. ON THE CALENDAR on its due day: HR's "Approve", the manager's own "With HR".
    const hrCalendar = await calendarOf("hr");
    expect(hrCalendar).toHaveLength(1);
    expect(hrCalendar[0]).toMatchObject({ kind: "hr-approval", date: DUE, status: "upcoming", href: `/forms/hr-approval/${encodeURIComponent(id)}` });
    expect(hrCalendar[0]!.title).toMatch(/^Approve: .*Marisol Quenby/);
    const managerCalendar = await calendarOf("manager");
    expect(managerCalendar.map((e) => [e.date, e.title.split(":")[0]])).toEqual([[DUE, "With HR"]]);
    // Administrators and the manager's District Manager do not see a form waiting for HR (owner, 23 Nov 2026:
    // "only me and HR can see its waiting"; hr-approval-rules.ts: "not their District or Regional Manager, not an administrator").
    expect(await calendarOf("admin")).toEqual([]);
    expect(await calendarOf("dm")).toEqual([]);

    // 3. OPENING THE ENTRY LEADS TO THE FORM: the page the href names renders the HR screen for this form, and the
    // form itself reads for HR.
    const page = await as("hr", () => hrPage({ params: Promise.resolve({ id }) }));
    expect((page as { props: { instanceId: string; templateName: string } }).props).toMatchObject({ instanceId: id, templateName: "Resignation/Exit Form" });
    const hrRead = await send("hr", id, "GET");
    expect(hrRead.status).toBe(200);
    expect(hrRead.body.instance).toMatchObject({ id, employeeName: "Marisol Quenby", hrApprovalState: "pending" });
    // An administrator opens it too (owner, 27 Nov 2026: "yes admin"), without HR's notes or decision.
    const adminPage = await as("admin", () => hrPage({ params: Promise.resolve({ id }) }));
    expect((adminPage as { props: { instanceId: string } }).props.instanceId).toBe(id);
    const adminRead = await send("admin", id, "GET");
    expect(adminRead.status).toBe(200);
    expect(adminRead.body.instance).toMatchObject({ id, employeeName: "Marisol Quenby" });
    expect(adminRead.body.hrApproval).toBeUndefined();
    // A manager who is not its creator, sender, HR or an administrator is led nowhere: the same 404 as a missing form.
    await expect(as("dm", () => hrPage({ params: Promise.resolve({ id }) }))).rejects.toThrow(/404/);
    expect((await send("dm", id, "GET")).status).toBe(404);

    // 4. HR APPROVES: finalized, gone from the queue, the count, the calendar; HR's bell item cleared; the manager told.
    const approved = await send("hr", id, "POST", { action: "hr_approve" });
    expect(approved.status, approved.body.error).toBe(200);
    expect(approved.body.instance).toMatchObject({ status: "finalized", hrApprovalState: "approved" });
    expect(await listHrQueue(actorOf("hr", true), NOW)).toEqual([]);
    expect(await hrQueueSummary(actorOf("hr", true), NOW)).toEqual({ pending: 0, overdue: 0 });
    expect(await calendarOf("hr")).toEqual([]);
    expect(await calendarOf("manager")).toEqual([]);
    const after = await listNotifications(PEOPLE.hr.email);
    expect(after.items.filter((item) => item.kind === HR_REQUEST_KIND && !item.readAt)).toEqual([]);
    const told = await listNotifications(PEOPLE.manager.email);
    expect(told.items.some((item) => item.kind === HR_DECISION_KIND && item.href === `/forms/hr-approval/${id}`)).toBe(true);
  });

  it("an administrator on the HR approver list sees the entry as HR does", async () => {
    extra.form_hr_approvers!.push({ app_user_id: PEOPLE.admin.subject, revoked_at: null });
    const id = await fileExitForm();
    await fillEveryRequiredLine(id);
    expect((await send("manager", id, "POST", { action: "finalize", acknowledgeUnverifiedPolicy: true })).status).toBe(200);
    const entries = await calendarOf("admin");
    expect(entries.map((e) => [e.date, e.href])).toEqual([[DUE, `/forms/hr-approval/${encodeURIComponent(id)}`]]);
    expect(entries[0]!.title).toMatch(/^Approve: /);
  });

  it("sent back: a note is required; leaves HR's pending count and bell, shows as 'Changes requested' for the manager, and returns to HR when sent again", async () => {
    const id = await fileExitForm();
    await fillEveryRequiredLine(id);
    expect((await send("manager", id, "POST", { action: "finalize", acknowledgeUnverifiedPolicy: true })).status).toBe(200);

    expect((await send("hr", id, "POST", { action: "hr_send_back" })).status, "a note is required").toBe(400);
    const back = await send("hr", id, "POST", { action: "hr_send_back", note: "Please add the date the notice was fulfilled." });
    expect(back.status, back.body.error).toBe(200);
    expect(back.body.instance).toMatchObject({ status: "draft", hrApprovalState: "changes_requested" });

    expect(await hrQueueSummary(actorOf("hr", true), NOW)).toEqual({ pending: 0, overdue: 0 });
    expect((await listNotifications(PEOPLE.hr.email)).items.filter((item) => item.kind === HR_REQUEST_KIND && !item.readAt)).toEqual([]);
    expect((await listNotifications(PEOPLE.manager.email)).items.some((item) => item.kind === HR_DECISION_KIND)).toBe(true);
    expect((await calendarOf("manager")).map((e) => e.title.split(":")[0])).toEqual(["Changes requested"]);
    expect(await stillOnHrCalendar(id)).toBe(true);

    // The manager sends it again: back in HR's queue and on HR's calendar.
    const again = await send("manager", id, "POST", { action: "finalize", acknowledgeUnverifiedPolicy: true });
    expect(again.status, again.body.error).toBe(200);
    expect(await hrQueueSummary(actorOf("hr", true), NOW)).toEqual({ pending: 1, overdue: 0 });
    expect((await calendarOf("hr")).map((e) => e.date)).toEqual([DUE]);
  });

  it("rejected: off HR's pending count and bell and off the manager's calendar; the manager is told", async () => {
    const id = await fileExitForm();
    await fillEveryRequiredLine(id);
    expect((await send("manager", id, "POST", { action: "finalize", acknowledgeUnverifiedPolicy: true })).status).toBe(200);

    const rejected = await send("hr", id, "POST", { action: "hr_reject", note: "This employee was transferred, not separated." });
    expect(rejected.status, rejected.body.error).toBe(200);
    expect(rejected.body.instance).toMatchObject({ status: "draft", hrApprovalState: "rejected" });

    expect(await hrQueueSummary(actorOf("hr", true), NOW)).toEqual({ pending: 0, overdue: 0 });
    expect((await listNotifications(PEOPLE.hr.email)).items.filter((item) => item.kind === HR_REQUEST_KIND && !item.readAt)).toEqual([]);
    expect((await listNotifications(PEOPLE.manager.email)).items.some((item) => item.kind === HR_DECISION_KIND)).toBe(true);
    expect(await calendarOf("manager")).toEqual([]);
    expect(await stillOnHrCalendar(id)).toBe(true);
  });
});
