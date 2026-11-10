import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * QA's Sunny gate, 6 Nov 2026 (sf-s28): "can you write me a ca for Thessaly Brandt from o street",
 * from a salon director whose only salon is Kearney. With CA_SALES_POLICY_ENABLED on the card took
 * Kearney with no word about O Street. PLACE_FROM_CUE_ENABLED reads "for <name> from <salon>" as the
 * salon named, so the card asks. The person is invented.
 */
const THESSALY: DirectoryRow = { id: "e-thessaly-brandt-from", firstName: "Thessaly", lastName: "Brandt", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

/** The invented person of this file (a function: the registry reads exported arrays as cases). */
export function placeFromCuePeople(): readonly DirectoryRow[] {
  return [THESSALY];
}

const OUT_OF_SCOPE = /\*\*NE Lincoln O Street\*\* isn['’]t a salon on your assignment/;

async function s28(t: ReplayContext) {
  vi.stubEnv("CA_ASKS_WHAT_HAPPENED_ENABLED", "true");
  vi.setSystemTime(new Date("2026-11-05T15:00:00Z"));
  t.directory([...STAFF, THESSALY]);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  await thread.say("can i give a ca for not signing off on the cleaning check list");
  const reply = await thread.say("can you write me a ca for Thessaly Brandt from o street");
  return { reply, proposal: thread.proposal };
}

export const NOV6_PLACE_FROM_CUE_CASES: ReplayCase[] = [
  {
    id: "nov6-place-from-cue-s28-ca-sales",
    title: "sf-s28 with CA_SALES on: \"… for Thessaly Brandt from o street\" says O Street is not on the assignment, and nothing is filed there",
    report: "QA's Sunny gate, 6 Nov 2026: sf-s28's out-of-assignment question lost with CA_SALES on",
    status: "fixed",
    fixFlags: ["CA_SALES_POLICY_ENABLED", "PLACE_FROM_CUE_ENABLED"],
    async run(t) {
      try {
        const { reply, proposal } = await s28(t);
        expect(reply.content, `no word about O Street:\n${reply.content}`).toMatch(OUT_OF_SCOPE);
        // OUT_OF_SCOPE_PLACE_KEEPS_OWN (on in production) keeps the card at the manager's own salon; never at O Street.
        expect([null, "loc-0309"], `the card was filed outside the assignment:\n${reply.content}`).toContain(proposal?.locationId ?? null);
      } finally {
        vi.unstubAllEnvs();
      }
    },
  },
  {
    id: "nov6-place-from-cue-transferred-negative",
    title: "negative: \"she transferred from o street last month\" is a past salon: no out-of-assignment question, the card stays at her salon",
    report: "QA, 6 Nov 2026 (PLACE_FROM_CUE's condition): a past salon is not the form's",
    status: "fixed",
    fixFlags: ["CA_SALES_POLICY_ENABLED", "PLACE_FROM_CUE_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-05T15:00:00Z"));
      t.directory([...STAFF, THESSALY]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("create a corrective action for Thessaly Brandt, she transferred from o street last month, she was late opening the salon on Monday");
      expect(reply.content, `asked about a past salon:\n${reply.content}`).not.toMatch(/isn['’]t a salon on your assignment/);
      expect(thread.proposal?.locationId ?? null, `the card's salon:\n${reply.content}`).toBe("loc-0309");
    },
  },
];
