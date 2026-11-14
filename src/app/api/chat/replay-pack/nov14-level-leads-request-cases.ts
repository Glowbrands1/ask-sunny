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
    // QA's live test in the sibling app, 14 Nov 2026: the request line stayed in the card's account and the saved Observation.
    await expectAccountOnly(t, thread, answer.content, said);
  },
}));

/** The card's account line and the saved Observation are the account, never the request line before its comma. */
async function expectAccountOnly(t: ReplayContext, thread: ReplayThread, content: string, said: string) {
  const account = /\*\*Observation of Offense:\*\* ([^\n]*)/.exec(content)?.[1]?.trim() ?? null;
  expect(account, `the card's Observation of Offense:\n${content}`).toBe("she was late on 11/12/26");
  // The drafting model copies the manager's request line, the worst case the guards are for.
  t.draftWrites({ observation: `Observed:\n${said}` });
  const id = await thread.create();
  const observation = t.values(id).observation ?? "";
  expect(observation, `the saved Observation:\n${observation}`).toMatch(/late on 11\/12\/26/);
  expect(observation, `the request line was saved:\n${observation}`).not.toMatch(/\b(?:verbal|written|CA)\s+for\b/i);
}

/* The guard QA named: the plain request lead was already stripped, and stays so. */
export const NOV14_LEVEL_LEADS_PLAIN_LEAD_CASES: ReplayCase[] = [
  {
    id: "nov14-level-leads-request-plain-lead-guard",
    title: '"can you make a CA for Quilla Farrowmere, she was late on 11/12/26": the card and saved Observation are the account',
    report: "QA's live test, 14 Nov 2026: the guard for the level-led lead",
    status: "fixed",
    async run(t) {
      const thread = start(t);
      const said = "can you make a CA for Quilla Farrowmere, she was late on 11/12/26";
      const answer = await thread.say(said);
      expect(answer.formProposal, "no card").toBeTruthy();
      await expectAccountOnly(t, thread, answer.content, said);
    },
  },
];

