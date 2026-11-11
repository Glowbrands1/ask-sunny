import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * THE WHOLE TYPED POSITION IS THE CARD'S POSITION — GUARD CASES (QA task A,
 * 6 Nov 2026; the sibling app's FULL_POSITION_TITLE_ENABLED)
 * ============================================================================
 *
 * The sibling app's exit form typed as lines cut its position "<words> Part
 * Time" to the shorter title inside it. Checked here: every one of this
 * company's salon positions typed on its own line on an exit form is the card's
 * whole Position with production's flags. "Assistant Salon Director" is read
 * as "ASD" and spelled back out (TITLE_SPELLED_OUT_ENABLED, on in production);
 * no title in this company's list is a shorter part of another of its
 * positions. So no flag here: these cases hold the reading, and the negative
 * keeps a title with other words after it as read today. See
 * `docs/parity-log/2026-11-06-full-position-title.md`. Names are invented and
 * not on the directory.
 */
const EXIT_ASK = "Can you create an exit form for me?";
const typed = (title: string) =>
  `Isaura Corvadine\n${title} \nNE Kearney\nGave notice - fulfilled notice\nGave notice 10/20/26 - date notice fulfilled 11/3/26\nResigning to pursue other career options\nSalon items returned payroll deduction does not apply eligible for rehire`;

/*
 * Changed on purpose (10 Nov 2026, QA's open-PR audit): since 9 Nov OFF_ROSTER_ASK_BEFORE_CARD (production) holds a salon
 * manager's card for a name not on the roster and asks about it first, so the exit card never came. She is on the
 * roster here, with no position of her own, so the card's Job Title is still only what the manager typed.
 */
const ISAURA: DirectoryRow = {
  id: "e-isaura-corvadine",
  firstName: "Isaura",
  lastName: "Corvadine",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: null,
};

function exitCase(id: string, typedTitle: string, position: string, title: string, open?: string): ReplayCase {
  return {
    id,
    title,
    report: "QA task A, 6 Nov 2026: the sibling app's exit card cut a typed position to the shorter title inside it; checked here",
    ...(open ? { status: { open }, fixFlags: ["FULL_POSITION_TITLE_ENABLED"] } : { status: "fixed" as const }),
    async run(t) {
      vi.setSystemTime(new Date("2026-11-06T02:00:00Z"));
      t.directory([...STAFF, ISAURA]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say(EXIT_ASK);
      const reply = await thread.say(typed(typedTitle));
      expect(thread.proposal, `no exit card:\n${reply.content}`).toMatchObject({ employeeName: "Isaura Corvadine" });
      expect(thread.proposal?.employeeRole ?? null, `the card's Position:\n${reply.content}`).toBe(position);
      expect(reply.content, `the read-back's Job Title:\n${reply.content}`).toContain(`- **Job Title:** ${position}`);
      expect(reply.content, `the Job Title is left blank:\n${reply.content}`).not.toMatch(/Left blank for you to review:\*\*[^\n]*Job Title/);
      const id = await thread.create();
      expect(t.values(id).job_title ?? null, "the saved form's Job Title").toBe(position);
    },
  };
}

/*
 * QA's ruling (a), 6 Nov 2026, kept under FULL_POSITION_TITLE (QA, 10 Nov 2026): "District Manager <name>" on the line
 * under the employee's name is the district manager's title, never the employee's; the Job Title is left for the manager.
 */
const DM_CASE: ReplayCase = {
  id: "nov6-coding3-full-position-title-dm-line",
  title: "Guard: \"District Manager Thessaly Brookhart\" on the line under the employee's name is hers: the employee's Job Title is left blank, and the read-back says so",
  report: "QA's ruling (a), 6 Nov 2026, kept by the FULL_POSITION_TITLE fix (QA, 10 Nov 2026)",
  status: "fixed",
  fixFlags: ["FULL_POSITION_TITLE_ENABLED"],
  async run(t) {
    vi.setSystemTime(new Date("2026-11-06T02:00:00Z"));
    t.directory([...STAFF, ISAURA]);
    t.as("salon_director", KEARNEY);
    const thread = t.thread();
    await thread.say(EXIT_ASK);
    const reply = await thread.say(typed("District Manager Thessaly Brookhart"));
    expect(thread.proposal, `no exit card:\n${reply.content}`).toMatchObject({ employeeName: "Isaura Corvadine" });
    expect(thread.proposal?.employeeRole ?? null, `the card's Position:\n${reply.content}`).toBeNull();
    expect(reply.content, `the read-back claims a Job Title:\n${reply.content}`).not.toMatch(/\*\*Job Title:\*\*/i);
    expect(reply.content, `a blank line inside the read-back:\n${reply.content}`).not.toMatch(/^- \*\*Name:\*\* [^\n]*\n\n- \*\*/m);
    expect(reply.content, `the read-back says a title is on the form:\n${reply.content}`).not.toMatch(/the title on the form is the one you gave/i);
    const id = await thread.create();
    expect(t.values(id).job_title ?? null, "the saved form's Job Title").toBeNull();
  },
};

export const NOV6_CODING3_FULL_POSITION_TITLE_CASES: ReplayCase[] = [
  DM_CASE,
  exitCase(
    "nov6-coding3-full-position-title-asd-exit",
    "Assistant Salon Director",
    "Assistant Salon Director",
    "Guard: an exit form typed as lines with the position \"Assistant Salon Director\": the card's Position is the whole position, not \"Salon Director\"",
  ),
  exitCase(
    "nov6-coding3-full-position-title-sd-exit",
    "Salon Director",
    "Salon Director",
    "Guard: an exit form typed as lines with the position \"Salon Director\": the card's Position is \"Salon Director\"",
  ),
  exitCase(
    "nov6-coding3-full-position-title-negative",
    "Tanning Consultant Weekends Only",
    "Tanning Consultant",
    "Negative: \"Tanning Consultant Weekends Only\" is not one of the company's positions; the card's Position is \"Tanning Consultant\"",
    // Changed on purpose (QA, 10 Nov 2026): since TITLE_ENDS_AT_LINE (on) "Weekends Only" is read as the title's owner, and
    // the Job Title is left blank for an employee with no roster position. QA ruled that a regression: FULL_POSITION_TITLE.
    "with production's flags the Job Title is left blank: \"Weekends Only\" is read as the title's owner",
  ),
];
