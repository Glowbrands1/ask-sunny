import { expect, vi } from "vitest";

import { CA_CHOSEN_LINE, SALES_RESULTS_OFFENSE_LINE } from "@/lib/ai/ca-sales-prompt-lines";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * CA_SALES_POLICY_ENABLED: THE DRAFT'S TWO ADDED LINES (QA's prompt audit and
 * Pau's "go", 5 Nov 2026)
 * ============================================================================
 *
 * The Corrective Action draft's prompt, read from the route: with production's
 * flags it is as before (neither line); with CA_SALES_POLICY_ENABLED on, "Sales
 * and performance results are standards_of_conduct." is added on a form with no
 * under_performance box, and "When the manager has already chosen a Corrective
 * Action, do not recommend coaching instead." follows the lowest-rung rule. The
 * chat's added exception line is tested in src/lib/ai/ca-sales-prompt-lines.test.ts
 * (the pack does not expose the chat prompt). The person is invented.
 */

const TAMSIN: DirectoryRow = {
  id: "e-tamsin-vale",
  firstName: "Tamsin",
  lastName: "Vale",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

/** The invented person of this file (a function: the registry reads exported arrays as cases). */
export function caSalesPromptLinesPeople(): readonly DirectoryRow[] {
  return [TAMSIN];
}

const REPORT = "QA's prompt audit and Pau's \"go\", 5 Nov 2026 (CA_SALES_POLICY_ENABLED prompt lines)";

/** A Corrective Action drafted for Tamsin: the draft's system prompt. */
async function draftPrompt(t: ReplayContext): Promise<string> {
  vi.setSystemTime(new Date("2026-11-05T15:00:00Z"));
  t.directory([...STAFF, TAMSIN]);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  const reply = await thread.say("create a ca for tamsin vale at kearney. she was late to her shift on 11-4-26. verbal. no payroll deduct");
  expect(thread.proposal, `no Corrective Action card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa" });
  t.draftWrites({ observation: "Observed:\nTamsin Vale arrived late to her shift on November 4, 2026." });
  await thread.create();
  const prompts = t.draftSystems?.() ?? [];
  expect(prompts.length, "no draft was written").toBeGreaterThan(0);
  return prompts[prompts.length - 1]!;
}

export const NOV5_CA_SALES_PROMPT_LINES_CASES: ReplayCase[] = [
  {
    id: "nov5-ca-sales-prompt-lines-off-unchanged",
    title: "flag off: the Corrective Action draft's prompt has neither added line, and the lowest-rung rule is as before",
    report: `${REPORT}, flag off`,
    status: "fixed",
    async run(t) {
      const prompt = await draftPrompt(t);
      expect(prompt, "the sales results line with the flag off").not.toContain(SALES_RESULTS_OFFENSE_LINE);
      expect(prompt, "the Corrective Action line with the flag off").not.toContain(CA_CHOSEN_LINE);
      expect(prompt, "the lowest-rung rule is missing").toMatch(/choose the LOWEST rung that fits\./);
    },
  },
  {
    id: "nov5-ca-sales-prompt-lines-on",
    title: "flag on: \"When the manager has already chosen a Corrective Action, do not recommend coaching instead.\" follows the lowest-rung rule in the draft's prompt",
    report: `${REPORT}, flag on`,
    status: { open: "with production's flags (CA_SALES_POLICY_ENABLED off) the draft's prompt does not have the line" },
    fixFlags: ["CA_SALES_POLICY_ENABLED"],
    async run(t) {
      const prompt = await draftPrompt(t);
      // The pack's Corrective Action template reaches none of the draft's Type of Offense lines (the
      // existing CA_SALES line included), so the sales results line is proved where it is reached:
      // src/app/api/forms/corrective-action-dm-feedback-e2e.test.ts ("the Corrective Action draft's added lines").
      expect(prompt, "the Corrective Action line is not right after the lowest-rung rule").toMatch(/choose the LOWEST rung that fits\.\s+When the manager has already chosen a Corrective Action, do not recommend coaching instead\./);
    },
  },
];
