import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayAnswer, type ReplayCase, type ReplayContext } from "./cases";

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
  ...(
    [
      ["h01", "H01", ["written CA for Odalys Fenmarrow on performance"]],
      ["h13", "H13 (turn 1)", ["CA for Odalys Fenmarrow for performance for october"]],
    ] as const
  ).map(
    ([key, row, turns]): ReplayCase => ({
      id: `nov6-sales-shortfall-object-performance-${key}`,
      title: `${row}: "${turns.at(-1)}": the card cites the Standards of Conduct and does not ask what happened`,
      report: `QA, 6 Nov 2026 (tester batch 2 after the Sunny flip, ${row}, paraphrased): "performance" as the reason got no policy and "You haven't told me what happened yet"`,
      status: { open: "with production's flags (SALES_SHORTFALL_OBJECT_ENABLED off) the card cites no policy and asks what happened" },
      fixFlags: ["CA_SALES_POLICY_ENABLED", "SALES_SHORTFALL_OBJECT_ENABLED"],
      async run(t) {
        await performanceCase(t, turns);
      },
    }),
  ),
  {
    id: "nov6-sales-shortfall-object-count-h18",
    title: "H18 (turn 2): \"<name> 131 tans verbal\": the card cites the Standards of Conduct and does not ask what happened",
    report: "QA, 6 Nov 2026 (tester batch 2 after the Sunny flip, H18, paraphrased): a metric count as the reason got \"You haven't told me what happened yet\"",
    status: { open: "with production's flags (SALES_SHORTFALL_OBJECT_ENABLED off) no reader knows \"tans\" as a metric: the card cites no policy and asks what happened" },
    // Fixed with the flag (Pau, 6 Nov 2026): the "Tans" glossary line, and a number with a glossary count term is the metric named and counted.
    fixFlags: ["CA_SALES_POLICY_ENABLED", "SALES_SHORTFALL_OBJECT_ENABLED"],
    async run(t) {
      await performanceCase(t, ["create a corrective action", "Odalys Fenmarrow 131 tans verbal"]);
    },
  },
];

async function performanceCase(t: ReplayContext, turns: readonly string[]) {
  vi.setSystemTime(new Date("2026-11-06T15:00:00Z"));
  t.directory([...STAFF, ODALYS]);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  let reply: ReplayAnswer | null = null;
  for (const turn of turns) reply = await thread.say(turn);
  expect(thread.proposal, `no CA card for Odalys Fenmarrow:\n${reply!.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Odalys Fenmarrow" });
  expect(policyLine(reply!), `the card does not cite Standards of Conduct:\n${reply!.content}`).toMatch(/standards of conduct/i);
  expect(reply!.content, "the card asks what happened though a reason was given").not.toMatch(/haven['’]t told me what happened/i);
}
