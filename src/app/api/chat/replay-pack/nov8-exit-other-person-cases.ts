import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * THE LETTER'S OTHER PERSON IS NEVER OFFERED AS THE EXIT FORM'S SUBJECT (QA's Sunny round-5 live tester, 8 Nov 2026,
 * item 4b; pre-existing; EXIT_OTHER_PERSON_NOT_SUBJECT_ENABLED)
 * ============================================================================
 *
 * The letter of nov5-exit-termination-paste (the people invented): "I need an exit form with this information. …"
 * was answered "Which of them is this **Resignation/Exit Form** for — **Philippa** or **Dorran**?" with "**Job title:**
 * Salon Director": the letter's "your Salon Director, Philippa" offered as the subject, and her title echoed.
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

const FIX = ["EXIT_OTHER_PERSON_NOT_SUBJECT_ENABLED"];
const REPORT = "QA's Sunny round-5 live tester, 8 Nov 2026 (item 4b): the letter's Salon Director offered as the exit form's subject";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-05T20:28:00Z"));
  t.directory([...STAFF, DORRAN]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV8_EXIT_OTHER_PERSON_CASES: ReplayCase[] = [
  {
    id: "nov8-exit-other-person-not-offered",
    title: "a termination letter naming \"your Salon Director, Philippa\": the exit form's question never offers Philippa, nor echoes her title",
    report: REPORT,
    // Changed on purpose (8 Nov 2026): fixed in production by EXIT_OTHER_PERSON_NOT_SUBJECT_ENABLED, QA round 6, 8 Nov 2026; it now holds with production's flags.
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      await thread.say(LETTER);
      const { content } = await thread.say(`I need an exit form with this information. ${LETTER}`);
      expect(content, `the letter's other person is offered:\n${content}`).not.toMatch(/\*\*Philippa\*\*/);
      expect(content, `her title is echoed as the employee's:\n${content}`).not.toMatch(/\*\*Job title:\*\*\s*Salon Director/i);
      expect(content, `the form's person is not asked for:\n${content}`).toMatch(/Who is this \*\*Resignation\/Exit Form\*\* for\?|\*\*Dorran/);
      const reply = await thread.say("For Dorran Ashby");
      expect(thread.proposal?.employeeName, `the card is for someone else:\n${reply.content}`).toBe("Dorran Ashby");
    },
  },
  {
    id: "nov8-exit-other-person-two-real-candidates",
    title: "must not change: two people named plainly are both offered",
    report: REPORT,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      const { content } = await thread.say("I need an exit form. Dorran and Rowan both quit yesterday with no notice.");
      if (/Which of them/.test(content)) expect(content, `a plain candidate is dropped:\n${content}`).toMatch(/\*\*Dorran\*\*[\s\S]*\*\*Rowan\*\*|\*\*Rowan\*\*[\s\S]*\*\*Dorran\*\*/);
    },
  },
];
