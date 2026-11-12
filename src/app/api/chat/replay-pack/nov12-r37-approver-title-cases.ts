import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "ONCE THE DM APPROVES" IS NOT THE EMPLOYEE'S TITLE (QA's r37 live check, 12 Nov 2026; APPROVER_TITLE_NOT_EMPLOYEE_ENABLED)
 * ============================================================================
 *
 * QA's wording on main 7e8dcdb6, the person invented (on the roster, no Woven position): "CA for <A>, probably
 * termination once the DM approves" put "Job title: District Manager" on the card.
 */
const ODALYS: DirectoryRow = { id: "e-r37-odalys-pemberley", firstName: "Odalys", lastName: "Pemberley", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: null as unknown as string };
const FIX = ["APPROVER_TITLE_NOT_EMPLOYEE_ENABLED"];

export const NOV12_R37_APPROVER_TITLE_CASES: ReplayCase[] = [
  {
    id: "nov12-r37-dm-approves-not-the-title",
    title: "\"CA for <A>, probably termination once the DM approves\": the card's Job title is never District Manager",
    report: "QA's r37 live check (12 Nov 2026): \"once the DM approves\" put \"Job title: District Manager\" on the card",
    status: { open: "the card's title is District Manager" },
    fixFlags: FIX,
    async run(t) {
      vi.setSystemTime(new Date("2026-11-12T16:00:00Z"));
      t.directory([...STAFF, ODALYS]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("CA for Odalys Pemberley, probably termination once the DM approves");
      expect(thread.proposal?.employeeName ?? null, reply.content).toBe("Odalys Pemberley");
      expect(thread.proposal?.employeeRole ?? null, reply.content).not.toBe("District Manager");
      expect(reply.content, reply.content).not.toMatch(/\*\*Job title:\*\*\s*District Manager/);
    },
  },
  {
    id: "nov12-r37-stated-title-kept",
    title: "\"CA for <A>, she is a district manager, she missed the meeting\": the title the manager stated for her stays",
    report: "Guard for QA's r37 live check (12 Nov 2026)",
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      vi.setSystemTime(new Date("2026-11-12T16:00:00Z"));
      t.directory([...STAFF, ODALYS]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("CA for Odalys Pemberley, she is a district manager, she missed the meeting");
      expect(thread.proposal?.employeeRole ?? null, reply.content).toBe("District Manager");
    },
  },
];
