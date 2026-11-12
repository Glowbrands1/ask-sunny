import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * A WRITTEN CA WHOSE OBSERVATION NAMES HER BY FIRST NAME (QA's r36 live check, 12 Nov 2026; names invented)
 * ============================================================================
 *
 * QA's wording on Ask Sunny production (main 1ecadf92): "create a written CA for <A>, she was 20 minutes late on 11/10,
 * no action plan". Two findings:
 *
 *   (a) the reply said "Type of Warning: Written Warning, as you said — I'll tick it on the form", and QA read the
 *       saved instance's warning_type as NULL. Here the tick is saved as the Type of Warning row's checked
 *       ["written"] (its `value` is null: a checkbox group keeps its ticks in `checked`). A guard, so it stays so.
 *   (b) after Create, "The draft left out <last name> in Observation of Offense; tell me if you want it added." showed
 *       though the Observation named her by first name. DRAFT_FIRST_NAME_IS_PERSON_ENABLED: a first name counts as the
 *       person (`forms/draft-consistency.ts`).
 */
const ODALYS: DirectoryRow = {
  id: "e-odalys-pemberley-r36",
  firstName: "Odalys",
  lastName: "Pemberley",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};
const REQUEST = "create a written CA for Odalys Pemberley, she was 20 minutes late on 11/10, no action plan";
const OBSERVATION = "On November 10, 2026, Odalys arrived 20 minutes late for her scheduled shift.";
const notices = (replies: readonly Record<string, unknown>[]) => replies.map((reply) => String(reply.notice ?? "")).join("\n");

export const NOV12_R36_WRITTEN_CA_FIRST_NAME_CASES: ReplayCase[] = [
  {
    id: "nov12-r36-written-ca-tick-saved",
    title: "\"create a written CA for <name>, she was 20 minutes late on 11/10, no action plan\": Written Warning is ticked on the saved form",
    report: "QA's r36 live check on Ask Sunny, 12 Nov 2026 (a): the reply said it would tick Written Warning; warning_type read NULL",
    status: "fixed",
    async run(t) {
      vi.setSystemTime(new Date("2026-11-12T14:00:00Z"));
      t.directory([...STAFF, ODALYS]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say(REQUEST);
      expect(reply.content, "the reply does not say Written Warning").toMatch(/Written Warning/);
      t.draftWrites({ observation: OBSERVATION });
      const id = await thread.create();
      expect(t.checked(id).warning_type ?? [], "Written Warning is not ticked on the saved form").toEqual(["written"]);
    },
  },
  {
    id: "nov12-r36-first-name-not-left-out",
    title: "an Observation that names her by first name never says the draft left her out",
    report: "QA's r36 live check on Ask Sunny, 12 Nov 2026 (b): \"The draft left out <A> in Observation of Offense\" with her first name there",
    status: { open: "the draft's notice says her last name was left out" },
    fixFlags: ["DRAFT_FIRST_NAME_IS_PERSON_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-12T14:00:00Z"));
      t.directory([...STAFF, ODALYS]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say(REQUEST);
      t.draftWrites({ observation: OBSERVATION });
      const id = await thread.create();
      expect(t.values(id).observation ?? "", "the stand-in's Observation was not saved").toMatch(/Odalys arrived/);
      expect(notices(t.draftReplies!()), "the draft said it left her out").not.toMatch(/left out/i);
    },
  },
];
