import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { pauSfS21People } from "./nov5-pau-sf-s21-s25-cases";

/**
 * QA's B4 (a) (10 Nov 2026), Pau's sf-s22 (5 Nov 2026), the form type only: a Corrective Action asked for, the
 * reviewer's notes pasted ("Use this to make it: …"), "It needs to be a CA, not a coaching form", the notes again
 * ("Make this: …"), "Its a CA" — the card went back to a Coaching Form each time the notes were pasted: "**Kit Coaching
 * Document:**" in them read as a request for one. The Observation half of sf-s22 (another employee's notes kept out)
 * is nov5-sf-s22-ca-not-coaching. The turns are that case's, verbatim; the people invented.
 */
const S22_T1 =
  "create a ca for must see behaviors for performace  this should be for wynne sarrow  - verbal\n146 tans \nBelow in PPTA, LPSVA, Average Club, CC%, Spa%  but i need it to be in the format of Tamsyn ca  it needs to look exactally the same as tamsyns but wtih all of this information";
const REVIEWER_NOTES =
  "Please make the following edits and resubmit:\n\n1. **Kit Coaching Document:** This was signed on 10/16/2026. I do not see a date showing that Spa/EFT was signed by Corwen. Please make sure all coaching documents are signed and dated (mm/dd/yyyy format) before uploading.\n\n2. **Details – Observed:** Please reword this section to:\n   \n   For the month of October 2026, Corwen completed 24 tans and was below expectations in PPTA, LPSVA, Avg Club, CC%, and Spa%.\n\n3. **Policy Violated:** Please change this from **Under Performance** to **Standards of Conduct**, as the second bullet under that policy is lack of sales performance. You may need to manually add this bullet.";

export const NOV10_B4_CA_NOT_COACHING_CASES: ReplayCase[] = [
  {
    id: "nov10-b4-ca-not-coaching-form-type",
    title: "sf-s22, the form type: pasted reviewer notes naming a \"Kit Coaching Document\" never turn the Corrective Action card into a Coaching Form",
    report: "Pau via QA, 5 Nov 2026, sf-s22: \"It needs to be a CA, not a coaching form\" → \"Make this: …\" → back to \"Here is what I would put on a Coaching Form\"",
    status: { open: "after \"It needs to be a CA\", \"Make this: <the reviewer's notes>\" makes a Coaching Form card again" },
    fixFlags: ["PASTED_FORM_NAME_NOT_REQUEST_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-04T23:30:00Z"));
      t.directory([...STAFF, ...pauSfS21People()]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say(S22_T1);
      expect(thread.proposal, "no Corrective Action card for the request").toMatchObject({ templateKey: "dpoa" });
      const pasted = await thread.say(`Use this to make it: ${REVIEWER_NOTES}`);
      expect(pasted.content, `the pasted notes made a Coaching Form card:\n${pasted.content}`).not.toMatch(/what I would put on a \*\*Coaching Form\*\*/);
      await thread.say("It needs to be a CA, not a coaching form");
      expect(thread.proposal, "\"It needs to be a CA\" is not a Corrective Action").toMatchObject({ templateKey: "dpoa" });
      const again = await thread.say(`Make this:${REVIEWER_NOTES}`);
      expect(again.content, `back to the Coaching Form after "It needs to be a CA":\n${again.content}`).not.toMatch(/what I would put on a \*\*Coaching Form\*\*/);
      await thread.say("Its a CA");
      expect(thread.proposal, "\"Its a CA\" is still a Coaching Form").toMatchObject({ templateKey: "dpoa" });
    },
  },
];

/**
 * QA's B4 (b) (10 Nov 2026), Pau's sf-s25 (5 Nov 2026): a closing account came back "Late Opening Policy, JBA Policy
 * Manual p.15", its Action Plan reviewing the Late Opening policy (the live trace's intent read returned that heading).
 * The manager's words verbatim; the person invented. The Observation half of sf-s25 is nov5-sf-s25-closing-no-late-opening-claim.
 */
export const NOV10_B4_CLOSING_NOT_LATE_OPENING_CASES: ReplayCase[] = [
  {
    id: "nov10-b4-closing-not-late-opening",
    title: "sf-s25: a closing account (clocked out early, the booths taken down before close) is never cited as Late Opening",
    report: "Pau via QA, 5 Nov 2026, sf-s25: closing duties read as Late Opening",
    status: { open: "the card cites \"Late Opening Policy, JBA Policy Manual p.15\" and its Action Plan reviews the Late Opening policy" },
    fixFlags: ["LATE_OPENING_NEEDS_OPENING_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-04T23:30:00Z"));
      t.directory([...STAFF, ...pauSfS21People()]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("closing policy");
      await thread.say("What policy would it be if a tanning consultant did not complete the closing correctly and i have already talked to her about it");
      // The live trace (5 Nov 2026): the intent read returned policyHeading "Late Opening" (p.15) for this turn.
      t.slotsRead({ policyHeading: "Late Opening" });
      const reply = await thread.say(
        "Write a CA for Wynne Sarrow she is TC works at Omaha Pacific and on 11/3/26 she was scheduled until 9:15PM and clocked out at 9:01. She also took down the spray booths down at 8:11 PM before the Salon was closed.",
      );
      expect(thread.proposal, `no Corrective Action card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Wynne Sarrow" });
      expect(reply.content, `a closing account is cited as Late Opening:\n${reply.content}`).not.toMatch(/Late Opening/i);
    },
  },
];
