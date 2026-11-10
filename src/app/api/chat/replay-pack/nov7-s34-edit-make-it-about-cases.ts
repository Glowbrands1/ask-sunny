import { expect, vi } from "vitest";

import { KEARNEY, STAFF, noClaimWithoutUpdate, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * sf-s34: "MAKE IT ABOUT …" ON AN OPEN COACHING DRAFT CHANGED NOTHING (Pau's scan, 7 Nov 2026)
 * ============================================================================
 *
 * A manager, live on 6 Nov 2026, word for word (the employee invented): a Coaching draft was open, and "I need
 * you to make it about showing up late and please list the policy make the date for 10/14/26." got "I haven't
 * changed the Coaching Form … everything on it is as it was". The revision was scoped to the date alone (already
 * 10/14), so the Details rewrite was refused. EDIT_MAKE_IT_ABOUT_ENABLED (`forms/revision.ts` scopeRevision;
 * Pau-approved 7 Nov).
 */

const WRENNA: DirectoryRow = {
  id: "e-wrenna-calloway-s34",
  firstName: "Wrenna",
  lastName: "Calloway",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

const REQUEST =
  "I need you to draw me up a a coachong document for Wrenna Calloway. She already has one but the policy was not listed so that needs added in this is the coaching document dreated on 10/14/26";
const EDIT = "I need you to make it about showing up late and please list the policy make the date for 10/14/26.";
const LATE =
  "Observed:\nWrenna Calloway arrived late to work.\n\nExpectation:\nWrenna is expected to arrive on time.\n\nPolicy reference: Attendance Policy, JBA Policy Manual p.14";

export const NOV7_S34_EDIT_MAKE_IT_ABOUT_CASES: ReplayCase[] = [
  {
    id: "nov7-s34-edit-make-it-about",
    title: "sf-s34: \"make it about showing up late … make the date for 10/14/26\" rewrites the open Coaching draft's Details",
    report: "Pau's morning scan, 7 Nov 2026 (sf-s34; live chat 6 Nov 2026)",
    // Changed on purpose (8 Nov 2026): QA's flip 9 (00:59 PHT) turned this case's flags on in production (production-flags.json); it now holds with production's flags.
    status: "fixed",
    fixFlags: ["EDIT_MAKE_IT_ABOUT_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-06T14:00:00Z"));
      t.directory([...STAFF, WRENNA]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say(REQUEST);
      t.draftWrites({ coaching_details: "Observed:\nThis coaching document was created on 10/14/26 regarding Wrenna Calloway." });
      const id = await thread.create();
      t.revisionWrites({ coaching_details: LATE });
      const reply = await thread.say(EDIT);
      noClaimWithoutUpdate(reply);
      expect(t.values(id).coaching_details, "the Details are now about showing up late").toContain("arrived late");
      expect(reply.content).not.toMatch(/haven'?t changed/i);
    },
  },
];
