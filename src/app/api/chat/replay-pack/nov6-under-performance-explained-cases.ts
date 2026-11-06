import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * UNDER_PERFORMANCE_EXPLAINED_ENABLED (Pau, 6 Nov 2026; QA, Sunny tester after the flip): a manager
 * who asks for Under Performance on a Corrective Action, and gets a card citing the Standards of
 * Conduct, is told why. The tester: "it should be under performance not standard of conduct". The
 * person is invented and not on either directory.
 */
const ODALYS: DirectoryRow = { id: "e-odalys-fenmarrow-up", firstName: "Odalys", lastName: "Fenmarrow", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

/** The invented person of this file (a function: the registry reads exported arrays as cases). */
export function underPerformanceExplainedPeople(): readonly DirectoryRow[] {
  return [ODALYS];
}

const EXPLAINED = "Under Performance isn't on the CA form. Sales performance CAs use the Standards of Conduct.";
const REPORT = "QA, 6 Nov 2026 (Sunny tester after the flip; Pau's line): Under Performance asked for, the Standards of Conduct cited, and no word why";

const SHAPES: { key: string; turns: string[] }[] = [
  { key: "tester", turns: ["CA for Odalys Fenmarrow, her sales are low", "it should be under performance not standard of conduct"] },
  { key: "asked-at-once", turns: ["CA for Odalys Fenmarrow for under performance for october"] },
];

export const NOV6_UNDER_PERFORMANCE_EXPLAINED_CASES: ReplayCase[] = [
  ...SHAPES.map(
    ({ key, turns }): ReplayCase => ({
      id: `nov6-under-performance-explained-${key}`,
      title: `"${turns.at(-1)}": the card cites the Standards of Conduct and the reply says why, once`,
      report: REPORT,
      status: { open: "with production's flags (UNDER_PERFORMANCE_EXPLAINED_ENABLED off) the reply cites the Standards of Conduct with no word why" },
      fixFlags: ["CA_SALES_POLICY_ENABLED", "UNDER_PERFORMANCE_EXPLAINED_ENABLED"],
      async run(t) {
        vi.setSystemTime(new Date("2026-11-06T15:00:00Z"));
        t.directory([...STAFF, ODALYS]);
        t.as("salon_director", KEARNEY);
        const thread = t.thread();
        let content = "";
        for (const turn of turns) content = (await thread.say(turn)).content;
        expect(content, "the card does not cite the Standards of Conduct").toMatch(/\*\*Policy:\*\* Standards of Conduct/);
        expect(content.split(EXPLAINED).length - 1, `the reason is not said exactly once:\n${content}`).toBe(1);
      },
    }),
  ),
  {
    id: "nov6-under-performance-explained-negative",
    title: "negative: a sales CA that never says Under Performance gets no explanation",
    report: REPORT,
    status: "fixed",
    fixFlags: ["CA_SALES_POLICY_ENABLED", "UNDER_PERFORMANCE_EXPLAINED_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-06T15:00:00Z"));
      t.directory([...STAFF, ODALYS]);
      t.as("salon_director", KEARNEY);
      const reply = await t.thread().say("CA for Odalys Fenmarrow, her sales are low");
      expect(reply.content).not.toContain(EXPLAINED);
    },
  },
  {
    id: "nov6-under-performance-explained-one-word",
    title: "\"CA for <name> for underperformance for october\" (one word): the card cites the Standards of Conduct and says why",
    report: `${REPORT}; found while adding the line (6 Nov 2026): the one-word spelling gets no Policy line on the card`,
    status: { open: "with production's flags the card has no Policy line for one-word \"underperformance\"" },
    fixFlags: ["CA_SALES_POLICY_ENABLED", "UNDER_PERFORMANCE_EXPLAINED_ENABLED"],
    // Still open with the fix flags: the card's own reading misses the one-word spelling though `readCaPolicy` reads it (QA, separate item).
    fixStatus: { open: "the card path gives no Policy line for one-word \"underperformance\" (root cause not yet found)" },
    async run(t) {
      vi.setSystemTime(new Date("2026-11-06T15:00:00Z"));
      t.directory([...STAFF, ODALYS]);
      t.as("salon_director", KEARNEY);
      const content = (await t.thread().say("CA for Odalys Fenmarrow for underperformance for october")).content;
      expect(content, "the card does not cite the Standards of Conduct").toMatch(/\*\*Policy:\*\* Standards of Conduct/);
      expect(content).toContain(EXPLAINED);
    },
  },
];
