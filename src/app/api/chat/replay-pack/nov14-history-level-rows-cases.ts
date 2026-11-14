import { vi, expect } from "vitest";

import { STAFF, KEARNEY, type DirectoryRow, type ReplayCase, type ReplayContext, type ReplayThread } from "./cases";

/**
 * QA's follow-ups to both gates on #970 / the sibling app's #898 (14 Nov 2026), in QA's wordings, the person invented: the
 * Prior actions rows a manager's dated history gives (HISTORY_LEVEL_ROWS, on top of HISTORY_LEVEL_NOT_THIS_FORM).
 */
const REPORT = "QA, 14 Nov 2026: follow-ups to the gates on #970 / the sibling app's #898";
const ISOLDE: DirectoryRow = {
  id: "e-isolde-farrant-rows",
  firstName: "Isolde",
  lastName: "Farrant",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

function start(t: ReplayContext): ReplayThread {
  vi.setSystemTime(new Date("2026-11-13T18:00:00Z"));
  t.directory([...STAFF, ISOLDE]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

function priorRows(content: string): string[] {
  const line = /\*\*Prior actions:\*\* (.*?), as you said\./.exec(content)?.[1];
  // PRIOR_ACTIONS_NO_SIGNED (on in production) writes "— 09/21/2026" for a step the manager told; off, "— signed …".
  return line ? line.split("; ").map((row) => row.replace(" — signed ", " — ")) : [];
}

const FIX = ["HISTORY_LEVEL_NOT_THIS_FORM_ENABLED", "HISTORY_LEVEL_ROWS_ENABLED"];

export const NOV14_HISTORY_LEVEL_ROWS_CASES: ReplayCase[] = [
  {
    id: "nov14-history-level-rows-first-verbal-was",
    title: '"her first verbal was 9/21" is a Prior actions row',
    report: REPORT,
    status: { open: "no row for the earlier verbal" },
    fixFlags: FIX,
    async run(t) {
      const answer = await start(t).say("ca for Isolde Farrant, late again today. her first verbal was 9/21");
      expect(priorRows(answer.content), "the rows").toEqual(["Verbal warning — 09/21/2026"]);
    },
  },
  {
    id: "nov14-history-level-rows-listed-once",
    title: '"she had a verbal on 9/21, verbal warning on 9/21" is one row',
    report: REPORT,
    status: { open: "no row, or the same row twice" },
    fixFlags: FIX,
    async run(t) {
      const answer = await start(t).say("ca for Isolde Farrant, late again today. she had a verbal on 9/21, verbal warning on 9/21");
      expect(priorRows(answer.content), "the rows").toEqual(["Verbal warning — 09/21/2026"]);
    },
  },
  {
    id: "nov14-history-level-rows-incident-day-level",
    title: '"<W> was late on 11/12/26, verbal warning 11/12/26" is Verbal, with no Prior row for it',
    report: REPORT,
    status: { open: "the level is also listed as a Prior row" },
    fixFlags: FIX,
    async run(t) {
      const answer = await start(t).say("Isolde Farrant was late on 11/12/26, verbal warning 11/12/26");
      expect((answer.formProposal as { warningLevel?: string | null } | undefined)?.warningLevel ?? null, "the level").toBe("verbal");
      expect(priorRows(answer.content), "the rows").toEqual([]);
    },
  },
];
