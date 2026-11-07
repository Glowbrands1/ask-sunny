import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayAnswer, type ReplayCase } from "./cases";

/**
 * QA's round-5 live Sunny check (8 Nov 2026, 18:56Z; history 1143df48, first seen 6 Nov): the chat's first message,
 * from a manager, was
 *   "I need a corrective action made for under performance. <A> was below on PPTA, LPSVA, Club Average, Club Close %
 *    and Spa in the month of October."
 * and the CA card's Observation of Offense began mid-sentence: "made for under performance. <A> was below on PPTA…".
 * The request lead read "I need a corrective action" but not the "made for" after it. REQUEST_PARTICIPLE_LEAD_ENABLED
 * reads "made / done / written up for" as part of the request, and leaves the request's reason ("under performance")
 * out when another sentence holds the account: the Observation starts at the account. The person is invented (Wren
 * Halloway, QA's swap; not on employee_access_directory); the other cases use the pack's invented Remy Calder.
 */
const FLAG = "REQUEST_PARTICIPLE_LEAD_ENABLED";
const REPORT = "QA's round-5 live Sunny check (8 Nov 2026, history 1143df48): the Observation began \"made for under performance.\"";
const ACCOUNT = "Remy Calder was below on PPTA, LPSVA, Club Average, Club Close % and Spa in the month of October";
/** QA's wording of history 1143df48, the real name swapped for an invented one. */
const REPORTED =
  "I need a corrective action made for under performance. Wren Halloway was below on PPTA, LPSVA, Club Average, Club Close % and Spa in the month of October.";
const WREN: DirectoryRow = {
  id: "e-wren",
  firstName: "Wren",
  lastName: "Halloway",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

function observationLine(reply: ReplayAnswer): string {
  return reply.content.split("\n").find((line) => /\*\*Observation of Offense:?\*\*/i.test(line)) ?? "";
}

async function observation(t: Parameters<ReplayCase["run"]>[0], said: string): Promise<string> {
  vi.setSystemTime(new Date("2026-11-07T18:56:00Z"));
  t.directory([...STAFF, WREN]);
  t.as("salon_director", KEARNEY);
  return observationLine(await t.thread().say(said));
}

export const NOV8_OBSERVATION_MADE_FOR_CASES: ReplayCase[] = [
  {
    id: "nov8-observation-made-for-under-performance",
    title: "\"I need a corrective action made for under performance. <A> was below on PPTA, …\": the Observation starts at the account, never \"made for\"",
    report: REPORT,
    status: { open: "with production's flags the Observation starts \"made for under performance.\"" },
    fixFlags: [FLAG],
    async run(t) {
      const line = await observation(t, REPORTED);
      expect(line, `the request's words lead the Observation:\n${line}`).not.toMatch(/Offense:\*\*\s*(?:made|done)\s+for\b/i);
      expect(line, `the Observation does not start at the account:\n${line}`).toMatch(/Offense:\*\*\s*Wren Halloway was below on PPTA/);
    },
  },
  {
    id: "nov8-observation-done-for-under-performance",
    title: "the same with \"done for\"",
    report: REPORT,
    status: { open: "with production's flags the Observation starts \"done for under performance.\"" },
    fixFlags: [FLAG],
    async run(t) {
      const line = await observation(t, `I need a corrective action done for under performance. ${ACCOUNT}`);
      expect(line, `the Observation does not start at the account:\n${line}`).toMatch(/Offense:\*\*\s*Remy Calder was below on PPTA/);
    },
  },
  {
    id: "nov8-observation-made-for-late-opening",
    title: "negative: \"… made for <A> for late opening the salon on 11/2\": the account is kept, without \"made for <A>\"",
    report: REPORT,
    status: { open: "with production's flags the Observation is \"made for Remy Calder for late opening …\"" },
    fixFlags: [FLAG],
    async run(t) {
      const line = await observation(t, "I need a corrective action made for Remy Calder for late opening the salon on 11/2");
      expect(line, `the account is lost:\n${line}`).toMatch(/late opening the salon on 11\/2/);
      expect(line, `the request's words are in the Observation:\n${line}`).not.toMatch(/\bmade for\b/i);
    },
  },
];
