import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * BATCH G: THE LOOP WITH A FORM OPEN (QA's first live test with a draft open, 15 Nov 2026)
 * ============================================================================
 *
 * The first live test of the agent loop with a form open (a Corrective Action with a sectioned Observation) found
 * edit-path bugs. Pau then paused rewording ("make it professional"): G0 turns it off (nothing is written, the
 * reply says so). G3, G4 and G5 are the add, open and payroll paths. Every person here is invented, and the
 * managers' wording is kept.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's live test with a form open (15 Nov 2026)";
const PAUSED = "Rewording isn't available yet. Tell me exactly what to change and I'll update it.";

const toolResults = (views: readonly LoopView[], tool: string) => views.flatMap((view) => view.results.filter((result) => result.tool === tool)).map((result) => JSON.stringify(result.output));
/** Offline only: a live run checks outcomes, never which tool facts the real model asked for. */
const offline = process.env.AGENT_LOOP_LIVE !== "1";

export const NOV15_AGENT_LOOP_BATCH_G_CASES: ReplayCase[] = [
  {
    id: "nov15-agent-loop-g0-reword-on-a-draft-writes-nothing",
    title: "G0 (Pau 15 Nov: rewording paused): \"make it professional\" with a draft open writes nothing and says rewording isn't available yet",
    report: `${REPORT}: a reword touched the Action Plan and merged the Observation's sections; Pau paused rewording`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "coaching", employee_id: "e-2", what_happened: "Remy Calder didn't check the beds between clients." } };
        return { text: "Here's the Coaching Form for **Remy Calder**.\n\n**Observation of Offense:** Remy Calder didn't check the beds between clients." };
      }));
      const thread = t.thread();
      await thread.say("coaching form for remy calder, she didnt check the beds between clients");
      const id = await thread.create();
      t.typeOnForm(id, { coaching_details: "Remy Calder didnt check the beds between clients." });
      const before = JSON.stringify(t.values(id));
      const model = loopStandIn((view): LoopDecision => {
        const edit = lastResult(view, "edit_form") as { reword_paused?: boolean } | null;
        if (!edit) return { tool: "edit_form", input: { instance_id: id, values: { coaching_details: "Remy Calder did not check the beds between guest sessions." } } };
        return { text: edit.reword_paused ? PAUSED : "Reworded." };
      });
      t.loopModel!(model);
      const reply = await thread.say("make it professional");
      expect(JSON.stringify(t.values(id)), "a reword was written while rewording is paused").toBe(before);
      expect(reply.formUpdate ?? null).toBeNull();
      expect(reply.content, `the reply does not say rewording is paused:\n${reply.content}`).toMatch(/Rewording isn't available yet/);
      if (offline) expect(toolResults(model.views, "edit_form")[0], "edit_form did not refuse the reword").toMatch(/"reword_paused":true/);
    },
  },
  {
    id: "nov15-agent-loop-g0-reword-on-a-card-writes-nothing",
    title: "G0 (Pau 15 Nov: rewording paused): \"reword it\" with a card on screen leaves the card as it is and says rewording isn't available yet",
    report: `${REPORT}: Pau paused rewording; a same-card re-proposal with new wording is refused too`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        const said = [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";
        const proposed = lastResult(view, "propose_form") as { reword_paused?: boolean } | null;
        if (/reword/i.test(said)) {
          if (!proposed) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder arrived twenty minutes after the start of her scheduled shift on 11/12." } };
          return { text: proposed.reword_paused ? PAUSED : "Reworded the card." };
        }
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!proposed) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was 20 minutes late on 11/12." } };
        return { text: "Here's the Corrective Action Form for **Remy Calder**.\n\n**Observation of Offense:** Remy Calder was 20 minutes late on 11/12." };
      });
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say("ca for remy calder, she was 20 minutes late on 11/12");
      const card = thread.proposal?.issue;
      const reply = await thread.say("reword it");
      expect(thread.proposal?.issue, "the card was reworded while rewording is paused").toBe(card);
      expect(reply.content, `the reply does not say rewording is paused:\n${reply.content}`).toMatch(/Rewording isn't available yet/);
      if (offline) expect(toolResults(model.views, "propose_form").some((result) => /"reword_paused":true/.test(result)), "propose_form did not refuse the reword").toBe(true);
    },
  },
];
