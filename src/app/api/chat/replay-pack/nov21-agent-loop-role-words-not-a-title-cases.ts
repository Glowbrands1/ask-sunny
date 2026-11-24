import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * "TEAM MEMBER" IS THE STAFF, NOT A JOB TITLE (QA2 for Pau, 21 Nov 2026; parity with the sibling app's loop)
 * ============================================================================
 *
 * Pau: "team member", "staff" and "employee" all mean the frontline staff; the loop must never write one of them as
 * someone's Position, nor read it as part of their name. With no title on the staff list, "<name>, she is a team
 * member" filled the card's Job Title with "Team Member". A title the manager typed that is a real position ("tan
 * consultant") still fills it, as before (batch H4). Invented person, no title on the staff list.
 */
const REPORT = "QA2 for Pau (21 Nov 2026): \"team member\", \"staff\" and \"employee\" are the frontline staff, never a Position";
const FLAG = "AGENT_LOOP_ENABLED";
const ODELIA: DirectoryRow = { id: "e-odelia-fennimore", firstName: "Odelia", lastName: "Fennimore", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: null as never };

const proposed = (views: readonly LoopView[]) =>
  views.flatMap((view) => view.results).filter((result) => result.tool === "propose_form").at(-1)?.output as
    | { card?: Record<string, unknown>; facts?: Record<string, unknown> }
    | undefined;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-11T16:00:00Z"));
  t.directory([...STAFF, ODELIA]);
  t.as("salon_director", KEARNEY);
  const model = loopStandIn((view) => (lastResult(view, "propose_form") ? { text: "Here is the card." } : { tool: "propose_form", input: { template_key: "dpoa", employee_id: ODELIA.id, policy: "Attendance", what_happened: "Odelia Fennimore was 20 minutes late on 11/9/26." } }));
  t.loopModel!(model);
  return { thread: t.thread(), model };
}

export const NOV21_AGENT_LOOP_ROLE_WORDS_NOT_A_TITLE_CASES: ReplayCase[] = [
  ...(["team member", "staff member"] as const).map((words): ReplayCase => ({
    id: `nov21-role-words-not-a-title-${words.replace(" ", "-")}`,
    title: `"verbal ca for odelia fennimore, she is a ${words}, she was 20 minutes late on 11/9/26": the card's Job Title is not "${words}" (no title on the staff list)`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { thread, model } = start(t);
      const reply = await thread.say(`verbal ca for odelia fennimore, she is a ${words}, she was 20 minutes late on 11/9/26`);
      const result = proposed(model.views);
      expect(result?.card, "no card was made (the case proves nothing)").toBeTruthy();
      expect(reply.formProposal?.employeeRole ?? null, `"${words}" was written as her Position`).toBeNull();
      expect(result?.facts?.job_title_from_your_words, `"${words}" was taken as a typed title`).toBeUndefined();
    },
  })),
  {
    id: "nov21-role-words-real-typed-title-still-fills",
    title: "Control: \"verbal ca for odelia fennimore, tan consultant at kearney, …\" still fills the empty Job Title as \"Tan Consultant\" (batch H4 unchanged)",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { thread } = start(t);
      const reply = await thread.say("verbal ca for odelia fennimore, tan consultant at kearney, she was 20 minutes late on 11/9/26");
      expect(reply.formProposal?.employeeRole).toBe("Tan Consultant");
    },
  },
];
