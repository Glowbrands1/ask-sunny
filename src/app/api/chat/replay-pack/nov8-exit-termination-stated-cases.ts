import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * A TERMINATION LETTER'S STATED FACTS FILL THE EXIT CARD (QA's Sunny round-5 live tester, 8 Nov 2026, item 4;
 * EXIT_TERMINATION_STATED_ENABLED)
 * ============================================================================
 *
 * The letter of nov5-exit-termination-paste (the people invented). With round 5's EXIT_STATED_ONLY the card invented
 * nothing, but it also left blank what the letter states: the separation ("your employment … is terminated, effective
 * 11/06/2026") and its reason ("This decision follows the text message …"). QA's ruling (8 Nov 2026): only an explicit
 * "last day (worked)" is a last day ("all hours worked through 11/05/2026" is a pay line), and keys and property "to
 * return today" are not returned.
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

const FIX = ["EXIT_STATED_ONLY_ENABLED", "EXIT_TERMINATION_STATED_ENABLED"];

/** The card's line for a field, or "". */
const line = (content: string, label: string) => content.split("\n").find((text) => text.includes(`**${label}:**`)) ?? "";
const blank = (content: string) => content.split("\n").find((text) => text.startsWith("**Left blank for you to review:**")) ?? "";

export const NOV8_EXIT_TERMINATION_STATED_CASES: ReplayCase[] = [
  {
    id: "nov8-exit-termination-stated-facts",
    title: "a termination letter for an exit form: the separation, its date and its stated reason are filled; no last day, keys or items are invented",
    report: "QA's Sunny round-5 live tester, 8 Nov 2026 (item 4): EXIT_STATED_ONLY left the letter's stated facts blank",
    // EXIT_STATED_ONLY is live with QA's round 5 (#684); production's flags here are before it.
    status: { open: "the card leaves the Resignation Details, Resignation Date and Reason blank (or, before round 5, invents a resignation by text)" },
    fixFlags: FIX,
    async run(t) {
      vi.setSystemTime(new Date("2026-11-05T20:28:00Z"));
      t.directory([...STAFF, DORRAN]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say(LETTER);
      await thread.say(`I need an exit form with this information. ${LETTER}`);
      const { content } = await thread.say("For Dorran Ashby");
      expect(line(content, "Resignation Details"), `the termination is not ticked:\n${content}`).toMatch(/Immediate involuntary separation/);
      expect(line(content, "Resignation Date"), `the effective date is not the Resignation Date:\n${content}`).toMatch(/November 6, 2026/);
      expect(line(content, "Reason for Resignation"), `the stated reason is missing:\n${content}`).toMatch(/text message the employee sent/i);
      // QA's round-6 follow-up (8 Nov 2026): the form speaks about the employee, not to them as the letter does.
      expect(line(content, "Reason for Resignation"), `the letter's "you" is copied onto the form:\n${content}`).not.toMatch(/\byou(?:r|rs|rself)?\b/i);
      // QA's ruling: "hours worked through 11/05" is a pay line; "return … today" is not a return.
      expect(blank(content), `a fact the letter does not state is filled:\n${content}`).toMatch(/Last Day Worked/);
      expect(blank(content), `the keys are said to be returned:\n${content}`).toMatch(/Salon Key Returned/);
      expect(blank(content), `the items are said to be returned:\n${content}`).toMatch(/Store Items Returned/);
      expect(content, `How Employee Resigned is invented:\n${content}`).not.toMatch(/\*\*How Employee Resigned:\*\*/);
      expect(content, `the Salon Director's title is the employee's:\n${content}`).not.toMatch(/\*\*Job Title:\*\*\s*Salon Director/i);
    },
  },
];
