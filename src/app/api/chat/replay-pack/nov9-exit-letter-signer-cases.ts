import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A TERMINATION LETTER SIGNED "<NAME>, DISTRICT MANAGER": THE SIGNER IS NEVER THE SUBJECT (ported from the sibling
 * app: QA's round-6 live test there, 9 Nov 2026; pre-existing here too)
 * ============================================================================
 *
 * QA's wording, with this app's salon and title and the people invented (Corvin Ashdale, Maren Tollefsen): "create an
 * exit form for <B>, <title> at <salon>. Here is the termination letter: '<B>, your employment … <C>, District
 * Manager'". Here it was answered "Which of them is this Resignation/Exit Form for — <B>, <C> or District Manager'?"
 * (<B> off the roster) or "— <B> or <C>?" (on it). EXIT_LETTER_SIGNER_NOT_SUBJECT_ENABLED (`ai/letter-signer.ts`).
 */
const CORVIN: DirectoryRow = {
  id: "e-corvin-ashdale",
  firstName: "Corvin",
  lastName: "Ashdale",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};
export const SIGNED =
  "create an exit form for Corvin Ashdale, tanning consultant at Kearney. Here is the termination letter: 'Corvin Ashdale, your employment is terminated effective 11-6-26 because you did not show up for your scheduled shifts on 10-30-26 and 11-1-26 and did not call. You are not eligible for rehire. Please return your salon key. Maren Tollefsen, District Manager'";
const FIX = ["EXIT_LETTER_SIGNER_NOT_SUBJECT_ENABLED"];
const REPORT = "QA's round-6 live test in the sibling app (9 Nov 2026): the letter's signer offered as the exit form's subject";

function start(t: ReplayContext, onRoster: boolean) {
  vi.setSystemTime(new Date("2026-11-07T16:00:00Z"));
  t.directory(onRoster ? [...STAFF, CORVIN] : STAFF);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

const cases = ([
  ["off-roster", false, "\"Which of them is this Resignation/Exit Form for — <B>, <C> or District Manager'?\""],
  ["on-roster", true, "\"Which of them is this Resignation/Exit Form for — <B> or <C>?\""],
] as const).map(([key, onRoster, today]): ReplayCase => ({
  id: `nov9-exit-letter-signer-${key}`,
  title: `"create an exit form for <B>, … '<B>, your employment … <C>, District Manager'" (<B> ${key}): the card is for <B>; the signer is never offered nor her title used`,
  report: REPORT,
  // Changed on purpose (9 Nov 2026): fixed in production by EXIT_LETTER_SIGNER_NOT_SUBJECT_ENABLED, QA round 8, 9 Nov 2026; it now holds with production's flags.
  status: "fixed",
  fixFlags: FIX,
  // Changed on purpose (9 Nov 2026): coding 2's ai/server-ask.ts line landed, so the fix run holds (no fixStatus).
  async run(t) {
    const thread = start(t, onRoster);
    const { content } = await thread.say(SIGNED);
    expect(content, `the signer is offered:\n${content}`).not.toMatch(/\*\*Maren Tollefsen\*\*|District Manager'/);
    expect(thread.proposal?.employeeName ?? null, `the card is not for the employee:\n${content}`).toBe("Corvin Ashdale");
    expect(thread.proposal?.employeeRole ?? null, `the card's Position:\n${content}`).toBe("Tanning Consultant");
  },
}));

export const NOV9_EXIT_LETTER_SIGNER_CASES: ReplayCase[] = [
  ...cases,
  {
    id: "nov9-exit-letter-signed-by-the-employee",
    title: "must not change: a resignation letter the employee signs (\"… Corvin Ashdale, Tanning Consultant\") keeps the card for them",
    report: REPORT,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t, true);
      const { content } = await thread.say(
        "create an exit form for Corvin Ashdale. Here is his resignation letter: 'I am resigning from my position effective 11-6-26 to pursue other career options. Corvin Ashdale, Tanning Consultant'",
      );
      expect(thread.proposal?.employeeName ?? null, `the card is not for the employee:\n${content}`).toBe("Corvin Ashdale");
    },
  },
];
