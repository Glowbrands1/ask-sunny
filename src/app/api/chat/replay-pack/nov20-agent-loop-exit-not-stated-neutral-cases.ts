import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * AN EXIT CARD WITH NO EXIT ASKED: ASK, NEVER STEER TO A CA (QA item 10, 20 Nov 2026)
 * ============================================================================
 *
 * exit_not_stated told the model "An offense told with a termination is the Corrective Action Form …" whenever an exit
 * card had no exit_evidence, so a manager who only said someone was leaving was steered to a CA. General rule: a refused
 * exit card makes no card and asks, neutrally, whether the person resigned or was terminated, offering both forms. A
 * termination told with an offense is still the Corrective Action Form by the rules book (Pau's P15), not by this refusal.
 * Invented names only (Remy Calder, the pack's roster).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA (20 Nov 2026), item 10: exit_not_stated steered toward a Corrective Action; ask resigned or terminated, or offer both forms neutrally";
const SAID = "Remy Calder's last day is 11/21, I need to do the paperwork";

type Out = { reason_code?: string; note?: string; error?: string; ask_exactly?: string; card?: unknown } | null;

export const NOV20_AGENT_LOOP_EXIT_NOT_STATED_NEUTRAL_CASES: ReplayCase[] = [
  {
    id: "nov20-exit-not-stated-asks-resigned-or-terminated",
    title: "An exit card proposed with no exit_evidence (\"Remy Calder's last day is 11/21, I need to do the paperwork\"): refused with no steer to a Corrective Action; the reply asks whether Remy Calder resigned or was terminated and offers both forms; no card",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-19T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        const card = lastResult(view, "propose_form") as Out;
        if (!card) return { tool: "propose_form", input: { template_key: "stc-exit", employee_id: "e-2", last_day_worked: "2026-11-21" } };
        return { text: card.ask_exactly ?? card.note ?? card.error ?? "" };
      });
      t.loopModel!(model);
      const thread = t.thread();
      const reply = await thread.say(SAID);
      const refused = lastResult(model.views.at(-1)!, "propose_form") as Out;
      expect(refused?.reason_code).toBe("exit_not_stated");
      expect(`${refused?.note ?? ""} ${refused?.error ?? ""}`, "the refusal steers toward a Corrective Action").not.toMatch(/Corrective Action/i);
      expect(refused?.ask_exactly, "the refusal does not ask resigned or terminated").toMatch(/resign.*terminat/i);
      expect(refused?.ask_exactly, "the refusal does not offer both forms").toMatch(/Exit Form.*Corrective Action Form|Corrective Action Form.*Exit Form/);
      expect(reply.formProposal ?? null, `a card was made:\n${reply.content}`).toBeNull();
      expect(reply.content).toMatch(/resign/i);
    },
  },
];
