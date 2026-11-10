import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "FOR FAILURE TO OPEN ON TIME" IS WHAT HAPPENED (Pau's P16, Sunny production, 9 Nov 2026)
 * ============================================================================
 *
 * The manager's words, verbatim except the person (invented: Corisande Pell). The card answered "You haven't told me
 * what happened yet" and cited no policy: no reader took "failure to open on time" as an account. It is a late
 * opening — the manager's next turn ("… the salon opened late") was cited as Late Opening p.15.
 * FAILURE_TO_OPEN_IS_LATE_OPENING_ENABLED.
 */

const CORISANDE: DirectoryRow = {
  id: "e-fo-corisande-pell",
  firstName: "Corisande",
  lastName: "Pell",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

/** The invented person of this file (a function: the registry reads exported arrays as cases). */
export function failureToOpenPeople(): readonly DirectoryRow[] {
  return [CORISANDE];
}

export const NOV10_FAILURE_TO_OPEN_CASES: ReplayCase[] = [
  {
    id: "nov10-p16-failure-to-open-is-what-happened",
    title: "P16: \"Can you make a CA for <name> for failure to open on time?\": the card never asks what happened, and cites Late Opening",
    report: 'Pau via QA, 10 Nov 2026 (P16, conv 9 Nov ~16:54Z): "Can you make a CA for <name> for failure to open on time?" → "You haven\'t told me what happened yet."',
    status: { open: "the card says \"You haven't told me what happened yet\" and cites no policy" },
    fixFlags: ["FAILURE_TO_OPEN_IS_LATE_OPENING_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-09T16:54:00Z"));
      t.directory([...STAFF, CORISANDE]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("Can you make a CA for Corisande Pell for failure to open on time?");
      expect(thread.proposal, `no CA card for Corisande Pell:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Corisande Pell" });
      expect(reply.content, "the reason was not read as what happened").not.toMatch(/haven't told me what happened/i);
      expect(reply.content, "the card does not cite Late Opening").toMatch(/Late Opening/);
    },
  },
  {
    id: "nov10-failure-to-open-control-name-only",
    title: "control: \"Can you make a CA for <name>?\" with no reason still asks what happened",
    report: "coding 6, 10 Nov 2026: FAILURE_TO_OPEN_IS_LATE_OPENING_ENABLED's negative control",
    status: "fixed",
    fixFlags: ["FAILURE_TO_OPEN_IS_LATE_OPENING_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-09T16:54:00Z"));
      t.directory([...STAFF, CORISANDE]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("Can you make a CA for Corisande Pell?");
      expect(reply.content).toMatch(/haven't told me what happened/i);
    },
  },
];
