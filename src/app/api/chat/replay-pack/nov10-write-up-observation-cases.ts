import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "WRITE UP <EMPLOYEE> FOR …": THE OBSERVATION IS THE ACCOUNT, NOT THE MESSAGE (QA's October triage of #167, 10 Nov
 * 2026; WRITE_UP_LEAD_NOT_ACCOUNT_ENABLED)
 * ============================================================================
 *
 * #167's wording, "write up Test Employee for cell phone use" (the person here is from the pack's STAFF list): with
 * production's flags the Corrective Action card's Observation of Offense was the whole message. It should be the
 * account, "cell phone use", without "write up" and the employee's name. #167's warning-level and prior-date parts hold
 * on main already and are not checked here.
 */
export const NOV10_WRITE_UP_OBSERVATION_CASES: ReplayCase[] = [
  {
    id: "nov10-write-up-observation-167",
    title: "\"write up Marnie Holloway for cell phone use\": the Observation is \"cell phone use\", not the message",
    report: "#167 (QA's October triage, 10 Nov 2026): \"write up <employee> for cell phone use\" gave the Observation of Offense \"write up <employee> for cell phone use\"",
    status: { open: "Observation of Offense: \"write up Marnie Holloway for cell phone use\"" },
    fixFlags: ["WRITE_UP_LEAD_NOT_ACCOUNT_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("write up Marnie Holloway for cell phone use");
      expect(reply.formProposal, `no Corrective Action card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Marnie Holloway" });
      const observation = /\*\*Observation of Offense:\*\*\s*(.+)/.exec(reply.content)?.[1] ?? "";
      expect(observation, `the Observation is the request:\n${reply.content}`).not.toMatch(/\bwrite\s+up\b|\bMarnie\b|\bHolloway\b/i);
      expect(observation, `the Observation lost the account:\n${reply.content}`).toMatch(/^cell phone use\.?$/i);
    },
  },
];
