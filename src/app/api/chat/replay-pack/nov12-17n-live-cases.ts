import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext, type ReplayThread } from "./cases";

/**
 * ============================================================================
 * QA's BUBBLES 17n LIVE TEST (12 Nov 2026), PORTED
 * ============================================================================
 *
 * The sibling app's managers' wording ("the store" read as "the salon" here), the employee invented (on the pack's
 * roster). The same readers run here.
 */
const REPORT = "QA's Bubbles 17n live test, 12 Nov 2026 (ported)";

function start(t: ReplayContext): ReplayThread {
  vi.setSystemTime(new Date("2026-11-12T10:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV12_17N_LIVE_CASES: ReplayCase[] = [
  {
    id: "nov12-17n-4b-late-to-reoepn-is-late-opening",
    title: "4b: \"he was late to reoepn the salon on 11/9\" cites Late Opening, not Attendance from \"late\"",
    report: REPORT,
    status: { open: "the card cites Attendance from \"late\"" },
    fixFlags: ["REOPEN_IS_OPENING_ENABLED"],
    async run(t) {
      const reply = await start(t).say("create a corrective action for Remy Calder, he was late to reoepn the salon on 11/9");
      expect(reply.content, reply.content).toMatch(/\*\*Policy:\*\* Late Opening\b/);
      expect(reply.content, reply.content).not.toMatch(/\*\*Policy:\*\* Attendance\b/);
    },
  },
];
