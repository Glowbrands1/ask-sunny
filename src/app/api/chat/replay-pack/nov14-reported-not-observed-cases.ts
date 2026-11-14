import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * A FACT SHE STATED IS NOT "OBSERVED" ON THE SAVED DRAFT (REPORTED_NOT_OBSERVED_ENABLED)
 * ============================================================================
 *
 * Port of Ask Bubbles' case: QA's Bubbles Create check (14 Nov 2026, Pau-approved), in the manager's words; the person is the pack's invented one:
 * "<A> was late on 11/3/26", "she yelled at a guest and she maybe forgot", "corrective action form", Create. The
 * saved Observation of Offense read "Observed:\nEmployee A was late to work on November 3, 2026. Employee A was also
 * observed yelling at a guest." The manager never said she saw it. The drafting model is scripted with that live
 * text; the hedge was dropped correctly and stays dropped.
 */

const LIVE = "Observed:\nMarnie Holloway was late to work on November 3, 2026. Marnie Holloway was also observed yelling at a guest.\n\nExpectation:\nEmployees are expected to arrive on time and treat guests with respect.";
const FLAG = "REPORTED_NOT_OBSERVED_ENABLED";

export const NOV14_REPORTED_NOT_OBSERVED_CASES: ReplayCase[] = [
  {
    id: "nov14-reported-not-observed-create",
    title: "\"Marnie Holloway was late on 11/3/26\" → \"she yelled at a guest and she maybe forgot\" → \"corrective action form\" → Create: the saved account says she yelled, never that she was observed",
    report: "QA's Bubbles Create check (14 Nov 2026): \"Employee A was also observed yelling at a guest\" from a fact the manager stated",
    status: { open: "the saved Observation says \"was also observed yelling at a guest\"" },
    fixFlags: [FLAG],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-13T16:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("Marnie Holloway was late on 11/3/26");
      await thread.say("she yelled at a guest and she maybe forgot");
      await thread.say("corrective action form");
      t.draftWrites({ observation: LIVE });
      const id = await thread.create();
      const observation = t.values(id).observation ?? "";
      expect(observation, observation).not.toMatch(/\bobserved\s+yelling|\bwitnessed|\bseen\s+yelling/i);
      expect(observation, observation).toMatch(/Marnie Holloway was also yelling at a guest\./);
      expect(observation, "the section label is the form's").toMatch(/^Observed:/);
      expect(observation, "the hedge stays out").not.toMatch(/maybe|forgot/i);
      expect((t.draftSystems?.() ?? []).join("\n"), "the drafting prompt asks for the plain statement").toMatch(/never as observed, seen, witnessed/);
    },
  },
  {
    id: "nov14-reported-not-observed-first-hand-kept",
    title: "\"I saw Marnie Holloway yelling at a guest on 11/3/26\" → CA → Create: what the manager saw stays observed",
    report: "QA (14 Nov 2026): negative, a manager's own observation keeps its standing",
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-13T16:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("create a CA for Marnie Holloway, I saw her yelling at a guest on 11/3/26");
      t.draftWrites({ observation: "Observed:\nMarnie Holloway was observed yelling at a guest on November 3, 2026." });
      const id = await thread.create();
      expect(t.values(id).observation ?? "").toMatch(/was observed yelling at a guest/);
    },
  },
];
