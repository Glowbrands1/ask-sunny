import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn } from "./loop-stand-in";

/**
 * ============================================================================
 * BATCH K (TEAM): QA'S 266-CHAT SHADOW REPLAY (15 Nov 2026)
 * ============================================================================
 *
 * K9 "coahcing for my entire team" is the team Coaching card. People invented (STAFF's).
 */
const REPORT = "QA, batch K (15 Nov 2026): the 266-chat shadow replay";
const FLAG = "AGENT_LOOP_ENABLED";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-11T16:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV15_AGENT_LOOP_BATCH_K_TEAM_CASES: ReplayCase[] = [
  {
    id: "nov15-batch-k9-misspelled-coaching-for-my-entire-team",
    title: "K9: \"coahcing for my entire team\" is the team Coaching card, never \"not a whole-team coaching request\"",
    report: `${REPORT}; K9: coach_team refused "coaching for my entire team" typed "coahcing"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      for (const said of ["coahcing for my entire team", "I need a coachng form for my whole team", "coaching form for everyone on my team"]) {
        const thread = start(t);
        const model = loopStandIn((view) => (lastResult(view, "coach_team") ? { text: "Here is the team Coaching card." } : { tool: "coach_team", input: {} }));
        t.loopModel!(model);
        await thread.say(said);
        const result = model.views.flatMap((view) => view.results).find((row) => row.tool === "coach_team")?.output as { error?: string; facts?: { team_card?: boolean } } | undefined;
        expect(result?.error, `"${said}" was refused`).toBeUndefined();
        expect(thread.proposal, `"${said}" made no team card`).toMatchObject({ templateKey: "coaching", subject: "team" });
      }
    },
  },
];
