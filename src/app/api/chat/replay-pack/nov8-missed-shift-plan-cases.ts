import { expect, vi } from "vitest";

import { STAFF, KEARNEY, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A MISSED SHIFT IS NO LATENESS: THE SAVED ACTION PLAN IS THE CARD'S (QA's Sunny live Create test, round 5, 8 Nov 2026)
 * ============================================================================
 *
 * On production with round 5 on, sf-s38's "make me an CA for <name> missing her saturday and sunday shifts due to
 * wanting to go home for the weekend but failed to communicate proporley" made a card whose Action Plan read
 * "Management will review the Attendance policy with <name>. Future policy violations may result …", and Create saved
 * "<name> is expected to arrive on time for all scheduled shifts moving forward … Continued lateness will result in
 * further disciplinary review …": ATTENDANCE_ACTION_PLAN's lateness plan, for shifts she never came to.
 * MISSED_SHIFT_NOT_LATENESS_ENABLED (`forms/attendance-action-plan.ts`). The manager's words; the person is invented.
 */
const RHEA: DirectoryRow = { id: "e-rhea-calloway-s38", firstName: "Rhea", lastName: "Calloway", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const T1 =
  "make me an CA for Rhea Calloway missing her saturday and sunday shifts due to wanting to go home for the weekend but failed to communicate proporley";
const FIX = ["MISSED_SHIFT_NOT_LATENESS_ENABLED"];
const REPORT = "QA's Sunny live Create test, round 5 (8 Nov 2026), sf-s38 T1: the saved Action Plan was the lateness plan";
const LATENESS_PLAN = /arrive on time|Continued lateness/i;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-07T16:14:00Z"));
  t.directory([...STAFF, RHEA]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

/** The card's Action Plan line, as the reply shows it. */
const cardPlan = (content: string) => (/\*\*Action Plan:\*\*\s*([^\n]+)/i.exec(content)?.[1] ?? "").trim();

export const NOV8_MISSED_SHIFT_PLAN_CASES: ReplayCase[] = [
  {
    id: "nov8-missed-shift-plan-t1",
    title: "sf-s38 T1 \"… missing her saturday and sunday shifts … failed to communicate proporley\", then Create: the saved Action Plan is the card's, never the lateness plan",
    report: REPORT,
    status: { open: "the saved Action Plan is \"Rhea is expected to arrive on time for all scheduled shifts … Continued lateness …\"" },
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      // The live reading named the Attendance policy (the card cited it, QA's test); scripted as the pack does.
      t.slotsRead({ policyHeading: "Attendance" });
      const card = await thread.say(T1);
      const shown = cardPlan(card.content);
      expect(shown, `the card shows no Action Plan:\n${card.content}`).not.toBe("");
      expect(shown, "the card's plan is the lateness plan").not.toMatch(LATENESS_PLAN);
      t.draftWrites({ observation: "Observed:\nRhea Calloway missed her Saturday and Sunday shifts and did not communicate it properly." });
      const id = await thread.create();
      const saved = t.values(id).action_plan ?? "";
      expect(saved, "the saved Action Plan is the lateness plan").not.toMatch(LATENESS_PLAN);
      expect(saved.replace(/\s+/g, " ").trim(), `the saved Action Plan is not the card's:\ncard: ${shown}\nsaved: ${saved}`).toBe(shown.replace(/\s+/g, " ").trim());
    },
  },
  {
    id: "nov8-missed-shift-plan-late-negative",
    title: "negative: \"… she was 30 minutes late to her shift on 11/2\": lateness keeps the attendance plan",
    report: `${REPORT} (the condition: only an account without lateness)`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      await thread.say("make me an CA for Rhea Calloway, she was 30 minutes late to her shift on 11/2");
      t.draftWrites({ observation: "Observed:\nRhea Calloway was 30 minutes late to her shift on 11/2/2026." });
      const id = await thread.create();
      expect(t.values(id).action_plan ?? "", "lateness lost its plan").toMatch(LATENESS_PLAN);
    },
  },
];
