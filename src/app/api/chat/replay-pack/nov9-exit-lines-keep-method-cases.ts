import { expect, vi } from "vitest";

import { STAFF, TWO_SALONS, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * AN EXIT FORM ANSWERED ONE FIELD PER TURN KEEPS EVERY FIELD (ported from the sibling app: QA's
 * round-7 live test there, 9 Nov 2026; its tester's turns in this app's salon words, the person and address invented)
 * ============================================================================
 *
 * Turn 3 "how employee resigned - told management" filled How Employee Resigned; turn 4 "reason for resignation -
 * personal family issues" kept the Reason but blanked How Employee Resigned again, and turn 5 left it blank.
 */
export const TURNS = [
  "create an exit for marisol fenwick, assistant salon manager at kearney, ne. last day worked 10-26-26. salon items not returned and $25 will be payroll deducted for salon key. immediate voluntary term, no notice given. payroll deduct applies. not eligible for rehire. marisol's address is 812 Larkmoor Court, kearney, NE. 68845",
  "resignation date 10-26-2026",
  "how employee resigned - told management",
  "reason for resignation - personal family issues",
  "create exit for marisol fenwick",
] as const;
const METHOD = /\*\*How Employee Resigned:\*\*\s*\S/;

export const NOV9_EXIT_LINES_KEEP_METHOD_CASES: ReplayCase[] = [{
  id: "nov9-exit-lines-keep-method",
  title: "an exit form answered one field per turn: How Employee Resigned, filled on turn 3, stays on turns 4 and 5",
  report: "QA, the sibling app's round-7 live test (9 Nov 2026): How Employee Resigned filled on turn 3, blank again on turns 4–5",
  // A guard here: checked on main 8c772bff with production's flags, it already holds. This app reads the exit card from
  // the whole manager window, so the label turn is never left out; the sibling app's EXIT_LINE_ANSWERS_ADD_UP is not needed.
  status: "fixed",
  async run(t) {
    vi.setSystemTime(new Date("2026-11-09T11:26:00Z"));
    t.directory(STAFF);
    t.as("salon_director", TWO_SALONS);
    const thread = t.thread();
    const replies: string[] = [];
    for (const turn of TURNS) replies.push((await thread.say(turn)).content);
    // The sibling app's roster-set gate R16A (10 Nov 2026), seen here too: with FORM_NAME_FROM_ROSTER on the exit card read "- **Name:** The employee".
    for (const said of replies) expect(said, `the card's Name is "The employee":\n${said}`).not.toMatch(/\*\*Name:\*\*\s*The employee/i);
    for (const at of [2, 3, 4]) {
      expect(replies[at], `turn ${at + 1}: How Employee Resigned is blank:\n${replies[at]}`).toMatch(METHOD);
      expect(replies[at], `turn ${at + 1}: How Employee Resigned is left blank:\n${replies[at]}`).not.toMatch(/Left blank for you to review:\*\*[^\n]*How Employee Resigned/);
    }
    for (const at of [3, 4]) expect(replies[at], `turn ${at + 1}: Reason lost:\n${replies[at]}`).toMatch(/\*\*Reason for Resignation:\*\*\s*\S/);
    for (const at of [1, 2, 3, 4]) expect(replies[at], `turn ${at + 1}: Resignation Date lost:\n${replies[at]}`).toMatch(/\*\*Resignation Date:\*\*\s*October 26, 2026/);
  },
}];
