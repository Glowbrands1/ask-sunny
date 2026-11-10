import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * A TERMINATION LETTER PASTED FOR AN EXIT FORM: NO INVENTED FACTS (QA, 5 Nov 2026, severe)
 * ============================================================================
 *
 * A salon director pasted a termination letter (meeting "tomorrow 11/06", keys to return "today 11/06",
 * terminated "effective 11/06/2026") and asked for an exit form. The card said How Employee Resigned "Text
 * message" (the text that caused the termination), Salon Key Returned "Salon key was returned" (an instruction to
 * return them), and Last Day Worked "November 5, 2026" (the final paycheck's "all hours worked through
 * 11/05/2026"), and its Job Title was "Salon Director" — the letter's "your Salon Director". EXIT_STATED_ONLY_ENABLED: an Exit field only from what the manager said happened. The manager's
 * words; every person invented (checked against both apps' directories).
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

const INVENTED = [
  [/\*\*How Employee Resigned:\*\*\s*Text message/i, "How Employee Resigned: Text message"],
  [/\*\*Salon Key Returned:\*\*\s*Salon key was returned/i, "Salon Key Returned: returned"],
  [/\*\*Last Day Worked:\*\*\s*November 5, 2026/i, "Last Day Worked: November 5"],
  // The Salon Director is the letter's other person ("your Salon Director, Philippa"); the employee is a Tanning Consultant on Woven.
  [/\*\*Job Title:\*\*\s*Salon Director/i, "Job Title: Salon Director"],
] as const;

export const NOV5_EXIT_TERMINATION_PASTE_CASES: ReplayCase[] = [
  {
    id: "nov5-exit-termination-paste-no-invented-facts",
    title: "a termination letter, then \"I need an exit form with this information. …\", then \"For Dorran Ashby\": the exit card never says the employee resigned by text, returned the key, or last worked on 11/05",
    report: "QA, 5 Nov 2026 (severe, this app's production): an Exit card from a termination paste with invented facts",
    // Changed on purpose (8 Nov 2026): fixed in production by EXIT_STATED_ONLY_ENABLED, QA round 5, 8 Nov 2026; it now holds with production's flags.
    status: "fixed",
    fixFlags: ["EXIT_STATED_ONLY_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-05T20:28:00Z"));
      t.directory([...STAFF, DORRAN]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say(LETTER);
      await thread.say(`I need an exit form with this information. ${LETTER}`);
      const reply = await thread.say("For Dorran Ashby");
      for (const [pattern, what] of INVENTED) expect(reply.content, `the card states "${what}", which the manager never said happened:\n${reply.content}`).not.toMatch(pattern);
      expect(reply.content, `Job Title is not left for the manager to fill:\n${reply.content}`).toMatch(/\*\*Left blank for you to review:\*\*[^\n]*\bJob Title\b/);
    },
  },
];
