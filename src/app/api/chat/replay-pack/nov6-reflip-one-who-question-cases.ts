import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * ONE WHO-QUESTION WHEN THE CHOICES ARE NOBODY ON THE ROSTER (port of the sibling
 * app's FORM_NAME re-flip gate, 7 Nov 2026; FORM_NAME_FROM_ROSTER_ENABLED)
 * ============================================================================
 *
 * The sibling gate's one regression (its nov5-exit-termination-paste-no-invented-facts, turn 2). The exit intake asks
 * "Which of them is this **Resignation/Exit Form** for — **A** or **B**? Tell me and I'll fill in what you've already
 * described." With FORM_NAME on, neither first name alone is a roster name, so roster-only-names replaced the
 * question with "Who is this form for? Tell me the employee's full name." and left the tail — two asks. The tail goes
 * with the question it follows. A first name alone never picks a roster person. The letter is this app's original
 * case's; every person is invented (checked against both apps' directories).
 */
const DORRAN: DirectoryRow = {
  id: "e-dorran-ashby",
  firstName: "Dorran",
  lastName: "Ashby",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

const LETTER = [
  "Meeting with Dorran tomorrow 11/06 at 7:30am ",
  "",
  "    This decision follows the text message you sent to your Salon Director on 11/05, in which you said that if you were asked to clean up a toilet overflow, you would turn in your keys.",
  "    Cleaning up this kind of incident is part of the job. We covered it in our recent safety training, including the correct PPE and cleanup steps, and it is a requirement for STC.",
  "    The tone of the message was also disrespectful to your Salon Director, Philippa.",
  "    We expect every team member to treat our Salon Directors with respect, and we are not able to continue working with you.",
  "",
  "",
  "This meeting confirms that your employment with Sun Tan City is terminated, effective 11/06/2026.",
  "",
  "Please return your salon keys and any other company property today 11/06. Your final paycheck, including all hours worked through 11/05/2026, will be issued on 11/27/2026.",
].join("\n");

const NAME_SET = [
  "FORM_NAME_FROM_ROSTER_ENABLED",
  "ROSTER_NEAR_MISS_ENABLED",
  "ROSTER_NAME_IN_CANDIDATE_ENABLED",
  "ROSTER_COMPOUND_SURNAME_ENABLED",
  "ROSTER_NOT_FOUND_ANY_PHRASING_ENABLED",
  "OFF_ROSTER_CONFIRM_ENABLED",
];

export const NOV6_REFLIP_ONE_WHO_QUESTION_CASES: ReplayCase[] = [
  {
    id: "nov6-reflip-exit-choices-one-who-question",
    title: "a termination letter, then \"I need an exit form with this information. …\": the who-question is asked once, never \"… full name. Tell me and I'll fill in …\", and no roster person is picked from a first name",
    report: "The sibling app's FORM_NAME re-flip gate (QA, 7 Nov 2026): the exit intake's who-question asked twice under FORM_NAME",
    status: "fixed",
    fixFlags: [...NAME_SET, "EXIT_STATED_ONLY_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-05T20:28:00Z"));
      t.directory([...STAFF, DORRAN]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say(LETTER);
      const reply = await thread.say(`I need an exit form with this information. ${LETTER}`);
      const asks = reply.content.split("\n").filter((line) => /\bTell me\b/.test(line));
      for (const line of asks) expect(line.match(/\bTell me\b/g)?.length, `the ask is doubled:\n${reply.content}`).toBe(1);
      expect(reply.content, `the ask is doubled:\n${reply.content}`).not.toMatch(/full name\.\s*Tell me and I/);
      expect(thread.proposal?.employeeName ?? null, `a roster person picked from a first name:\n${reply.content}`).not.toBe("Dorran Ashby");
    },
  },
];
