import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * HAND A FORM'S FOLLOW-UP TO SOMEONE ELSE (the owner, 27 Nov 2026, approved "ok to all")
 * ============================================================================
 *
 * The owner's words: "assign Addy's follow-up to <DM>". Through the real chat route with production's flags and the
 * loop on: a Salon Director files a coaching form for Addy with a follow-up date, then says
 * "assign Addy's follow-up to Tobin". set_follow_up_owner must
 *   - set the owner to the DM who covers the salon (form_instances.follow_up_owner), through the page's own checks;
 *   - and then the DM's read_calendar has the follow-up on its date WITH the employee's name, marked assigned to them;
 *   - while a DM of another salon is refused as owner, and nothing is written.
 * Invented people only (Addy Quillfeather, Tobin Marsh, Tobias Wren are on no directory).
 */
const REPORT = "The owner, 27 Nov 2026: \"assign Addy's follow-up to <DM>\" (assign a form's follow-up to someone else; approved \"ok to all\")";
const FLAG = "AGENT_LOOP_ENABLED";
const CREATOR = "qa-manager";
const DM = "qa-dm-tobin";
const DM_AWAY = "qa-dm-tobias";
const DM_SCOPE = { level: "salon", primaryAreaId: "loc-0307", alsoCoversAreaIds: ["loc-0309"] };
const ADDY: DirectoryRow = { id: "e-addy", firstName: "Addy", lastName: "Quillfeather", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

const account = (id: string, name: string, scope: { level: string; primaryAreaId: string; alsoCoversAreaIds: string[] }) => ({
  id,
  email: `${id}@example.test`,
  display_name: name,
  role: "district_manager",
  status: "active",
  scope_level: scope.level,
  scope_primary_area_id: scope.primaryAreaId,
  scope_also_covers_area_ids: scope.alsoCoversAreaIds,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
});

async function fileCoachingForAddy(t: ReplayContext): Promise<string> {
  t.as("salon_director", KEARNEY, CREATOR);
  t.loopModel!(loopStandIn((view: LoopView) => (lastResult(view, "propose_form")
    ? { text: "Here's the card." }
    : { tool: "propose_form", input: { template_key: "coaching", employee_id: ADDY.id, what_happened: "Arrived late to open.", incident_date: "2026-11-27" } })));
  const setup = t.thread();
  await setup.say("coaching form for Addy Quillfeather, late to open");
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

/** The creator says it in chat; the loop calls set_follow_up_owner with the manager's words. */
async function assignInChat(t: ReplayContext, said: string, ownerName: string) {
  t.as("salon_director", KEARNEY, CREATOR);
  const model = loopStandIn((view: LoopView) => (lastResult(view, "set_follow_up_owner")
    ? { text: "Done." }
    : { tool: "set_follow_up_owner", input: { employee_name: "Addy", owner_name: ownerName, owner_evidence: evidenceFrom(view, `to ${ownerName}`) } }));
  t.loopModel!(model);
  await t.thread().say(said);
  return model.views.flatMap((view) => view.results.filter((result) => result.tool === "set_follow_up_owner")).at(-1)?.output as Record<string, unknown> | undefined;
}

type CalendarOutput = { events?: { date: string; what: string; title: string; employee_name_hidden?: boolean; follow_up_owner?: string; assigned_to_you?: boolean }[]; error?: string };

async function calendarAs(t: ReplayContext, role: string, scope: unknown, subject: string) {
  t.as(role, scope, subject);
  const secret = process.env.HUB_PARTNER_SECRET;
  delete process.env.HUB_PARTNER_SECRET;
  try {
    const model = loopStandIn((view: LoopView) => (lastResult(view, "read_calendar") ? { text: "Dec 3." } : { tool: "read_calendar", input: { from: "2026-11-30", to: "2026-12-06" } }));
    t.loopModel!(model);
    await t.thread().say("what's on my calendar next week");
    const output = model.views.flatMap((view) => view.results.filter((result) => result.tool === "read_calendar")).at(-1)?.output as CalendarOutput | undefined;
    expect(output?.error, JSON.stringify(output)).toBeUndefined();
    return (output?.events ?? []).find((e) => e.what === "form-follow-up" && e.date === "2026-12-03");
  } finally {
    if (secret !== undefined) process.env.HUB_PARTNER_SECRET = secret;
  }
}

export const NOV27_FOLLOW_UP_OWNER_CASES: ReplayCase[] = [
  {
    id: "nov27-assign-follow-up-to-dm",
    title: `"assign Addy's follow-up to <DM>" — the DM who covers the salon owns it, it is on their calendar with the employee's name; a DM of another salon is refused`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      t.directory([...STAFF, ADDY]);
      vi.setSystemTime(new Date("2026-11-27T15:00:00Z"));
      t.addRows!("app_users", [account(DM, "Tobin Marsh", DM_SCOPE), account(DM_AWAY, "Tobias Wren", { level: "salon", primaryAreaId: "loc-0101", alsoCoversAreaIds: [] })]);
      const id = await fileCoachingForAddy(t);
      const row = () => (t.rows?.("form_instances") ?? []).find((form) => form.id === id)!;

      // A DM who does not cover the salon is not someone who may own it: refused, nothing written.
      const away = await assignInChat(t, "assign Addy's follow-up to Tobias", "Tobias");
      expect(away?.reason_code, JSON.stringify(away)).toBe("owner_not_allowed");
      expect(away?.may_own as string[]).toContain("Tobin Marsh");
      expect(row().follow_up_owner ?? null).toBeNull();

      // Before: the DM sees the follow-up (their salon) but not who it is for.
      const before = await calendarAs(t, "district_manager", DM_SCOPE, DM);
      expect(before?.employee_name_hidden, JSON.stringify(before)).toBe(true);

      // The owner's words.
      const set = await assignInChat(t, "assign Addy's follow-up to Tobin", "Tobin");
      expect(set?.error, JSON.stringify(set)).toBeUndefined();
      expect(set?.updated).toEqual(["follow_up_owner"]);
      expect(row().follow_up_owner).toBe(DM);

      // The DM's calendar: on its date, with the employee's name, assigned to them.
      const owner = await calendarAs(t, "district_manager", DM_SCOPE, DM);
      expect(owner, "the follow-up is not on the owner's calendar").toBeDefined();
      expect(owner!.title).toContain("Quillfeather");
      expect(owner!.employee_name_hidden).toBeUndefined();
      expect(owner!.assigned_to_you).toBe(true);

      // The creator keeps it, and reads who owns it now.
      const creator = await calendarAs(t, "salon_director", KEARNEY, CREATOR);
      expect(creator?.title).toContain("Quillfeather");
      expect(creator?.follow_up_owner).toBe("Tobin Marsh");
    },
  },
];
