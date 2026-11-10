import { expect, vi } from "vitest";

import { STAFF, TWO_SALONS, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A COPIED FORM GOES TO THE NEW PERSON'S OWN SALON (QA's Sunny flip-9 live tester, 8 Nov 2026)
 * ============================================================================
 *
 * Live, with SAME_FORM_COPY_NEW_PERSON on: "copy this form for <B>" with <A>'s Coaching Form open made B's card,
 * and Create, at A's salon — the salon the conversation named for A — though the ask says "Their own position and
 * location go on it". COPY_OWN_SALON_ENABLED gives the card B's own salon from the roster. Invented people; A works
 * at Kearney (loc-0309) only, B at loc-0307 only, and the manager covers both.
 */
const at = (id: string, firstName: string, lastName: string, salon: string, positionName: string): DirectoryRow => ({
  id,
  firstName,
  lastName,
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: [salon],
  positionName,
});
const ORLA = at("e-orla-venning", "Orla", "Venning", "loc-0309", "Tanning Consultant");
const CORMAC = at("e-cormac-teague", "Cormac", "Teague", "loc-0307", "Assistant Salon Director");
const FIX = ["SAME_FORM_COPY_NEW_PERSON_ENABLED", "COPY_OWN_SALON_ENABLED"];

/** The invented people of this file (a function: the registry reads exported arrays as cases). */
export function copyOwnSalonPeople(): readonly DirectoryRow[] {
  return [ORLA, CORMAC];
}

async function orlaForm(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-07T02:00:00Z"));
  t.directory([...STAFF, ORLA, CORMAC]);
  t.as("salon_director", TWO_SALONS);
  const thread = t.thread();
  await thread.say("create a coaching form for Orla Venning at kearney");
  expect(thread.proposal, "no Coaching card for Orla Venning").toMatchObject({ templateKey: "coaching", employeeName: "Orla Venning", locationId: "loc-0309" });
  t.draftWrites({ coaching_details: "Observed: Orla Venning leaves the tanning beds unwiped between guests." });
  const orla = await thread.create();
  return { thread, orla };
}

export const NOV8_COPY_OWN_SALON_CASES: ReplayCase[] = [
  {
    id: "nov8-copy-own-salon-copy-this-form-for",
    title: "\"copy this form for <B>\" with <A>'s form open: B's card and form are at B's own salon, never A's",
    report: "QA's Sunny flip-9 live tester, 8 Nov 2026 (3): the copy carries over A's salon",
    // Changed on purpose (8 Nov 2026): fixed in production by COPY_OWN_SALON_ENABLED, QA round 5, 8 Nov 2026; it now holds with production's flags.
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const { thread, orla } = await orlaForm(t);
      const reply = await thread.say("copy this form for Cormac Teague");
      expect(thread.proposal, `no Coaching card for Cormac Teague:\n${reply.content}`).toMatchObject({ templateKey: "coaching", employeeName: "Cormac Teague" });
      expect(thread.proposal?.locationId, "Cormac's card is at Orla's salon").toBe("loc-0307");
      const cormac = await thread.create();
      expect(cormac).not.toBe(orla);
      const row = t.forms().find((form) => (form as { id?: string }).id === cormac) as { location_id?: string } | undefined;
      expect(row?.location_id, "Cormac's form is at Orla's salon").toBe("loc-0307");
      expect(t.values(cormac).coaching_details ?? "", "Orla's Details were not copied").toMatch(/unwiped/);
      expect(t.values(orla).location ?? "", "Orla's own form changed salon").toMatch(/kearney/i);
    },
  },
  {
    id: "nov8-copy-own-salon-same-draft-then-name",
    title: "\"the same draft that we did with <A> by changing the name and position?\" → \"<B>\": B's card is at B's own salon",
    report: "QA's Sunny flip-9 live tester, 8 Nov 2026 (3), the SAME_FORM_COPY_NEW_PERSON wording",
    // Changed on purpose (8 Nov 2026): fixed in production by COPY_OWN_SALON_ENABLED, QA round 5, 8 Nov 2026; it now holds with production's flags.
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const { thread } = await orlaForm(t);
      await thread.say("can you create the same draft that we did with Orla Venning by changing the name and position?");
      const reply = await thread.say("Cormac Teague");
      expect(thread.proposal, `no Coaching card for Cormac Teague:\n${reply.content}`).toMatchObject({ templateKey: "coaching", employeeName: "Cormac Teague" });
      expect(thread.proposal?.locationId, "Cormac's card is at Orla's salon").toBe("loc-0307");
    },
  },
];
