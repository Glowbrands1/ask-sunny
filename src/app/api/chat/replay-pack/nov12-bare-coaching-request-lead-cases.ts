import { expect } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "CREATE A COACHING FOR <A>, …" IS THE REQUEST, NEVER THE ACCOUNT (QA, Sunny round 31 live, 11 Nov 2026)
 * ============================================================================
 *
 * The tester's wording, the person invented: the card's Observation of Offense began "create a coaching for <A>, she
 * told a client …". BARE_COACHING_REQUEST_LEAD_ENABLED: "coaching" followed by "for" is the request's form word.
 */
const FLAG = "BARE_COACHING_REQUEST_LEAD_ENABLED";
const BRISA: DirectoryRow = { id: "e-bcr-brisa-tolland", firstName: "Brisa", lastName: "Tolland", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const SAID =
  "create a coaching for Brisa Tolland, she told a client she wouldn't update their info and said our job is to serve clients not chase EFTs. how do i talk to her about her frustration? tell me what to say back.";

export const NOV12_BARE_COACHING_REQUEST_LEAD_CASES: ReplayCase[] = [
  {
    id: "nov12-r31-bare-coaching-request-lead",
    title: "\"create a coaching for Brisa Tolland, she told a client …\": the Observation starts at \"she told a client\"",
    report: "QA, Sunny round 31 live (11 Nov 2026): the card's Observation began with the request words",
    status: { open: "the Observation of Offense begins \"create a coaching for Brisa Tolland, …\"" },
    fixFlags: [FLAG],
    async run(t) {
      t.directory([...STAFF, BRISA]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say(SAID);
      expect(thread.proposal, `no Coaching card:\n${reply.content}`).toMatchObject({ templateKey: "coaching", employeeName: "Brisa Tolland" });
      const observation = reply.content.split("\n").find((line) => /\*\*Observation[^*]*:\*\*/.test(line)) ?? "";
      expect(observation, `the request words are in the Observation:\n${reply.content}`).not.toMatch(/create a coaching/i);
      expect(observation, `the account is not in the Observation:\n${reply.content}`).toMatch(/\*\*\s*she told a client/i);
      t.draftWrites({});
      const id = await thread.create();
      const saved = Object.values(t.values(id)).join("\n");
      expect(saved, `the request words are on the draft:\n${saved}`).not.toMatch(/create a coaching for/i);
    },
  },
];
