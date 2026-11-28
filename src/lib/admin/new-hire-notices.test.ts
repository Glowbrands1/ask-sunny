import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  additionalSalons,
  isRecentHire,
  newHireNoticeText,
  newHireNotifications,
  readNewHireNoticeConfig,
  windowStart,
  NEW_HIRE_NOTICE_HREF,
  NEW_HIRE_NOTICE_KIND,
  type HiredEmployee,
} from "./new-hire-notices";
import { announceNewHires, type NewHireNoticeDeps } from "./new-hire-notices.server";

/*
 * Pau, 28 Nov 2026: "create a notification when a new person is onboarded like a manager, assistant etc. for admins
 * only for now backfill it when creating the notification that a new employee [name] , email address in woven has
 * been hired as X position in X salon , and list if they have any other additional salon".
 *
 * Invented people and salons only (CLAUDE.md §2).
 */

const NOW = new Date("2026-11-28T15:00:00Z");
const ON = { NEW_HIRE_NOTICES_ENABLED: "true" };

const hire = (id: string, over: Partial<HiredEmployee> = {}): HiredEmployee => ({
  externalEmployeeId: id,
  firstName: "Robin",
  lastName: "Quillfeather",
  preferredFirstName: null,
  emailAddress: "robin.quillfeather@example.com",
  employmentStatus: "active",
  hireDate: "2026-11-24",
  positionName: "Salon Director",
  primaryLocationId: "L1",
  primaryLocationName: "Maple Grove",
  locations: [{ wovenLocationId: "L1", locationName: "Maple Grove", locationNumber: "101", accessType: "primary", expiresOn: null }],
  ...over,
});

describe("the notice's words", () => {
  it("says the name, the Woven email, the position, the salon and that there are no other salons", () => {
    expect(newHireNoticeText(hire("E1"))).toEqual({
      title: "New hire: Robin Quillfeather — Salon Director",
      body: "New employee Robin Quillfeather, robin.quillfeather@example.com in Woven, has been hired as Salon Director at Maple Grove on Nov 24, 2026. No additional salons.",
    });
  });

  it("lists every additional salon, a temporary one with its end date, never the primary twice", () => {
    const person = hire("E2", {
      positionName: "Assistant Salon Director",
      locations: [
        { wovenLocationId: "L1", locationName: "Maple Grove", locationNumber: "101", accessType: "primary", expiresOn: null },
        { wovenLocationId: "L3", locationName: "Cedar Point", locationNumber: "103", accessType: "additional", expiresOn: null },
        { wovenLocationId: "L2", locationName: "Birch Hollow", locationNumber: "102", accessType: "temporary_or_expiring_access", expiresOn: "2026-12-15" },
        { wovenLocationId: "L3", locationName: "Cedar Point", locationNumber: "103", accessType: "additional", expiresOn: null },
      ],
    });
    expect(additionalSalons(person)).toEqual(["Birch Hollow (temporary, until Dec 15, 2026)", "Cedar Point"]);
    expect(newHireNoticeText(person).body).toBe(
      "New employee Robin Quillfeather, robin.quillfeather@example.com in Woven, has been hired as Assistant Salon Director at Maple Grove on Nov 24, 2026. Additional salons: Birch Hollow (temporary, until Dec 15, 2026), Cedar Point.",
    );
  });

  it("says plainly what Woven does not have: no email, no position, no primary salon", () => {
    const body = newHireNoticeText(hire("E3", { emailAddress: "  ", positionName: null, primaryLocationId: null, primaryLocationName: null, locations: [] })).body;
    expect(body).toBe(
      "New employee Robin Quillfeather (no email in Woven) has been hired as a position Woven does not name with no primary salon in Woven on Nov 24, 2026. No additional salons.",
    );
  });

  it("names a preferred first name when it differs", () => {
    expect(newHireNoticeText(hire("E4", { preferredFirstName: "Robbie" })).title).toBe("New hire: Robin Quillfeather (goes by Robbie) — Salon Director");
  });
});

describe("who is a new hire, and who hears about it", () => {
  it("active and hired in the window (30 days back by default, today included)", () => {
    const since = windowStart("2026-11-28", 30);
    expect(since).toBe("2026-10-29");
    expect(isRecentHire(hire("A", { hireDate: "2026-10-29" }), since, "2026-11-28")).toBe(true);
    expect(isRecentHire(hire("B", { hireDate: "2026-11-28" }), since, "2026-11-28")).toBe(true);
    expect(isRecentHire(hire("C", { hireDate: "2026-10-28" }), since, "2026-11-28")).toBe(false);
    expect(isRecentHire(hire("D", { hireDate: "2026-11-29" }), since, "2026-11-28")).toBe(false);
    expect(isRecentHire(hire("E", { hireDate: null }), since, "2026-11-28")).toBe(false);
    expect(isRecentHire(hire("F", { employmentStatus: "terminated" }), since, "2026-11-28")).toBe(false);
  });

  it("the switch is off by default; the window is 1–365 days, else 30", () => {
    expect(readNewHireNoticeConfig({})).toEqual({ enabled: false, backfillDays: 30 });
    expect(readNewHireNoticeConfig({ ...ON, NEW_HIRE_NOTICE_BACKFILL_DAYS: "14" })).toEqual({ enabled: true, backfillDays: 14 });
    for (const bad of ["0", "366", "-3", "two weeks"]) expect(readNewHireNoticeConfig({ ...ON, NEW_HIRE_NOTICE_BACKFILL_DAYS: bad }).backfillDays).toBe(30);
  });

  it("one bell row per admin per employee, linking to the Woven directory", () => {
    const rows = newHireNotifications([hire("E1"), hire("E2")], ["Admin.One@example.com", "admin.one@example.com ", "admin.two@example.com"]);
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.recipientEmail))).toEqual(new Set(["admin.one@example.com", "admin.two@example.com"]));
    expect(rows.every((r) => r.kind === NEW_HIRE_NOTICE_KIND && r.href === NEW_HIRE_NOTICE_HREF)).toBe(true);
  });
});

function fakeDeps(hires: HiredEmployee[], admins: string[] = ["admin.one@example.com"]) {
  const announced = new Set<string>();
  const rung: { recipientEmail: string; body: string }[] = [];
  const deps: NewHireNoticeDeps & { announced: Set<string>; rung: typeof rung } = {
    announced,
    rung,
    recentHires: vi.fn(async () => hires),
    adminEmails: vi.fn(async () => admins),
    claim: vi.fn(async (rows) => {
      const mine = new Set<string>();
      for (const r of rows) {
        if (announced.has(r.externalEmployeeId)) continue;
        announced.add(r.externalEmployeeId);
        mine.add(r.externalEmployeeId);
      }
      return mine;
    }),
    release: vi.fn(async (ids: readonly string[]) => ids.forEach((id) => announced.delete(id))),
    ring: vi.fn(async (rows) => void rung.push(...rows)),
  };
  return deps;
}

describe("announceNewHires — after a successful Woven sync", () => {
  it("off by default: reads nothing", async () => {
    const deps = fakeDeps([hire("E1")]);
    expect(await announceNewHires({ env: {}, now: NOW }, deps)).toEqual({ status: "off" });
    expect(deps.recentHires).not.toHaveBeenCalled();
  });

  it("backfills: the first run announces everybody hired in the window, to every admin", async () => {
    const deps = fakeDeps([hire("E1"), hire("E2", { firstName: "Sage", lastName: "Morrowind", hireDate: "2026-11-02" })], ["admin.one@example.com", "admin.two@example.com"]);
    const outcome = await announceNewHires({ env: ON, now: NOW }, deps);
    expect(outcome).toEqual({ status: "completed", announced: 2, admins: 2, alreadyAnnounced: 0, since: "2026-10-29" });
    expect(deps.recentHires).toHaveBeenCalledWith("2026-10-29", "2026-11-28");
    expect(deps.rung).toHaveLength(4);
    // Oldest hire first.
    expect(deps.rung[0].body).toContain("Sage Morrowind");
  });

  it("each employee once, ever: the next sync announces only the person not announced before", async () => {
    const deps = fakeDeps([hire("E1")]);
    await announceNewHires({ env: ON, now: NOW }, deps);
    (deps.recentHires as ReturnType<typeof vi.fn>).mockResolvedValue([hire("E1"), hire("E9", { firstName: "Tamsin" })]);
    expect(await announceNewHires({ env: ON, now: NOW }, deps)).toMatchObject({ announced: 1, alreadyAnnounced: 1 });
    expect(deps.rung).toHaveLength(2);
    expect(deps.rung[1].body).toContain("Tamsin Quillfeather");
  });

  it("a failed bell write releases its claim, so the next run tries again; it never throws", async () => {
    const deps = fakeDeps([hire("E1")]);
    (deps.ring as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("insert failed"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await announceNewHires({ env: ON, now: NOW }, deps)).toEqual({ status: "failed", code: "new_hire_notices_failed" });
    expect(deps.announced.size).toBe(0);
    expect(await announceNewHires({ env: ON, now: NOW }, deps)).toMatchObject({ announced: 1 });
    errors.mockRestore();
  });

  it("no admin to tell: nobody is marked announced", async () => {
    const deps = fakeDeps([hire("E1")], []);
    expect(await announceNewHires({ env: ON, now: NOW }, deps)).toMatchObject({ announced: 0, admins: 0 });
    expect(deps.claim).not.toHaveBeenCalled();
  });

  it("someone outside the window or no longer active is never announced, whatever the read returned", async () => {
    const deps = fakeDeps([hire("OLD", { hireDate: "2025-03-01" }), hire("GONE", { employmentStatus: "terminated" })]);
    expect(await announceNewHires({ env: ON, now: NOW }, deps)).toMatchObject({ announced: 0 });
    expect(deps.rung).toHaveLength(0);
  });
});
