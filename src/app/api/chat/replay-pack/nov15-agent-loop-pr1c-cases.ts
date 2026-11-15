import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, firstMatch, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * PR 1c + PR 4 PART 2: A LEVEL AND A PAYROLL ANSWER ARE KEPT ONLY ON EVIDENCE (owner's audit, 15 Nov 2026)
 * ============================================================================
 *
 * propose_form read every earlier manager turn for a level ("she was written up before" unlocked "written") and for a
 * payroll answer. Now level_evidence / payroll_evidence (a manager message id and a real quote, `evidence.ts`) decide;
 * the model reads what the words mean. Refused: level_not_stated / payroll_not_stated, with the evidence check's reason.
 * Every person is invented.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Pau's audit of the agent loop (15 Nov 2026), PR 1c / PR 4 part 2";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const proposeOutputs = (views: readonly LoopView[]) => views.flatMap((view) => view.results.filter((result) => result.tool === "propose_form")).map((result) => result.output);

/** A model that proposes the card once with the given level, payroll and evidence, then replies. */
function proposer(extra: (view: LoopView) => Record<string, unknown>) {
  return loopStandIn((view): LoopDecision => {
    if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
    if (!lastResult(view, "propose_form")) {
      return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was late on 11/12.", incident_date: "2026-11-12", ...extra(view) } };
    }
    return { text: "Here is the card." };
  });
}

export const NOV15_AGENT_LOOP_PR1C_CASES: ReplayCase[] = [
  {
    id: "nov15-agent-loop-pr1c-level-with-no-evidence-is-not-kept",
    title: "PR 1c: warning_level written with no level_evidence is not kept: level_not_stated, the card has no level",
    report: `${REPORT}: the level came from any earlier word`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const standIn = proposer(() => ({ warning_level: "written" }));
      t.loopModel!(standIn);
      const thread = t.thread();
      await thread.say("ca for remy calder, late on 11/12");
      const out = proposeOutputs(standIn.views)[0]!;
      expect(out.reason_code, JSON.stringify(out)).toBe("level_not_stated");
      expect((out.facts as { not_kept?: string[] }).not_kept).toContain("warning_level");
      expect((out.card as { warning_level?: unknown }).warning_level ?? null).toBeNull();
    },
  },
  {
    id: "nov15-agent-loop-pr1c-written-up-before-does-not-unlock-written",
    title: "PR 1c (Pau's audit bug 1): \"she was written up before\" in an earlier turn does not unlock written for a later card",
    report: `${REPORT}: propose_form unlocked a level from ANY earlier manager turn`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      // Three manager messages: the "written up before" remark, an unrelated one, then the request for the card.
      const thread = t.thread();
      const standIn = loopStandIn((view): LoopDecision => {
        const said = view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
        if (/^she was written up before/i.test(said)) return { text: "Noted." };
        if (/^what are the hours/i.test(said)) return { text: "Hours are on the schedule." };
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!lastResult(view, "propose_form")) {
          return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was late on 11/12.", incident_date: "2026-11-12", warning_level: "written", level_evidence: evidenceFrom(view, "she was written up before", 2) } };
        }
        return { text: "Here is the card." };
      });
      t.loopModel!(standIn);
      await thread.say("she was written up before");
      await thread.say("what are the hours for the 20th");
      await thread.say("ca for remy calder, late on 11/12");
      const out = proposeOutputs(standIn.views).at(-1)!;
      expect(out.reason_code, JSON.stringify(out)).toBe("level_not_stated");
      expect(out.level_evidence).toBe("evidence_not_this_turn");
      expect((thread.proposal as { warningLevel?: string } | null)?.warningLevel ?? null, "a level from an earlier turn was kept").toBeNull();
    },
  },
  {
    id: "nov15-agent-loop-pr1c-level-kept-on-real-evidence",
    title: "PR 1c: warning_level verbal with a real quote from the message being answered is kept",
    report: `${REPORT}: the evidence path works for a stated level`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const standIn = proposer((view) => ({ warning_level: "verbal", level_evidence: evidenceFrom(view, "verbal ca for remy calder") }));
      t.loopModel!(standIn);
      const thread = t.thread();
      await thread.say("verbal ca for remy calder, late on 11/12");
      const out = proposeOutputs(standIn.views)[0]!;
      expect(out.reason_code, JSON.stringify(out)).toBeUndefined();
      expect((out.card as { warning_level?: unknown }).warning_level).toBe("verbal");
    },
  },
  {
    id: "nov15-agent-loop-pr1c-made-up-quote-is-refused",
    title: "PR 1c: a quote that is not in the manager's message is refused (evidence_quote_not_found): neither level nor payroll is kept",
    report: `${REPORT}: the model's evidence is a claim checked against the real turn`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const standIn = proposer((view) => ({
        warning_level: "written",
        level_evidence: evidenceFrom(view, "make it a written warning"),
        payroll_deduct: "yes",
        payroll_evidence: evidenceFrom(view, "yes deduct it from payroll"),
      }));
      t.loopModel!(standIn);
      await t.thread().say("ca for remy calder, late on 11/12");
      const out = proposeOutputs(standIn.views)[0]!;
      expect(out.reason_code).toBe("level_not_stated");
      expect(out.level_evidence).toBe("evidence_quote_not_found");
      expect(out.payroll_evidence).toBe("evidence_quote_not_found");
      expect((out.facts as { not_kept?: string[] }).not_kept).toEqual(expect.arrayContaining(["warning_level", "payroll_deduct"]));
    },
  },
  {
    id: "nov15-agent-loop-pr1c-payroll-answer-right-after-the-card",
    title: "PR 1c: \"yes payroll deduct\" answered right after the card asked is kept on a real quote from that answer",
    report: `${REPORT}: the direct answer to the card's payroll question`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const standIn = loopStandIn((view): LoopDecision => {
        const said = view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!lastResult(view, "propose_form")) {
          const answered = /payroll/i.test(said);
          return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was late on 11/12.", incident_date: "2026-11-12", ...(answered ? { payroll_deduct: "yes", payroll_evidence: evidenceFrom(view, "yes payroll deduct") } : {}) } };
        }
        return { text: "Here is the card." };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      await thread.say("ca for remy calder, late on 11/12");
      await thread.say("yes payroll deduct");
      const outs = proposeOutputs(standIn.views);
      const out = outs.at(-1)!;
      expect(out.reason_code, JSON.stringify(out)).toBeUndefined();
      expect((out.card as { payroll_deduct?: unknown }).payroll_deduct).toBe("yes");
    },
  },
  {
    id: "nov15-agent-loop-pr1c-one-persons-payroll-is-not-anothers",
    title: "PR 1c (QA): Remy's card asks payroll, \"yes\", then \"do the same for juno\": Juno's card has no payroll (evidence_after_card); Remy's keeps it when proposed again",
    report: `${REPORT}: a payroll answer counts only after the reply that asked for THAT card, tied to that card's person`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const standIn = loopStandIn((view): LoopDecision => {
        const said = view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
        const who = /juno/i.test(said) ? "juno paxton" : "remy calder";
        const cards = view.results.filter((result) => result.tool === "propose_form").length;
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: who } };
        if (cards === 0) {
          const id = firstMatch(view)?.employee_id;
          // "yes payroll" was said in turn 2 (after Remy's card asked); turn 3 reuses it for the other person.
          const answered = /^(?:yes|do the same|make it)/i.test(said);
          return {
            tool: "propose_form",
            input: {
              template_key: "dpoa", employee_id: id, what_happened: `${who === "juno paxton" ? "Juno Paxton" : "Remy Calder"} was late on 11/12.`, incident_date: "2026-11-12",
              ...(answered ? { payroll_deduct: "yes", payroll_evidence: evidenceFrom(view, /^yes/i.test(said) ? "yes" : "yes", /^yes/i.test(said) ? 0 : 1) } : {}),
            },
          };
        }
        return { text: `Here's the Corrective Action Form for **${who === "juno paxton" ? "Juno Paxton" : "Remy Calder"}**.` };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      await thread.say("ca for remy calder, late on 11/12");
      await thread.say("yes");
      const remy = proposeOutputs(standIn.views).at(-1)!;
      expect((remy.card as { payroll_deduct?: unknown }).payroll_deduct, JSON.stringify(remy)).toBe("yes");
      await thread.say("do the same for juno paxton");
      const juno = proposeOutputs(standIn.views).at(-1)!;
      expect(juno.reason_code, JSON.stringify(juno)).toBe("payroll_not_stated");
      expect(juno.payroll_evidence).toBe("evidence_after_card");
      expect((juno.card as { payroll_deduct?: unknown }).payroll_deduct ?? null, "Remy's payroll answer reached Juno's card").toBeNull();
    },
  },
];
