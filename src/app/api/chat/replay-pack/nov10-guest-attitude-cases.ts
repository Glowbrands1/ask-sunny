import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayAnswer, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "THE CUSTOMER SAID SHE WAS GIVING HER AN ATTITUDE" IS A GUEST TREATED RUDELY (Pau's sf-b5, overnight scan, 4 Nov 2026)
 * ============================================================================
 *
 * sf-b5's account, verbatim except the people (invented: Oriel Vantasse, Brannick Holt), with the name spelled as on
 * the roster so this case is the policy alone (sf-b5's misspelled name is the roster set's, `nov4-overnight-scan-cases.ts`).
 * The card cited no policy ("the applicable company policy"); a guest treated rudely is the Standards of Conduct,
 * page 12 (Pau confirmed) — GUEST_ATTITUDE_CONDUCT_ENABLED.
 */

const ORIEL: DirectoryRow = {
  id: "e-ga-oriel-vantasse",
  firstName: "Oriel",
  lastName: "Vantasse",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

/** The invented person of this file (a function: the registry reads exported arrays as cases). */
export function guestAttitudePeople(): readonly DirectoryRow[] {
  return [ORIEL];
}

const ACCOUNT =
  "verbal warning The date she complained was Oct 31st . The customer said she was giving her an attitude when she brought up that the register was charging for scent in her lotion refills and it has never done that before. When Oriel spoke with District manager Brannick Holt she said the customer had raised her voice first and she only explained the price.";

const policyLine = (reply: ReplayAnswer) => reply.content.split("\n").find((line) => /\*\*Policy:?\*\*|Policy Manual p\.\d+/i.test(line)) ?? "";

export const NOV10_GUEST_ATTITUDE_CASES: ReplayCase[] = [
  {
    id: "nov10-sf-b5-guest-attitude-cites-conduct",
    title: "sf-b5's account (\"The customer said she was giving her an attitude …\"): the CA card cites the Standards of Conduct",
    report: 'Pau via QA, 5 Nov 2026 (overnight scan sf-b5): "create a ca form for <name>" → "verbal warning The date she complained was Oct 31st . The customer said she was giving her an attitude …"',
    status: { open: "the card cites no policy (\"the applicable company policy\")" },
    fixFlags: ["GUEST_ATTITUDE_CONDUCT_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-04T15:30:00Z"));
      t.directory([...STAFF, ORIEL]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("create a ca form for Oriel Vantasse");
      const reply = await thread.say(ACCOUNT);
      expect(thread.proposal, `no CA card for Oriel Vantasse:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Oriel Vantasse" });
      expect(policyLine(reply), `the card does not cite the Standards of Conduct:\n${reply.content}`).toMatch(/standards of conduct/i);
    },
  },
  {
    id: "nov10-guest-attitude-control-coworker",
    title: "control: a coworker's attitude, no guest — not the guest reading",
    report: "coding 6, 10 Nov 2026: GUEST_ATTITUDE_CONDUCT_ENABLED's negative control",
    status: "fixed",
    fixFlags: ["GUEST_ATTITUDE_CONDUCT_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-04T15:30:00Z"));
      t.directory([...STAFF, ORIEL]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("create a ca form for Oriel Vantasse, verbal warning, she had an attitude all shift on 11/2");
      expect(reply.content, `a guest reading with no guest:\n${reply.content}`).not.toMatch(/guest treated rudely|rude to a guest/i);
    },
  },
];
