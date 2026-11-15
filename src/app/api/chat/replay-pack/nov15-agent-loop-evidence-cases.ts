import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * The rebuild plan's foundation (owner's audit, 15 Nov 2026): every manager turn the model is shown carries its
 * message id, so a tool's evidence can name the turn it quotes (`evidence.ts`); the tag is never shown to the manager.
 * Invented names only.
 */
export const NOV15_AGENT_LOOP_EVIDENCE_CASES: ReplayCase[] = [
  {
    id: "nov15-evidence-manager-turns-carry-their-message-ids",
    title: "Rebuild plan, evidence.ts: each manager turn the model is shown ends with its [message_id: <id>], the app's replies carry none, and a reply that echoes a tag never shows it to the manager",
    report: "QA's rebuild plan (owner's audit, 15 Nov 2026): message ids on history turns in conversationOf",
    status: "fixed",
    fixFlags: ["AGENT_LOOP_ENABLED"],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "Remy Calder" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "coaching", employee_id: "e-2", what_happened: "She was late to her shift on 11/14." } };
        const id = view.turns.at(-1)?.messageIds?.[0] ?? "none";
        return { text: `Here's the Coaching Form for **Remy Calder**. [message_id: ${id}]` };
      });
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say("coaching for Remy Calder, she was late to her shift on 11/14");
      const reply = await thread.say("she was late again on 11/15");
      const last = model.views.at(-1)!;
      const managerTurns = last.turns.filter((turn) => turn.role === "user");
      expect(managerTurns.every((turn) => (turn.messageIds?.length ?? 0) > 0), "a manager turn reached the model without its id").toBe(true);
      expect(last.turns.filter((turn) => turn.role === "assistant").some((turn) => turn.messageIds), "the app's reply carries an id").toBe(false);
      expect(new Set(managerTurns.flatMap((turn) => turn.messageIds ?? [])).size, "two manager turns share an id").toBe(managerTurns.length);
      expect(managerTurns.at(-1)!.text, "the tag is left in the manager's words").toBe("she was late again on 11/15");
      expect(reply.content, "the tag reached the manager").not.toMatch(/message_id/);
    },
  },
];
