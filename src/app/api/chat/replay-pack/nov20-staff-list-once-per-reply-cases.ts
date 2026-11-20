import { expect, vi } from "vitest";

import type { ChatFormProposal } from "@/types";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE STAFF LIST IS READ ONCE PER REPLY, AND THE REPLY IS THE SAME (QA's f056, 20 Nov 2026)
 * ============================================================================
 *
 * The chat route now runs each request inside `withRosterReadsOncePerReply`, so the directory reads behind the staff list
 * run once per scope per reply (counted in `employee-roster-once-per-reply.test.ts`). These cases run a card turn through
 * the real route, on the loop and on the old path, and check the card is what it was: the same person, title and salon.
 * Invented names only (Remy Calder).
 */

const REPORT = "QA's f056 (20 Nov 2026): the staff list was read 5 to 8 times per card in one turn";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-20T12:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const managerTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);
const card = (reply: { formProposal?: unknown }) => (reply.formProposal as ChatFormProposal | undefined) ?? null;
const SAID = "make a CA for Remy Calder, she was late to her shift on 11/18";

export const NOV20_STAFF_LIST_ONCE_PER_REPLY_CASES: ReplayCase[] = [
  {
    id: "nov20-staff-list-once-per-reply-agent-loop",
    title: `the tool loop: "${SAID}" (find_staff, then propose_form, each reading the staff list): the card is Remy Calder's, with the title and salon the staff list gives`,
    report: REPORT,
    status: "fixed",
    fixFlags: ["AGENT_LOOP_ENABLED"],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (view.results.some((entry) => entry.tool === "propose_form")) return { text: "Here's the Corrective Action Form for **Remy Calder**." };
        const quote = { message_id: managerTurns(view).at(-1)?.messageIds?.at(-1) ?? "current", quote: "Remy Calder" };
        if (!view.results.some((entry) => entry.tool === "find_staff")) return { tool: "find_staff", input: { name: "Remy Calder", person_evidence: quote } };
        return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Remy Calder", person_evidence: quote, what_happened: "Was late to her shift on 11/18.", incident_date: "2026-11-18", policy: "Attendance" } };
      }));
      const reply = await t.thread().say(SAID);
      expect(card(reply)).toMatchObject({ employeeName: "Remy Calder", employeeRole: "Tanning Consultant", locationId: "loc-0309", formDate: "2026-11-18" });
    },
  },
  {
    id: "nov20-staff-list-once-per-reply-old-path",
    title: `the old path: "${SAID}": the card is Remy Calder's, at the manager's salon`,
    report: REPORT,
    status: "fixed",
    fixFlags: [],
    async run(t) {
      start(t);
      const reply = await t.thread().say(SAID);
      expect(card(reply)?.employeeName).toBe("Remy Calder");
      expect(card(reply)?.locationId).toBe("loc-0309");
    },
  },
];
