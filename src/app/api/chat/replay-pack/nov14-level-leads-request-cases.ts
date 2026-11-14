import { vi, expect } from "vitest";

import { STAFF, KEARNEY, type DirectoryRow, type ReplayCase, type ReplayContext, type ReplayThread } from "./cases";

/**
 * ============================================================================
 * A LEVEL LEADING INTO "FOR <NAME>" IS THE REQUEST (Gate-Sunny-3 via QA, 14 Nov 2026; LEVEL_LEADS_REQUEST)
 * ============================================================================
 *
 * "second verbal for <A>, she was late on 11/12/26" got no card at all: no form word and no issuing verb. QA also asked
 * for "another verbal for …" and "2nd written for …". The person is invented.
 */
const REPORT = "Gate-Sunny-3's probe via QA, 14 Nov 2026: a level leading into \"for <name>\" got no card";
const QUILLA: DirectoryRow = {
  id: "e-quilla-farrowmere-lvl",
  firstName: "Quilla",
  lastName: "Farrowmere",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

function start(t: ReplayContext): ReplayThread {
  vi.setSystemTime(new Date("2026-11-14T03:30:00Z"));
  t.directory([...STAFF, QUILLA]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV14_LEVEL_LEADS_REQUEST_CASES: ReplayCase[] = (
  [
    ["second-verbal", "second verbal for Quilla Farrowmere, she was late on 11/12/26", "verbal"],
    ["another-verbal", "another verbal for Quilla Farrowmere, she was late on 11/12/26", "verbal"],
    ["2nd-written", "2nd written for Quilla Farrowmere, she was late on 11/12/26", "written"],
  ] as const
).map(([slug, said, level]): ReplayCase => ({
  id: `nov14-level-leads-request-${slug}`,
  title: `"${said}": a Corrective Action card for Quilla Farrowmere, ${level}`,
  report: REPORT,
  status: { open: "no card: the turn is not read as a form request" },
  fixFlags: ["LEVEL_LEADS_REQUEST_ENABLED"],
  async run(t) {
    const thread = start(t);
    const answer = await thread.say(said);
    expect(answer.formProposal, "no card").toBeTruthy();
    expect(answer.formProposal?.templateKey, "the form").toBe("dpoa");
    expect(answer.formProposal?.employeeName, "the employee").toBe("Quilla Farrowmere");
    expect((answer.formProposal as { warningLevel?: string | null } | undefined)?.warningLevel ?? null, "the level").toBe(level);
  },
}));
