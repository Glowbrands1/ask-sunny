import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "I NEED ANOTHER CORRECTIVE ACTION FOR <P>, …" IS NOT THE OBSERVATION (QA, Sunny round 7c and 9 live, 9 Nov 2026)
 * ============================================================================
 *
 * QA's live checks (the person invented and on no directory): "I need another corrective action for <P>, his cash drawer
 * was short $20 on 11/3" gave "**Observation of Offense:** I need another corrective action for <P>, his cash drawer …",
 * where "create a corrective action for <P>, his cash drawer …" gave "his cash drawer …". ANOTHER_REQUEST_LEAD_ENABLED
 * (`ai/remap-incident.ts` requestLead).
 */
const CORWIN: DirectoryRow = {
  id: "e-corwin-ashgrove",
  firstName: "Corwin",
  lastName: "Ashgrove",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};
const T1 = "create a corrective action for Corwin Ashgrove, he was late opening the salon on 11/2";
const FIX = ["ANOTHER_REQUEST_LEAD_ENABLED"];
const REPORT = "QA, Sunny round 7c and 9 live (9 Nov 2026): the whole \"I need another corrective action for <P>, …\" as the Observation";
const observation = (content: string) => /\*\*Observation of Offense:\*\*\s*([^\n]*)/.exec(content)?.[1] ?? "";

export const NOV9_ANOTHER_REQUEST_LEAD_CASES: ReplayCase[] = [
  ...[
    ["after-late-opening", [T1, "I need another corrective action for Corwin Ashgrove, his cash drawer was short $20 on 11/3"], "his cash drawer was short $20 on 11/3"],
    ["alone", ["I need another corrective action for Corwin Ashgrove for his cash drawer being short $20 on 11/3"], "his cash drawer being short $20 on 11/3"],
  ].map(
    ([id, turns, account]): ReplayCase => ({
      id: `nov9-another-request-lead-${id as string}`,
      title: `"${(turns as string[]).at(-1)}": the Observation is "${account as string}"`,
      report: REPORT,
      // Changed on purpose (9 Nov 2026): fixed in production by ANOTHER_REQUEST_LEAD_ENABLED, QA round 10, 9 Nov 2026; it now holds with production's flags.
      status: "fixed",
      fixFlags: FIX,
      async run(t) {
        vi.setSystemTime(new Date("2026-11-09T09:00:00Z"));
        t.directory([...STAFF, CORWIN]);
        t.as("salon_director", KEARNEY);
        const thread = t.thread();
        let reply = { content: "" };
        for (const turn of turns as string[]) reply = await thread.say(turn);
        expect(observation(reply.content), `the Observation:\n${reply.content}`).toBe(account);
      },
    }),
  ),
];
