import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayAnswer, type ReplayCase } from "./cases";

/**
 * QA, 6 Nov 2026, after the Sunny flip: the real history wording "Not meeting sales requirements for
 * the month of October" got a Corrective Action with no policy ("check the applicable company
 * policy"), while "sales performance", MSB and the metric wordings cite the Standards of Conduct.
 * SALES_SHORTFALL_OBJECT_ENABLED reads "sales" governed by a shortfall verb as a named metric
 * (`forms/metric-shortfall.ts`). The person is invented.
 */
const ODALYS: DirectoryRow = { id: "e-odalys-fenmarrow", firstName: "Odalys", lastName: "Fenmarrow", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

/** The invented person of this file (a function: the registry reads exported arrays as cases). */
export function salesShortfallObjectPeople(): readonly DirectoryRow[] {
  return [ODALYS];
}

function policyLine(reply: ReplayAnswer): string {
  return reply.content.split("\n").find((line) => /\*\*Policy:?\*\*/i.test(line)) ?? "";
}

export const NOV6_SALES_SHORTFALL_OBJECT_CASES: ReplayCase[] = [
  {
    id: "nov6-sales-shortfall-object-requirements",
    title: "\"Not meeting sales requirements for the month of October\": the CA card and the draft cite the Standards of Conduct",
    report: "QA, 6 Nov 2026 (tester batch 1 after the Sunny flip): a sales-requirements CA with no policy",
    status: { open: "with production's flags (SALES_SHORTFALL_OBJECT_ENABLED off) the card cites no policy (\"check the applicable company policy\")" },
    fixFlags: ["CA_SALES_POLICY_ENABLED", "SALES_SHORTFALL_OBJECT_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-06T15:00:00Z"));
      t.directory([...STAFF, ODALYS]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("I need a verbal corrective action for Odalys Fenmarrow. Not meeting sales requirements for the month of October");
      expect(thread.proposal, `no CA card for Odalys Fenmarrow:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Odalys Fenmarrow" });
      expect(policyLine(reply), `the card does not cite Standards of Conduct:\n${reply.content}`).toMatch(/standards of conduct/i);
      // The model ticks no box: the reader alone settles the Standards of Conduct.
      t.draftWrites({ observation: "Observed:\nOdalys Fenmarrow did not meet her sales requirements for October." }, {});
      const id = await thread.create();
      const values = t.values(id);
      expect(values.policy_violated ?? "", "Policy Violated is not Standards of Conduct").toMatch(/standards of conduct/i);
      expect(values.policy_language ?? "", "Direct policy has no Standards of Conduct page").toMatch(/standards of conduct[^\n]*\bp(?:age|\.)\s*\d+/i);
    },
  },
  {
    id: "nov6-sales-shortfall-object-floor-negative",
    title: "negative: \"she was missing from the sales floor for an hour\" is no sales shortfall: the card does not cite it as one",
    report: "QA, 6 Nov 2026 (SALES_SHORTFALL_OBJECT's condition): absent from the floor is not short on sales",
    status: "fixed",
    fixFlags: ["CA_SALES_POLICY_ENABLED", "SALES_SHORTFALL_OBJECT_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-06T15:00:00Z"));
      t.directory([...STAFF, ODALYS]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("create a corrective action for Odalys Fenmarrow, she was missing from the sales floor for an hour");
      expect(reply.content, `read as a sales shortfall:\n${reply.content}`).not.toMatch(/sales (?:performance|shortfall)/i);
    },
  },
];
