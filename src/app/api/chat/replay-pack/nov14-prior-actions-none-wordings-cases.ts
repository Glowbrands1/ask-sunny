import { expect, vi } from "vitest";

import { STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * PRIOR_ACTIONS_NONE_WORDINGS — A DRAFTED "N/A" OR "NO PRIOR CORRECTIVE ACTION" IS NOT A STATED HISTORY (QA, 14 Nov 2026)
 * ============================================================================
 *
 * Ported from the sibling app (Gate-Bubbles-3's #888 follow-up): with PRIOR_ACTIONS_UNSAID_BLANK on, only a drafted "None …" was taken out; "N/A" and
 * "No prior corrective action" were saved though the manager said nothing about history. Invented person.
 */
const FLAGS = ["PRIOR_ACTIONS_UNSAID_BLANK_ENABLED", "PRIOR_ACTIONS_NONE_WORDINGS_ENABLED"];
const REPORT = "Gate-Bubbles-3's #888 follow-up, QA (14 Nov 2026); invented person";

export const NOV14_PRIOR_ACTIONS_NONE_WORDINGS_CASES: ReplayCase[] = ["N/A", "No prior corrective action"].map((drafted) => ({
  id: `nov14-prior-actions-none-wordings-${drafted.toLowerCase().replace(/[^a-z]+/g, "-")}`,
  title: `"verbal ca for marnie holloway, she was late on 11/3/26. no payroll deduct", the drafter writes "${drafted}" — Create leaves Prior Actions blank`,
  report: REPORT,
  status: { open: `Prior Actions is saved as "${drafted}" though nothing was said about history` },
  fixFlags: FLAGS,
  async run(t: ReplayContext) {
    vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));
    t.directory([...STAFF]);
    t.as("salon_director", { level: "salon", primaryAreaId: "loc-0309", alsoCoversAreaIds: [] });
    const thread = t.thread();
    const reply = (await thread.say("verbal ca for marnie holloway, she was late on 11/3/26. no payroll deduct")).content;
    t.draftWrites({ observation: "Marnie Holloway was 20 minutes late for her shift on 11/3/26.", prior_actions: drafted });
    const id = await thread.create();
    expect(t.values(id).prior_actions ?? "", `Prior Actions was filled:\n${reply}`).toBe("");
  },
}));
