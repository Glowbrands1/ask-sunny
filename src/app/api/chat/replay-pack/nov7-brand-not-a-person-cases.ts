import { expect, vi } from "vitest";

import { ACTIVE_BRAND } from "@/lib/brand";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * THE COMPANY'S OWN NAME IS NEVER A PERSON (QA, 7 Nov 2026, before the Sunny gate
 * rerun 2; FORM_NAME_FROM_ROSTER_ENABLED)
 * ============================================================================
 *
 * With the name flags on, the termination letter's "… and it is a requirement for STC." made turn 2 read "I couldn't
 * find **STC** in the Woven roster, so that name is not on the form." — the company's own abbreviation said back as a
 * person not found. The company's names and their initials (from the brand config, `lib/brand`) are never a person:
 * no not-found note, no offer. The letter is the original case's; every person is invented.
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

/** The company's own name, or its initials, said back or offered as a person. */
function namesTheCompany(content: string): string | null {
  const initials = ACTIVE_BRAND.brandName.split(/\s+/).map((word) => word[0]).join("");
  for (const name of [ACTIVE_BRAND.brandName, initials]) {
    if (content.includes(`couldn't find **${name}**`) || content.includes(`reply **use ${name}**`) || content.includes(`Is this for **${name}**?`)) return name;
  }
  return null;
}

export const NOV7_BRAND_NOT_A_PERSON_CASES: ReplayCase[] = [
  {
    id: "nov7-brand-not-a-person-termination-letter",
    title: "a termination letter (\"… it is a requirement for STC.\"), then \"I need an exit form with this information. …\": the company's abbreviation is never said back as a person not found",
    report: "QA, 7 Nov 2026 (the one-who-question port's record, name flags on): \"I couldn't find **STC** in the Woven roster\"",
    status: "fixed",
    fixFlags: [...NAME_SET, "EXIT_STATED_ONLY_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-05T20:28:00Z"));
      t.directory([...STAFF, DORRAN]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      for (const turn of [LETTER, `I need an exit form with this information. ${LETTER}`]) {
        const reply = await thread.say(turn);
        expect(namesTheCompany(reply.content), `the company is said back as a person:\n${reply.content}`).toBeNull();
      }
    },
  },
];
