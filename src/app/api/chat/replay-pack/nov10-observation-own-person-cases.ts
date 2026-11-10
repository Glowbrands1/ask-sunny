import { expect } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * THE OBSERVATION NEVER HOLDS THE REQUEST'S OTHER PEOPLE OR THE MANAGER'S COMMAND (QA's P7, Sunny live on the 13b chat
 * code, 10 Nov 2026; OBSERVATION_OWN_PERSON_ONLY_ENABLED)
 * ============================================================================
 *
 * "Make me a coaching form for <A>, <B>, and <C> for not closing duties correctly" (<A> a first name two people share)
 * → "Did you mean <A> <s1> or <A> <s2>?" → "create draft for failure to do closing duties and staying over hours" gave
 * ONE card whose Observation was "<B>, and <C> for not closing duties correctly create draft for failure to do closing
 * duties and staying over hours". This case checks the Observation only; the unanswered question, the unnamed employee
 * and the other two people are reported separately. The people are invented.
 */
const row = (id: string, firstName: string, lastName: string): DirectoryRow => ({ id, firstName, lastName, preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" });
const PEOPLE = [row("p7-tamsin-rookwood", "Tamsin", "Rookwood"), row("p7-tamsin-ashby", "Tamsin", "Ashby"), row("p7-corwin-halsey", "Corwin", "Halsey"), row("p7-ione-marchetti", "Ione", "Marchetti")];

export const NOV10_OBSERVATION_OWN_PERSON_CASES: ReplayCase[] = [
  {
    id: "nov10-observation-own-person-p7",
    title: "\"Make me a coaching form for Tamsin, Corwin, and Ione …\" → \"create draft for …\": the Observation holds neither Corwin, Ione nor \"create draft\"",
    report: "QA's P7, Sunny live (10 Nov 2026): the Observation was \"<B>, and <C> for not closing duties correctly create draft for failure to do closing duties and staying over hours\"",
    status: { open: "Observation: \"Corwin, and Ione for not closing duties correctly create draft for …\"" },
    fixFlags: ["OBSERVATION_OWN_PERSON_ONLY_ENABLED"],
    async run(t) {
      t.directory([...STAFF, ...PEOPLE]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("Make me a coaching form for Tamsin, Corwin, and Ione for not closing duties correctly");
      const reply = await thread.say("create draft for failure to do closing duties and staying over hours");
      const observation = /\*\*Observation of Offense:\*\*\s*(.+)/.exec(reply.content)?.[1] ?? "";
      expect(observation, `the Observation names the request's other people:\n${reply.content}`).not.toMatch(/\bCorwin\b|\bIone\b/);
      expect(observation, `the Observation holds the manager's command:\n${reply.content}`).not.toMatch(/\bcreate draft\b/i);
      expect(observation, `the Observation lost the account:\n${reply.content}`).toMatch(/closing duties/i);
    },
  },
];
