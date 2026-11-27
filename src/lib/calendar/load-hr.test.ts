import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * HR approval entries on the calendar (two fixes found by the HR approval end-to-end test, 27 Nov 2026):
 *  - a form sent back or rejected waits on the manager, so it leaves HR's calendar as it leaves HR's count and bell;
 *  - the owner, 27 Nov 2026, on an "Approve: Resignation/Exit Form for <employee>" entry: "all admins and [HR] can see
 *    this and the creator" — an administrator who is not an HR approver sees what is waiting on HR, with the name.
 * The HR readers are stubbed; the calendar loader (the Calendar page and read_calendar) is real. Invented people only.
 */
const read = vi.hoisted(() => ({ value: null as unknown }));
const queue = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("@/lib/forms/hr-approval", async (orig) => ({
  ...(await orig<typeof import("@/lib/forms/hr-approval")>()),
  readHrApprovalsFor: vi.fn(async () => read.value),
  listHrQueue: vi.fn(async (actor: { hrApprover?: boolean }) => (actor.hrApprover ? queue.rows : [])),
}));
vi.mock("@/lib/forms/page-scope", () => ({ pageFormsAccess: vi.fn(async () => ({})) }));
vi.mock("@/lib/forms/follow-up-queue", () => ({ readFollowUpQueue: vi.fn(async () => ({ forms: [] })) }));
vi.mock("./reminders.server", () => ({ listVisibleReminders: vi.fn(async () => []) }));

const { loadCalendarFor } = await import("./load.server");

const ROW = (id: string, state: string, extra: Record<string, unknown> = {}) => ({
  id, line: `Resignation/Exit Form for Quill Example at ${PLACE}`, state, managerReplied: false, overdue: false, locationName: PLACE, requestedAt: "2026-11-24T15:00:00Z", ...extra,
});
const PLACE = "Example Place";
const NOW = new Date("2026-11-25T16:00:00Z");
const RANGE = { from: "2026-11-22", to: "2026-11-28" };
const who = (role: string) => ({ subject: `u-${role}`, email: `${role}@example.test`, displayName: role, role, scope: ADMIN_SCOPE, verified: true }) as never;
const ADMIN_SCOPE = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const hrTitles = async (role: string) => {
  const r = await loadCalendarFor(who(role), RANGE, { origin: "", includeHub: false, now: NOW });
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.view.events.filter((e) => e.kind === "hr-approval").map((e) => e.title);
};

beforeEach(() => {
  process.env.FORMS_HR_APPROVAL_ENABLED = "true";
  queue.rows = [ROW("p1", "pending"), ROW("s1", "changes_requested"), ROW("r1", "rejected"), ROW("s2", "changes_requested", { managerReplied: true })];
});

describe("HR approval entries on the calendar", () => {
  it("HR sees only what waits on HR: not a form sent back or rejected (until the manager answers)", async () => {
    read.value = { kind: "hr", queue: queue.rows, sibling: null, approved: [] };
    const titles = await hrTitles("admin");
    expect(titles).toHaveLength(2);
    expect(titles.every((t) => t.startsWith("Approve: Resignation/Exit Form for Quill Example"))).toBe(true);
  });

  it('an administrator who is not on the HR list sees them as "With HR", with the name ("all admins and [HR] can see this")', async () => {
    read.value = { kind: "manager", forms: [] };
    const titles = await hrTitles("admin");
    expect(titles).toEqual(["With HR: Resignation/Exit Form for Quill Example at Example Place", "With HR: Resignation/Exit Form for Quill Example at Example Place"]);
  });

  it("an administrator's own form is listed once", async () => {
    read.value = { kind: "manager", forms: [{ id: "p1", line: ROW("p1", "pending").line, state: "pending", label: "With HR", requestedAt: "2026-11-24T15:00:00Z" }] };
    expect(await hrTitles("admin")).toHaveLength(2);
  });

  it("a manager who is not an administrator still sees only their own forms", async () => {
    read.value = { kind: "manager", forms: [] };
    expect(await hrTitles("salon_director")).toEqual([]);
  });
});
