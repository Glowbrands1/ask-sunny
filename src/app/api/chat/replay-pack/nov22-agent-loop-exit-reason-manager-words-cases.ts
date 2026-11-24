import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * AN EXIT CARD'S REASON IS THE MANAGER'S OWN WORDS (QA's live L6 on prod 14fed8c, 22 Nov 2026)
 * ============================================================================
 *
 * "exit form for Test Testy, terminated for job abandonment, not eligible for rehire": the model wrote what_happened "job
 * abandonment", so the card's What happened and the saved resignation_reason read "job abandonment", not the manager's
 * "terminated for job abandonment". The account the model gives, when it is part of one clause the manager typed, is that
 * whole clause. Invented name: Rowan Kestrel (the tester's "Test Testy").
 */

const FLAG = "AGENT_LOOP_ENABLED";
const LIVE = process.env.AGENT_LOOP_LIVE === "1";
const SAID = "exit form for Rowan Kestrel, terminated for job abandonment, not eligible for rehire";

export const NOV22_AGENT_LOOP_EXIT_REASON_MANAGER_WORDS_CASES: ReplayCase[] = [
  {
    id: "nov22-l6-exit-reason-manager-words",
    title: `L6: "${SAID}" with the model's what_happened "job abandonment": the card and the saved reason read "terminated for job abandonment"`,
    report: "QA's live L6 on prod 14fed8c (22 Nov 2026): the exit card and saved resignation_reason read \"job abandonment\"",
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (lastResult(view, "propose_form")) return { text: "Here's the Resignation/Exit Form for **Rowan Kestrel**." };
        return {
          tool: "propose_form",
          input: {
            template_key: "stc-exit", employee_id: "e-4", exit_type: "termination",
            exit_evidence: { ...evidenceFrom(view, "exit form for Rowan Kestrel"), kind: "asks_for_exit_form" },
            what_happened: "job abandonment",
          },
        };
      }));
      const thread = t.thread();
      await thread.say(SAID);
      const issue = String((thread.proposal as { issue?: string } | undefined)?.issue ?? "");
      expect(issue, "the card's What happened").toMatch(/terminated for job abandonment/i);
      const id = await thread.create();
      const values = t.values(id);
      const checked = t.checked(id);
      const saved = JSON.stringify({ values, checked });
      expect(checked.resignation_type ?? [], `not a termination (the case proves nothing):\n${saved}`).toContain("immediate_involuntary_separation");
      /*
       * QA's live runs (22 Nov 2026, 2 of 3 failed): the saved "Rowan was terminated for job abandonment." is right; the
       * check was anchored, so the model's subject failed it. The bug is the reason without the manager's words
       * ("job abandonment" alone). The stand-in's exact reason is asserted on its own run.
       */
      expect(values.resignation_reason ?? "", saved).toMatch(/terminated for job abandonment/i);
      if (!LIVE) expect(values.resignation_reason ?? "", saved).toMatch(/^terminated for job abandonment\.?$/i);
      expect(checked.eligible_for_rehire ?? [], saved).toEqual(["no"]);
    },
  },
  {
    id: "nov22-l6-exit-termination-filed-as-once",
    title: `L6: "${SAID}": the card's facts give the termination's tick once (exit_termination), so a reply that says "Filed as" for each fact says it once`,
    report: "QA's live L6 on prod 14fed8c (22 Nov 2026): the reply said \"Filed as\" twice",
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      type Facts = { exit_ticks?: string[]; exit_termination?: { form_label?: string } };
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const result = lastResult(view, "propose_form") as { facts?: Facts } | null;
        if (result) {
          /* The live model follows the rules book's two lines: exit_termination's "Filed as an …", and exit_ticks' "Filed as: …". */
          const facts = result.facts ?? {};
          const lines = [
            ...(facts.exit_termination ? [`Filed as an **${facts.exit_termination.form_label}** (a termination), as you said.`] : []),
            ...((facts.exit_ticks ?? []).length > 0 ? [`Filed as: ${facts.exit_ticks!.join(", ")}.`] : []),
          ];
          return { text: `Here's the Resignation/Exit Form for **Rowan**. ${lines.join(" ")}` };
        }
        return {
          tool: "propose_form",
          input: {
            template_key: "stc-exit", employee_id: "e-4", exit_type: "termination",
            exit_evidence: { ...evidenceFrom(view, "exit form for Rowan Kestrel"), kind: "asks_for_exit_form" },
            what_happened: "terminated for job abandonment",
          },
        };
      }));
      const reply = await t.thread().say(SAID);
      expect(reply.content, "the termination is not said at all (the case proves nothing)").toMatch(/Immediate involuntary separation/);
      expect(reply.content.match(/Filed as/g) ?? [], reply.content).toHaveLength(1);
    },
  },
  {
    id: "nov22-l6-exit-termination-details-are-card-account",
    title: `L6: "${SAID}": Additional Details are the card's account (the manager's words), never the drafter's "The departure was recorded effective …"`,
    report: "QA's live L6 on prod 14fed8c (22 Nov 2026): Additional Details held only \"The departure was recorded effective 2026-11-21.\"",
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (lastResult(view, "propose_form")) return { text: "Here's the Resignation/Exit Form for **Rowan Kestrel**." };
        return {
          tool: "propose_form",
          input: {
            template_key: "stc-exit", employee_id: "e-4", exit_type: "termination",
            exit_evidence: { ...evidenceFrom(view, "exit form for Rowan Kestrel"), kind: "asks_for_exit_form" },
            what_happened: "terminated for job abandonment",
          },
        };
      }));
      t.draftWrites({ details: "The departure was recorded effective 2026-11-22." });
      const thread = t.thread();
      await thread.say(SAID);
      const issue = String((thread.proposal as { issue?: string } | undefined)?.issue ?? "").trim();
      const id = await thread.create();
      const values = t.values(id);
      expect(values.details ?? "", JSON.stringify(values)).not.toMatch(/departure was recorded/i);
      expect(values.details ?? "", JSON.stringify(values)).toBe(issue);
    },
  },
];
