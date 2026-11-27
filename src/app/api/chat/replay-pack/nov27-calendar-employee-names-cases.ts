import { expect, vi } from "vitest";

import { hrApprovalEnabled } from "@/lib/forms/hr-approval-rules";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * WHO SEES THE EMPLOYEE'S NAME ON A FORM'S CALENDAR ENTRY (the owner, 27 Nov 2026)
 * ============================================================================
 *
 * The owner, on a day panel showing "Approve: Resignation/Exit Form for <employee> at NE Grand Island": "all admins and
 * wren can see this and the creator but for others they wont see the name". Wren (invented here) is HR: the rule is admins, HR
 * approvers (form_hr_approvers) and the form's creator. Through the real chat route: a Salon Director files a coaching
 * form with a follow-up date; then read_calendar, for the week of the follow-up, gives
 *   - another manager of the same salon: the entry without the employee's name, marked employee_name_hidden;
 *   - the manager who created it, an admin, and HR: the name.
 * Invented people only.
 */
const REPORT = 'The owner, 27 Nov 2026: "all admins and wren can see this and the creator but for others they wont see the name"';
const FLAG = "AGENT_LOOP_ENABLED";
const CREATOR = "qa-manager";
const OTHER = "qa-other-manager";
const HR = "qa-hr-approver";

type CalendarOutput = { events?: { date: string; what: string; title: string; employee_name_hidden?: boolean }[]; error?: string };

async function fileCoachingForm(t: ReplayContext): Promise<string> {
  t.as("salon_director", KEARNEY, CREATOR);
  t.loopModel!(loopStandIn((view: LoopView) => (lastResult(view, "propose_form")
    ? { text: "Here's the card." }
    : { tool: "propose_form", input: { template_key: "coaching", employee_id: STAFF[0]!.id, what_happened: "Arrived late to open.", incident_date: "2026-11-27" } })));
  const setup = t.thread();
  await setup.say(`coaching form for ${STAFF[0]!.firstName} ${STAFF[0]!.lastName}, late to open`);
  const id = await setup.create();
  const route = await import("@/app/api/forms/instances/[id]/route");
  const params = { params: Promise.resolve({ id }) };
  const json = { "content-type": "application/json" };
  const saved = await route.PATCH(new Request(`https://app.test/api/forms/instances/${id}`, { method: "PATCH", headers: json, body: JSON.stringify({ values: {}, checked: { coaching_type: ["underperformance"], coaching_topics: ["store_tours"] } }) }), params);
  expect(saved.status, await saved.clone().text()).toBe(200);
  const filed = await route.POST(new Request(`https://app.test/api/forms/instances/${id}`, { method: "POST", headers: json, body: JSON.stringify({ action: "finalize", followUpDate: "2026-12-03", acknowledgeUnverifiedPolicy: true }) }), params);
  expect(filed.status, await filed.clone().text()).toBe(200);
  return id;
}

async function followUpAs(t: ReplayContext, role: string, subject: string) {
  t.as(role, KEARNEY, subject);
  const secret = process.env.HUB_PARTNER_SECRET;
  delete process.env.HUB_PARTNER_SECRET;
  try {
    const model = loopStandIn((view: LoopView) => (lastResult(view, "read_calendar") ? { text: "Dec 3." } : { tool: "read_calendar", input: { from: "2026-11-30", to: "2026-12-06" } }));
    t.loopModel!(model);
    await t.thread().say("what's on my calendar next week");
    const output = model.views.flatMap((view) => view.results.filter((result) => result.tool === "read_calendar")).at(-1)?.output as CalendarOutput | undefined;
    expect(output?.error, JSON.stringify(output)).toBeUndefined();
    const entry = (output?.events ?? []).find((e) => e.what === "form-follow-up" && e.date === "2026-12-03");
    expect(entry, JSON.stringify(output)).toBeDefined();
    return entry!;
  } finally {
    if (secret !== undefined) process.env.HUB_PARTNER_SECRET = secret;
  }
}

export const NOV27_CALENDAR_EMPLOYEE_NAMES_CASES: ReplayCase[] = [
  {
    id: "nov27-calendar-employee-name-only-admins-hr-creator",
    title: `"all admins and wren can see this and the creator but for others they wont see the name" — another manager's calendar gives the follow-up without the employee's name; the creator, an admin and HR get it`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      t.directory(STAFF);
      vi.setSystemTime(new Date("2026-11-27T15:00:00Z"));
      await fileCoachingForm(t);
      const last = STAFF[0]!.lastName;

      const other = await followUpAs(t, "salon_director", OTHER);
      expect(other.title).not.toContain(last);
      expect(other.title).not.toContain(STAFF[0]!.firstName);
      expect(other.employee_name_hidden).toBe(true);

      const creator = await followUpAs(t, "salon_director", CREATOR);
      expect(creator.title).toContain(last);
      expect(creator.employee_name_hidden).toBeUndefined();

      const admin = await followUpAs(t, "admin", "qa-admin");
      expect(admin.title).toContain(last);

      if (hrApprovalEnabled()) {
        t.addRows!("form_hr_approvers", [{ app_user_id: HR, revoked_at: null }]);
        const hr = await followUpAs(t, "salon_director", HR);
        expect(hr.title).toContain(last);
      }
    },
  },
];
