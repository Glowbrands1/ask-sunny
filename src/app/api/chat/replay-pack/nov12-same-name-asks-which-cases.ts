import { expect, vi } from "vitest";

import { STAFF, KEARNEY, TWO_SALONS, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * TWO PEOPLE WITH ONE NAME ARE A CHOICE (QA, 12 Nov 2026; high priority)
 * ============================================================================
 *
 * With TYPED_NAME_PROCEEDS on (live), two active roster people with the same
 * name were never asked about: "verbal CA for marnie holloway, she was late on
 * 11/1/26", with two Marnie Holloways at the salon (a Tanning Consultant and an
 * Assistant Salon Director), gave a ready card with the Tanning Consultant's
 * title and no employee id — the wrong person's title could go on a CA. Found
 * by bisecting intent-extraction.test.ts's "two people with one name are a
 * choice" under production's flags. SAME_NAME_ASKS_WHICH_ENABLED asks
 * "Which person did you mean…?", and the numbered reply selects that person.
 * The second Marnie Holloway is invented, as the first is.
 */

const SECOND_MARNIE: DirectoryRow = {
  id: "e-90",
  firstName: "Marnie",
  lastName: "Holloway",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Assistant Salon Director",
};

const SAID = "verbal CA for marnie holloway, she was late on 11/1/26";

function start(t: Parameters<ReplayCase["run"]>[0]) {
  vi.setSystemTime(new Date("2026-11-03T15:00:00Z"));
  t.directory([...STAFF, SECOND_MARNIE]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV12_SAME_NAME_ASKS_WHICH_CASES: ReplayCase[] = [
  {
    id: "nov12-same-name-asks-which",
    title: `"${SAID}" with two Marnie Holloways: "Which person / Did you mean…?", never one of them's title silently`,
    report: "QA, 12 Nov 2026: two roster people with one name are resolved to neither, and the card carries one of them's title",
    // Changed on purpose (13 Nov 2026): fixed in production by SAME_NAME_ASKS_WHICH_ENABLED, QA round 38b. Was OPEN.
    status: "fixed",
    fixFlags: ["SAME_NAME_ASKS_WHICH_ENABLED"],
    async run(t) {
      const thread = start(t);
      const reply = await thread.say(SAID);
      expect(reply.content, `nothing asked which Marnie Holloway:\n${reply.content}`).toMatch(/(?:Which person did you mean|Did you mean)[\s\S]*Marnie Holloway/);
      expect(reply.content, `the choice does not show both titles:\n${reply.content}`).toMatch(/Tanning Consultant[\s\S]*Assistant Salon Director|Assistant Salon Director[\s\S]*Tanning Consultant/);
      expect(reply.content, `a job title was chosen without asking:\n${reply.content}`).not.toMatch(/\*\*Job title:\*\*/i);
    },
  },
  {
    id: "nov12-same-name-numbered-reply-selects",
    title: `"${SAID}" with two Marnie Holloways, then the number of the Assistant Salon Director: that person's card`,
    report: "QA, 12 Nov 2026: the numbered reply to the same-name choice selects that person",
    // Changed on purpose (13 Nov 2026): fixed in production by SAME_NAME_ASKS_WHICH_ENABLED, QA round 38b. Was OPEN.
    status: "fixed",
    fixFlags: ["SAME_NAME_ASKS_WHICH_ENABLED"],
    async run(t) {
      const thread = start(t);
      const asked = await thread.say(SAID);
      const choice = /(\d+)\.\s*\*\*Marnie Holloway\*\*\s*\([^)]*Assistant Salon Director\)/.exec(asked.content);
      expect(choice, `no numbered choice for the Assistant Salon Director:\n${asked.content}`).toBeTruthy();
      const number = choice![1]!;
      const reply = await thread.say(number);
      expect(reply.content, `asked again after the number:\n${reply.content}`).not.toMatch(/Which person did you mean|Did you mean/);
      expect(thread.proposal, "no card for Marnie Holloway").toMatchObject({ employeeName: "Marnie Holloway", employeeRole: "Assistant Salon Director" });
    },
  },
  {
    id: "nov12-same-name-title-reply-selects",
    title: `"${SAID}" with two Marnie Holloways, then "the assistant salon director": that person's card`,
    report: "QA, 12 Nov 2026: the job-title reply to the same-name choice selects that person by identity, never by name",
    // Changed on purpose (13 Nov 2026): fixed in production by SAME_NAME_ASKS_WHICH_ENABLED, QA round 38b. Was OPEN.
    status: "fixed",
    fixFlags: ["SAME_NAME_ASKS_WHICH_ENABLED"],
    async run(t) {
      const thread = start(t);
      const asked = await thread.say(SAID);
      expect(asked.content, `nothing asked which Marnie Holloway:\n${asked.content}`).toMatch(/Did you mean|Which person did you mean/);
      const reply = await thread.say("the assistant salon director");
      expect(reply.content, `asked again after the title:\n${reply.content}`).not.toMatch(/Which person did you mean|Did you mean/);
      expect(thread.proposal, "not the Assistant Salon Director's card").toMatchObject({ employeeName: "Marnie Holloway", employeeRole: "Assistant Salon Director" });
    },
  },
  {
    id: "nov12-same-name-salon-reply-selects",
    title: `two Tanning Consultants named Marnie Holloway at two salons, then the other salon's name: that person's card`,
    report: "QA, 12 Nov 2026: the salon reply to the same-name choice selects that person by identity, never by name",
    // Changed on purpose (13 Nov 2026): fixed in production by SAME_NAME_ASKS_WHICH_ENABLED, QA round 38b. Was OPEN.
    status: "fixed",
    fixFlags: ["SAME_NAME_ASKS_WHICH_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-03T15:00:00Z"));
      const other: DirectoryRow = { ...SECOND_MARNIE, id: "e-91", salonIds: ["loc-0307"], positionName: "Tanning Consultant" };
      t.directory([...STAFF, other]);
      t.as("salon_director", TWO_SALONS);
      const thread = t.thread();
      const asked = await thread.say(SAID);
      expect(asked.content, `nothing asked which Marnie Holloway:\n${asked.content}`).toMatch(/Did you mean|Which person did you mean/);
      const labels = [...asked.content.matchAll(/\d+\.\s*\*\*Marnie Holloway\*\*\s*\(([^,)]+)/g)].map((match) => match[1]!.trim());
      expect(new Set(labels).size, `the choice does not name two salons:\n${asked.content}`).toBe(2);
      const otherSalon = labels.find((label) => !/Kearney/i.test(label));
      expect(otherSalon, `no salon other than Kearney:\n${asked.content}`).toBeTruthy();
      const reply = await thread.say(otherSalon!);
      expect(reply.content, `asked again after the salon:\n${reply.content}`).not.toMatch(/Which person did you mean|Did you mean/);
      expect(thread.proposal, "not the card of the Marnie Holloway at that salon").toMatchObject({ employeeName: "Marnie Holloway", locationId: "loc-0307" });
    },
  },
];
