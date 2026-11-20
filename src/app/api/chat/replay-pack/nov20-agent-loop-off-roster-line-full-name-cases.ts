import { expect, vi } from "vitest";

import type { ChatFormProposal } from "@/types";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE NOT-ON-THE-STAFF-LIST LINE KEEPS THE FULL NAME (QA's f070, 20 Nov 2026; live chat on main 2923160b)
 * ============================================================================
 *
 * The manager typed "ca for <First> <Last> for being late today, can you also cite the coaching that was done on 11/3"
 * (a name not on the staff list). The reply said "Here's the Corrective Action Form for <First>. <First> isn't on the
 * Woven staff list, so I've used the name as you typed it." The rules book keeps that line's full name exactly as typed;
 * the model used the short reply name, in some replies. Code now keeps it. Invented name (Arlo Quillfeather, not on the
 * pack's staff list).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's f070 (20 Nov 2026; live chat on main 2923160b): \"<First> isn't on the Woven staff list\" named the off-roster person by first name only";
const SAID = "ca for Arlo Quillfeather for being late today, can you also cite the coaching that was done on 11/3";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-20T15:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const managerTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);

export const NOV20_AGENT_LOOP_OFF_ROSTER_LINE_FULL_NAME_CASES: ReplayCase[] = [
  {
    id: "nov20-off-roster-line-keeps-the-full-name-f070",
    title: `"${SAID}": the model writes "Arlo isn't on the Woven staff list" (the short name); the reply says "**Arlo Quillfeather** isn't on the Woven staff list"`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const results: Record<string, unknown>[] = [];
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const done = view.results.find((entry) => entry.tool === "propose_form")?.output;
        if (done) {
          results.push(done);
          if (typeof done.ask_exactly === "string") return { text: done.ask_exactly };
          return { text: "Here's the Corrective Action Form for **Arlo**. Arlo isn't on the Woven staff list, so I've used the name as you typed it. Check the spelling before you press Create." };
        }
        const quote = { message_id: managerTurns(view).at(-1)?.messageIds?.at(-1) ?? "current", quote: "Arlo Quillfeather" };
        return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Arlo Quillfeather", person_evidence: quote, what_happened: "Was late today.", policy: "Attendance", prior_actions: "Coaching — 11/3/2026" } };
      }));
      const reply = await t.thread().say(SAID);
      expect((reply.formProposal as ChatFormProposal | undefined)?.employeeName, `no card under the typed name (the case proves nothing): ${JSON.stringify(results.at(-1))}`).toBe("Arlo Quillfeather");
      expect(reply.content, `the not-on-the-staff-list line used the short name: ${reply.content} | ${JSON.stringify(Object.keys(results.at(-1) ?? {}))} | ${String((results.at(-1) as { off_roster_name?: unknown } | undefined)?.off_roster_name)}`).toContain("**Arlo Quillfeather** isn't on the Woven staff list");
      expect(reply.content).not.toMatch(/(?:^|\. )Arlo isn't on/);
      expect(reply.content, "the rest of the reply keeps the short name").toContain("Here's the Corrective Action Form for **Arlo**.");
    },
  },
];
