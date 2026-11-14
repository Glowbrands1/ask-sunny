import { vi, expect } from "vitest";

import { STAFF, KEARNEY, type DirectoryRow, type ReplayCase, type ReplayContext, type ReplayThread } from "./cases";

/**
 * ============================================================================
 * AN EARLIER WARNING IS HISTORY, NOT THIS FORM'S LEVEL (QA, 14 Nov 2026; HISTORY_LEVEL_NOT_THIS_FORM)
 * ============================================================================
 *
 * QA's two wordings, the person invented: a dated earlier warning, and one "for the same thing", made the card's level
 * that earlier warning. Ask Bubbles reads both as history (its reader, 9 Oct 2026).
 */
const REPORT = "QA, 14 Nov 2026: an earlier warning was read as this form's level";
const ODALYS: DirectoryRow = {
  id: "e-odalys-brackwen-hist",
  firstName: "Odalys",
  lastName: "Brackwen",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

function start(t: ReplayContext): ReplayThread {
  vi.setSystemTime(new Date("2026-11-14T04:30:00Z"));
  t.directory([...STAFF, ODALYS]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV14_HISTORY_LEVEL_NOT_THIS_FORM_CASES: ReplayCase[] = (
  [
    ["dated", "make a ca for Odalys Brackwen. verbal warning on 9/21. late again for 30 mins today"],
    ["same-thing", "make a ca for Odalys Brackwen. written warning for the same thing, now late today"],
  ] as const
).map(([slug, said]): ReplayCase => ({
  id: `nov14-history-level-not-this-form-${slug}`,
  title: `"${said}": the earlier warning is history, so the card has no level of its own`,
  report: REPORT,
  status: { open: "the card's level is the earlier warning's" },
  fixFlags: ["HISTORY_LEVEL_NOT_THIS_FORM_ENABLED"],
  async run(t) {
    const thread = start(t);
    const answer = await thread.say(said);
    expect(answer.formProposal, "no card").toBeTruthy();
    expect((answer.formProposal as { warningLevel?: string | null } | undefined)?.warningLevel ?? null, "the level").toBeNull();
  },
}));

/*
 * Gate-Sunny-3's findings on #970, as QA ruled them (14 Nov 2026), the person invented. F1: a level dated with the
 * incident's own day, filed the next day, is this form's level. F2/F3: a level dated before today's incident goes under
 * Prior actions with its date, and the card still says the level is the manager's to set.
 */
function startOn13(t: ReplayContext): ReplayThread {
  vi.setSystemTime(new Date("2026-11-13T18:00:00Z"));
  t.directory([...STAFF, ODALYS]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV14_HISTORY_LEVEL_GATE_CASES: ReplayCase[] = [
  {
    id: "nov14-history-level-own-incident-day",
    title: '"verbal warning on 11/12/26 for Odalys Brackwen, she was late that day", filed the next day, is a Verbal',
    report: "Gate-Sunny-3 on #970 (F1), 14 Nov 2026: a level dated with the incident's own day was read as history",
    // A guard, not a fix: flag off it is Verbal already; with the flag on it must stay Verbal.
    status: "fixed",
    async run(t) {
      const thread = startOn13(t);
      const answer = await thread.say("verbal warning on 11/12/26 for Odalys Brackwen, she was late that day");
      expect(answer.formProposal, "no card").toBeTruthy();
      expect((answer.formProposal as { warningLevel?: string | null } | undefined)?.warningLevel ?? null, "the level").toBe("verbal");
    },
  },
  {
    id: "nov14-history-level-goes-under-prior-actions",
    title: '"ca for Odalys Brackwen, verbal warning on 9/21. late again for 30 mins today" lists the verbal under Prior actions',
    report: "Gate-Sunny-3 on #970 (F2, F3), 14 Nov 2026: the earlier verbal was dropped, and the card no longer said the level was the manager's",
    status: { open: "the card's level is the earlier warning's" },
    fixFlags: ["HISTORY_LEVEL_NOT_THIS_FORM_ENABLED"],
    async run(t) {
      const thread = startOn13(t);
      const answer = await thread.say("ca for Odalys Brackwen, verbal warning on 9/21. late again for 30 mins today");
      expect(answer.formProposal, "no card").toBeTruthy();
      expect((answer.formProposal as { warningLevel?: string | null } | undefined)?.warningLevel ?? null, "the level").toBeNull();
      expect(answer.content, "Prior actions").toMatch(/\*\*Prior actions:\*\* Verbal warning — (?:signed )?09\/21\/2026/);
      expect(answer.content, "the level is the manager's").toContain("You'll set the verbal/written warning level on the form");
    },
  },
];
