import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A LATER CORRECTION OR PASTED POLICY IS NOT THE OBSERVATION (QA's October triage of #257, 10 Nov 2026)
 * ============================================================================
 *
 * On main f337302d with production's flags, "create a ca for <name>. on 10-21-26 <first> opened the salon 20 minutes
 * late." then "not attendance, late opening", or the pasted Late Opening paragraph ("… The employee who failed to open
 * will then be required to reimburse The Company $25"), was appended to the card's Observation of Offense. Fixed with
 * INCIDENT_SPLIT_FIX_ENABLED (`ai/observation-turns.ts`). "Policy violated: Standards of Conduct" is already kept out on
 * main; its case guards that. The person is on the pack's STAFF list (invented).
 */
const REQUEST = "create a ca for remy calder. on 10-21-26 remy opened the salon 20 minutes late.";
const PASTED =
  "When an employee assigned to open a location is unable to open the location at the proper time, the employee must notify the manager. The employee who failed to open will then be required to reimburse The Company $25";

async function observationAfter(t: ReplayContext, later: string): Promise<{ observation: string; content: string }> {
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  await thread.say(REQUEST);
  const reply = await thread.say(later);
  return { observation: /\*\*Observation of Offense:\*\*\s*(.+)/.exec(reply.content)?.[1] ?? "", content: reply.content };
}

export const NOV10_INCIDENT_SPLIT_FIX_CASES: ReplayCase[] = [
  {
    id: "nov10-incident-split-fix-correction",
    title: '"create a ca for <employee>. on 10-21-26 … opened the salon 20 minutes late." → "not attendance, late opening": the Observation is the request\'s account only',
    report: "QA's October triage (10 Nov 2026) of #257, on main f337302d with production's flags",
    status: { open: 'Observation: "on 10-21-26 remy opened the salon 20 minutes late. not attendance, late opening"; fixed with INCIDENT_SPLIT_FIX_ENABLED' },
    fixFlags: ["INCIDENT_SPLIT_FIX_ENABLED"],
    async run(t) {
      const { observation, content } = await observationAfter(t, "not attendance, late opening");
      expect(observation, content).toMatch(/opened the salon 20 minutes late/i);
      expect(observation, `the correction was added to the Observation:\n${content}`).not.toMatch(/not attendance/i);
    },
  },
  {
    id: "nov10-incident-split-fix-pasted-policy",
    title: '"create a ca for <employee>. …" → the pasted Late Opening paragraph ("… reimburse The Company $25"): the Observation holds no policy text',
    report: "QA's October triage (10 Nov 2026) of #257, on main f337302d with production's flags",
    status: { open: "the pasted Late Opening paragraph is appended to the Observation; fixed with INCIDENT_SPLIT_FIX_ENABLED" },
    fixFlags: ["INCIDENT_SPLIT_FIX_ENABLED"],
    async run(t) {
      const { observation, content } = await observationAfter(t, PASTED);
      expect(observation, content).toMatch(/opened the salon 20 minutes late/i);
      expect(observation, `the pasted policy was added to the Observation:\n${content}`).not.toMatch(/reimburse|The Company|failed to open/i);
    },
  },
  {
    id: "nov10-incident-split-fix-policy-violated",
    title: '"create a ca for <employee>. …" → "Policy violated: Standards of Conduct": the Observation holds no policy line (fixed on main; guard)',
    report: "QA's October triage (10 Nov 2026) of #257: already kept out on main f337302d with production's flags",
    status: "fixed",
    fixFlags: ["INCIDENT_SPLIT_FIX_ENABLED"],
    async run(t) {
      const { observation, content } = await observationAfter(t, "Policy violated: Standards of Conduct");
      expect(observation, content).toMatch(/opened the salon 20 minutes late/i);
      expect(observation, `the policy line was added to the Observation:\n${content}`).not.toMatch(/policy violated|standards of conduct/i);
    },
  },
];
