import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * CLEANING LEFT UNDONE IS OTHER, NOT THE STANDARDS OF CONDUCT
 * (Pau's ruling; QA sf-s15 trace, 5 Nov 2026; CA_SALES_POLICY_ENABLED)
 * ============================================================================
 *
 * With the sales flip's flags, "Write me a CA for Isolde Brannock for failing to
 * complete opening duties. Isolde did not complete daily cleaning duties. on
 * november 2, 2026" made a card saying "this reads as **Standards of
 * Conduct** — assigned work that wasn't completed" with "Standards of Conduct
 * Policy, JBA Policy Manual p.12", and a draft whose model ticked Standards of
 * Conduct without a basis kept it. Pau: cleaning duties not done are Other on
 * the draft, with no Standards of Conduct citation; Other is a plain box
 * (no write-in). The person is invented.
 */

const ISOLDE: DirectoryRow = {
  id: "e-isolde-brannock",
  firstName: "Isolde",
  lastName: "Brannock",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

/** The invented person of this file (a function: the registry reads exported arrays as cases). */
export function cleaningOtherPeople(): readonly DirectoryRow[] {
  return [ISOLDE];
}

const REPORT = "QA's sf-s15 trace and Pau's cleaning ruling, 5 Nov 2026";
const FLIP = ["CA_SALES_POLICY_ENABLED", "FORM_NAME_FROM_ROSTER_ENABLED", "CA_PROCEDURE_BASIS_ENABLED"];
const SOC_PAGE = /Standards of Conduct[^\n]*JBA Policy Manual p\.\d+/i;

async function card(t: ReplayContext, words: string) {
  vi.setSystemTime(new Date("2026-11-04T15:30:00Z"));
  t.directory([...STAFF, ISOLDE]);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  const reply = await thread.say(words);
  expect(thread.proposal, `no Corrective Action card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Isolde Brannock" });
  return { thread, reply };
}

const policyLine = (content: string) => content.split("\n").find((line) => /\*\*Policy:?\*\*/i.test(line)) ?? "";

export const NOV5_CLEANING_OTHER_CASES: ReplayCase[] = [
  {
    id: "nov5-cleaning-other-sf-s15",
    title: "sf-s15: \"did not complete daily cleaning duties\" — the card names Other with no Standards of Conduct page, and a draft ticked Standards of Conduct with no basis becomes Other with no Standards of Conduct quote",
    report: `${REPORT}: "Write me a CA for Isolde Brannock for failing to complete opening duties. Isolde did not complete daily cleaning duties. on november 2, 2026"`,
    status: { open: "with production's flags (CA_SALES_POLICY_ENABLED off) the card reads as Standards of Conduct and cites Standards of Conduct p.12" },
    fixFlags: FLIP,
    async run(t) {
      const { thread, reply } = await card(t, "Write me a CA for Isolde Brannock for failing to complete opening duties. Isolde did not complete daily cleaning duties. on november 2, 2026");
      expect(policyLine(reply.content), `the card's Policy line is not Other:\n${reply.content}`).toMatch(/\*\*Policy:\*\* Other\b/);
      expect(reply.content, `the card cites the Standards of Conduct for cleaning:\n${reply.content}`).not.toMatch(SOC_PAGE);
      // The drafting model ticks the Standards of Conduct and sends no basis (the case the guard missed).
      t.draftWrites({ observation: "Observed:\nIsolde Brannock did not complete the daily cleaning duties at opening on November 2, 2026." }, { offense_type: ["standards_of_conduct"] });
      const id = await thread.create();
      expect(t.checked(id).offense_type, "the draft's Type of Offense").toEqual(["other"]);
      const values = t.values(id);
      expect(values.policy_violated ?? "", "Policy Violated").not.toMatch(/Standards of Conduct/i);
      expect(values.policy_language ?? "", "Direct policy quotes the Standards of Conduct").not.toMatch(/Standards of Conduct|keeps customers, coworkers/i);
    },
  },
  {
    id: "nov5-cleaning-other-negative-woven",
    title: "negative: \"did not complete her Woven training\" (not cleaning) still reads as the Standards of Conduct",
    report: `${REPORT}, negative control`,
    status: "fixed",
    fixFlags: FLIP,
    async run(t) {
      const { reply } = await card(t, "Write me a CA for Isolde Brannock. Isolde did not complete her Woven training by the deadline on november 2, 2026");
      expect(policyLine(reply.content), `the Woven account is not the Standards of Conduct:\n${reply.content}`).toMatch(/Standards of Conduct/);
      expect(policyLine(reply.content)).not.toMatch(/\*\*Policy:\*\* Other\b/);
    },
  },
];
