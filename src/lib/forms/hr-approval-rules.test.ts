import { afterEach, describe, expect, it } from "vitest";

import { TEMPLATE_SEEDS } from "./library";
import {
  HR_APPROVAL_FLAG,
  businessDaysWaiting,
  editableDraft,
  hiddenWhileAwaitingHr,
  hrApprovalEnabled,
  isOverdue,
  mayReadHrDecision,
  reminderDueAt,
  templateRoutesToHr,
  waitingLabel,
} from "./hr-approval-rules";

/*
 * HR APPROVAL — THE RULES (owner request, 23 Nov 2026). Every form except the Coaching Form (and its Follow-Up) waits
 * for HR; while it waits only its creator and HR know it exists; overdue after one business day; HR's reminder at
 * 6 AM Central on weekdays. Invented ids only.
 */

const ORIGINAL = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("which forms wait for HR — every template in the library, by name", () => {
  /*
   * The full list, so a template added later fails here until someone decides. The owner confirmed the hiring
   * interview forms wait for HR too (23 Nov 2026: "sure"). Demotion and Position Transfer share the Coaching Form's
   * layout and must still route: the rule reads the template's own permission, never its layout.
   */
  const EXPECTED: Record<string, boolean> = {
    "Coaching Form": false,
    "Follow-Up Coaching Form": false,
    "Corrective Action Form": true,
    "Policy Review": true,
    "SDIT EPP": true,
    "TSD EPP": true,
    "ASD-SDIT Performance EPP": true,
    "FTTC Performance EPP": true,
    "DMIT EPP — TSD Review": true,
    "DMIT EPP — DMIT Review": true,
    "Resignation/Exit Form": true,
    "Demotion Form": true,
    "Position Transfer Form": true,
    "Prescreen / Phone Interview Form": true,
    "Tanning Consultant Interview Form": true,
    "First Round Management Interview Form": true,
    "Second Round Management Interview Form": true,
  };

  it("lists every template exactly once", () => {
    expect(TEMPLATE_SEEDS.map((seed) => seed.name).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(TEMPLATE_SEEDS.map((seed) => [seed.name, seed.requiredPermission, seed.layoutFamily] as const))(
    "%s",
    (name, permission) => {
      expect(templateRoutesToHr(permission)).toBe(EXPECTED[name]);
    },
  );

  it("Demotion and Position Transfer use the coaching layout and still go to HR", () => {
    const shared = TEMPLATE_SEEDS.filter((seed) => seed.layoutFamily === "coaching" && seed.requiredPermission !== "create_coaching_form");
    expect(shared.map((seed) => seed.name).sort()).toEqual(["Demotion Form", "Position Transfer Form"]);
    for (const seed of shared) expect(templateRoutesToHr(seed.requiredPermission)).toBe(true);
  });

  it("an unknown or missing permission goes to HR (fails toward review, never past it)", () => {
    expect(templateRoutesToHr(null)).toBe(true);
    expect(templateRoutesToHr("")).toBe(true);
    expect(templateRoutesToHr("create_something_new")).toBe(true);
  });
});

describe("who knows a form waiting for HR exists", () => {
  const form = (state: "pending" | "changes_requested" | "rejected" | "approved" | null) => ({ createdBy: "creator", hrApprovalState: state });

  it.each(["pending", "changes_requested", "rejected"] as const)("%s: the creator and HR only", (state) => {
    expect(hiddenWhileAwaitingHr({ id: "creator" }, form(state))).toBe(false);
    expect(hiddenWhileAwaitingHr({ id: "hr", hrApprover: true }, form(state))).toBe(false);
    for (const other of ["their-dm", "their-rm", "an-admin", "another-salon"]) {
      expect(hiddenWhileAwaitingHr({ id: other }, form(state)), other).toBe(true);
      expect(hiddenWhileAwaitingHr({ id: other, hrApprover: false }, form(state)), other).toBe(true);
    }
  });

  it("approved, or never sent: nobody is hidden from it by this rule", () => {
    for (const state of ["approved", null] as const) {
      expect(hiddenWhileAwaitingHr({ id: "an-admin" }, form(state))).toBe(false);
    }
  });

  it("HR's decision and notes: the creator and HR, never anybody else — approved included", () => {
    for (const state of ["pending", "changes_requested", "rejected", "approved"] as const) {
      expect(mayReadHrDecision({ id: "creator" }, form(state))).toBe(true);
      expect(mayReadHrDecision({ id: "hr", hrApprover: true }, form(state))).toBe(true);
      expect(mayReadHrDecision({ id: "their-dm" }, form(state))).toBe(false);
      expect(mayReadHrDecision({ id: "an-admin" }, form(state))).toBe(false);
    }
    expect(mayReadHrDecision({ id: "creator" }, form(null))).toBe(false);
  });

  it("only pending freezes the creator's draft; sent back or rejected, they change it and send it again", () => {
    expect(editableDraft({ status: "draft", hrApprovalState: "pending" })).toBe(false);
    expect(editableDraft({ status: "draft", hrApprovalState: "changes_requested" })).toBe(true);
    expect(editableDraft({ status: "draft", hrApprovalState: "rejected" })).toBe(true);
    expect(editableDraft({ status: "draft", hrApprovalState: null })).toBe(true);
    expect(editableDraft({ status: "finalized", hrApprovalState: "approved" })).toBe(false);
  });
});

describe("overdue after one business day, in Central time", () => {
  it("sent Monday 10:00 CT: not overdue Monday or Tuesday 9:59, overdue Tuesday 10:00", () => {
    const sent = "2026-11-23T16:00:00Z"; // Mon 10:00 CST
    expect(isOverdue(sent, new Date("2026-11-23T22:00:00Z"))).toBe(false);
    expect(isOverdue(sent, new Date("2026-11-24T15:59:00Z"))).toBe(false);
    expect(isOverdue(sent, new Date("2026-11-24T16:00:00Z"))).toBe(true);
  });

  it("sent Friday 15:00 CT: not overdue over the weekend, overdue Monday 15:00", () => {
    const sent = "2026-11-20T21:00:00Z"; // Fri 15:00 CST
    expect(isOverdue(sent, new Date("2026-11-22T21:00:00Z"))).toBe(false); // Sunday
    expect(isOverdue(sent, new Date("2026-11-23T20:59:00Z"))).toBe(false);
    expect(isOverdue(sent, new Date("2026-11-23T21:00:00Z"))).toBe(true);
  });

  it("sent on a Saturday: the clock starts Monday 00:00, so overdue Tuesday 00:00", () => {
    const sent = "2026-11-21T18:00:00Z"; // Sat noon CST
    expect(isOverdue(sent, new Date("2026-11-24T05:59:00Z"))).toBe(false); // Mon 23:59 CST
    expect(isOverdue(sent, new Date("2026-11-24T06:00:00Z"))).toBe(true); // Tue 00:00 CST
  });

  it("business days waiting skip the weekend", () => {
    const friday = "2026-11-20T21:00:00Z";
    expect(businessDaysWaiting(friday, new Date("2026-11-20T23:00:00Z"))).toBe(0);
    expect(businessDaysWaiting(friday, new Date("2026-11-22T18:00:00Z"))).toBe(0);
    expect(businessDaysWaiting(friday, new Date("2026-11-23T18:00:00Z"))).toBe(1);
    expect(businessDaysWaiting(friday, new Date("2026-11-25T18:00:00Z"))).toBe(3);
    expect(waitingLabel(friday, new Date("2026-11-20T23:00:00Z"))).toBe("Sent today");
    expect(waitingLabel(friday, new Date("2026-11-25T18:00:00Z"))).toBe("Waiting 3 business days");
  });
});

describe("the 6 AM Central reminder, across daylight saving", () => {
  it("winter (CST, UTC-6): the 12:05 UTC run is due, the 11:05 one is not", () => {
    expect(reminderDueAt(new Date("2026-11-23T11:05:00Z"))).toEqual({ due: false, localDate: "2026-11-23" });
    expect(reminderDueAt(new Date("2026-11-23T12:05:00Z"))).toEqual({ due: true, localDate: "2026-11-23" });
  });

  it("summer (CDT, UTC-5): the 11:05 UTC run is due, the 12:05 one is not", () => {
    expect(reminderDueAt(new Date("2026-07-15T11:05:00Z"))).toEqual({ due: true, localDate: "2026-07-15" });
    expect(reminderDueAt(new Date("2026-07-15T12:05:00Z")).due).toBe(false);
  });

  it("never on a weekend", () => {
    expect(reminderDueAt(new Date("2026-11-21T12:05:00Z")).due).toBe(false); // Saturday
    expect(reminderDueAt(new Date("2026-11-22T12:05:00Z")).due).toBe(false); // Sunday
  });

  it("the cron is scheduled at both UTC hours, weekdays only", async () => {
    const { readFileSync } = await import("node:fs");
    const crons = (JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] }).crons;
    expect(crons).toContainEqual({ path: "/api/forms/hr-approval/cron", schedule: "5 11,12 * * 1-5" });
  });
});

describe("the flag", () => {
  it("reads off by default, and is off in production", async () => {
    delete process.env[HR_APPROVAL_FLAG];
    expect(hrApprovalEnabled()).toBe(false);
    const { readFileSync } = await import("node:fs");
    const flags = JSON.parse(readFileSync("src/config/production-flags.json", "utf8")) as { off: string[] };
    expect(flags.off).toContain(HR_APPROVAL_FLAG);
  });
});
