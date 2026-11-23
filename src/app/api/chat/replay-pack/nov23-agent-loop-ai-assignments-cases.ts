import { expect, vi } from "vitest";

import type { ReplayCase, ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * AI TRAINING -> ASSIGNMENTS: THE AI READS THE TRACKER (Pau, 23 Nov 2026)
 * ============================================================================
 *
 * The AI assignment tracker moved into AI Training as an Assignments tab, for four named people only
 * (`AI_ASSIGNMENT_TRACKER_EMAILS`). A feature isn't done until the AI can read it (CLAUDE.md §5): read_ai_assignments
 * returns the grid's figures to someone on the list, and refuses anyone else with nothing read. The people on the
 * tracker and the signed-in address are invented.
 */
const REPORT = "Pau, 23 Nov 2026: an Assignments tab in AI Training so the AI assignments can be tracked, only for the four people named";
const FLAG = "AGENT_LOOP_ENABLED";
const GLOBAL = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const ASKED = "who hasn't done their AI assignment yet this half?";
/** The replay harness signs every case in as this address. */
const SIGNED_IN = "qa-manager@example.test";

function tracker(t: ReplayContext): void {
  vi.setSystemTime(new Date("2026-11-23T18:00:00Z"));
  t.seedRows!("ai_assignment_people", [
    { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Ash Fernwell", group_name: null, start_date: null, sort_order: null },
    { id: "aaaaaaaa-0000-4000-8000-000000000002", name: "Bram Tolliver", group_name: null, start_date: null, sort_order: null },
    { id: "aaaaaaaa-0000-4000-8000-000000000003", name: "Cass Lindqvist", group_name: null, start_date: "2026-11-03", sort_order: null },
  ]);
  t.seedRows!("ai_assignment_marks", [
    { person_id: "aaaaaaaa-0000-4000-8000-000000000001", month: "2026-11", half: 1, state: "done" },
    { person_id: "aaaaaaaa-0000-4000-8000-000000000003", month: "2026-11", half: 1, state: "extended" },
  ]);
}

/** The tracker's list for this case; put back after it. */
async function withList<T>(emails: string, work: () => Promise<T>): Promise<T> {
  const before = process.env.AI_ASSIGNMENT_TRACKER_EMAILS;
  process.env.AI_ASSIGNMENT_TRACKER_EMAILS = emails;
  try {
    return await work();
  } finally {
    if (before === undefined) delete process.env.AI_ASSIGNMENT_TRACKER_EMAILS;
    else process.env.AI_ASSIGNMENT_TRACKER_EMAILS = before;
  }
}

function asks(t: ReplayContext) {
  t.as("admin", GLOBAL);
  const model = loopStandIn((view: LoopView): LoopDecision =>
    lastResult(view, "read_ai_assignments") ? { text: "Here is the AI assignment tracker." } : { tool: "read_ai_assignments", input: {} },
  );
  t.loopModel!(model);
  return () => (model.views.flatMap((view) => view.results.filter((result) => result.tool === "read_ai_assignments")).at(-1)?.output ?? {}) as Record<string, unknown>;
}

export const NOV23_AGENT_LOOP_AI_ASSIGNMENTS_CASES: ReplayCase[] = [
  {
    id: "nov23-agent-loop-tracker-person-asks-who-has-not-done-the-ai-assignment",
    title: `someone on the tracker's list: "${ASKED}": read_ai_assignments gives who is done, still due and has more time this half`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      tracker(t);
      const result = asks(t);
      await withList(SIGNED_IN, () => t.thread().say(ASKED));
      const output = result();
      expect(output.refused, "someone on the list was refused").toBeUndefined();
      const text = String((output.tracker as { untrusted_text?: string } | undefined)?.untrusted_text ?? "");
      expect(text, "the tracker did not reach the model").toContain("The current half is Nov 16–30, 2026.");
      expect(text).toContain("This half: 1 of 3 done.");
      expect(text).toContain("Still due this half: Bram Tolliver.");
      expect(text).toContain("Asked for more time this half: Cass Lindqvist.");
      expect(text).toContain("- Bram Tolliver: 0 done, 3 missing, 0 with more time.");
    },
  },
  {
    id: "nov23-agent-loop-not-on-tracker-list-refused",
    title: `an administrator not on the tracker's list: "${ASKED}": read_ai_assignments refuses, and nothing from the tracker reaches the model`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      tracker(t);
      const result = asks(t);
      await withList("someone.else@example.test", () => t.thread().say(ASKED));
      const output = result();
      expect(output.refused).toMatch(/only for the people it was set up for/);
      expect(JSON.stringify(output), "the tracker reached someone not on its list").not.toMatch(/Bram Tolliver|Ash Fernwell|Cass Lindqvist/);
    },
  },
];
