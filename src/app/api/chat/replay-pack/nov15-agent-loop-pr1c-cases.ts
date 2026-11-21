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
      expect((out.not_on_card as { field: string }[]).map((entry) => entry.field)).toContain("warning_level");
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
      expect((out.not_on_card as { field: string }[]).map((entry) => entry.field)).toEqual(expect.arrayContaining(["warning_level", "payroll_deduct"]));
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
              /* Changed on purpose (live model verified 21 Nov 2026, QA2; #1199): with CARD_PERSON_THIS_REQUEST on in production, another person's card while one is open carries new_form_evidence, as the live model passes it; this message states no date, so the ownRequest rule does not cover it. */
              ...(who === "juno paxton" ? { new_form_evidence: evidenceFrom(view) } : {}),
            },
          };
        }
        return { text: `Here's the Corrective Action Form for **${who === "juno paxton" ? "Juno Paxton" : "Remy Calder"}**.` };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      await thread.say("ca for remy calder, late on 11/12");
      // Changed on purpose (fix batch item 7, c163): a bare "yes" to "Payroll deduct and warning level aren't set" sets
      // neither; the answer says which, so this case still checks whose card a payroll answer belongs to.
      await thread.say("yes, payroll deduct");
      const remy = proposeOutputs(standIn.views).at(-1)!;
      expect((remy.card as { payroll_deduct?: unknown }).payroll_deduct, JSON.stringify(remy)).toBe("yes");
      await thread.say("do the same for juno paxton");
      const juno = proposeOutputs(standIn.views).at(-1)!;
      expect(juno.reason_code, JSON.stringify(juno)).toBe("payroll_not_stated");
      expect(juno.payroll_evidence).toBe("evidence_after_card");
      expect((juno.card as { payroll_deduct?: unknown }).payroll_deduct ?? null, "Remy's payroll answer reached Juno's card").toBeNull();
    },
  },
  {
    id: "nov15-agent-loop-pr1c-another-persons-level-is-not-this-cards",
    title: "PR 1c (QA's person guard): \"verbal for Remy Calder, late 11/9\" then \"now a ca for juno paxton, rude to a guest\": Juno's card has no level from Remy's message (other_person)",
    report: `${REPORT}: an evidence turn that names a different roster person is that person's message`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const standIn = loopStandIn((view): LoopDecision => {
        const said = view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
        const juno = /juno/i.test(said);
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: juno ? "juno paxton" : "remy calder" } };
        if (!lastResult(view, "propose_form")) {
          return {
            tool: "propose_form",
            input: {
              template_key: "dpoa", employee_id: firstMatch(view)?.employee_id, what_happened: juno ? "Juno Paxton was rude to a guest." : "Remy Calder was late on 11/9.", incident_date: juno ? "2026-11-12" : "2026-11-09",
              warning_level: "verbal",
              // Juno's card quotes the manager message before it, which is about Remy.
              level_evidence: evidenceFrom(view, "verbal for remy calder", juno ? 1 : 0),
              /* Changed on purpose (live model verified 21 Nov 2026, QA2; #1199): with CARD_PERSON_THIS_REQUEST on in production, another person's card while one is open carries new_form_evidence, as the live model passes it; this message states no date, so the ownRequest rule does not cover it. */
              ...(juno ? { new_form_evidence: evidenceFrom(view) } : {}),
            },
          };
        }
        return { text: "Here's the card." };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      await thread.say("verbal for remy calder, late 11/9");
      expect(((proposeOutputs(standIn.views).at(-1)!.card) as { warning_level?: unknown }).warning_level, "Remy's own level").toBe("verbal");
      await thread.say("now a ca for juno paxton, rude to a guest");
      const out = proposeOutputs(standIn.views).at(-1)!;
      expect(out.reason_code, JSON.stringify(out)).toBe("level_not_stated");
      expect(out.level_evidence).toBe("other_person");
      expect((out.card as { warning_level?: unknown }).warning_level ?? null, "Remy's level reached Juno's card").toBeNull();
    },
  },
  /*
   * QA's second review of #1031 (15 Nov 2026): the manager message before the current one counts as level evidence only
   * when the app's reply between the two showed THIS card; a first name names a person; payroll is the answer right after
   * the most recent reply showing this card.
   */
  {
    id: "nov15-agent-loop-pr1c-previous-message-needs-the-card-reply",
    title: "PR 1c (QA): \"she was written up before\", then \"ca for remy calder, late on 11/12\": no level (the reply between did not show this card)",
    report: `${REPORT}: the previous manager message counts only when the reply between showed this card`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const standIn = loopStandIn((view): LoopDecision => {
        const said = view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
        if (/^she was written up before/i.test(said)) return { text: "Noted." };
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!lastResult(view, "propose_form")) {
          return { tool: "propose_form", input: { template_key: "dpoa", employee_id: firstMatch(view)?.employee_id, what_happened: "Remy Calder was late on 11/12.", incident_date: "2026-11-12", warning_level: "written", level_evidence: evidenceFrom(view, "she was written up before", 1) } };
        }
        return { text: "Here is the card." };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      await thread.say("she was written up before");
      await thread.say("ca for remy calder, late on 11/12");
      const out = proposeOutputs(standIn.views).at(-1)!;
      expect(out.reason_code, JSON.stringify(out)).toBe("level_not_stated");
      expect(out.level_evidence).toBe("evidence_after_card");
      expect((out.card as { warning_level?: unknown }).warning_level ?? null).toBeNull();
    },
  },
  {
    id: "nov15-agent-loop-pr1c-level-kept-across-the-date-question",
    title: "PR 1c (QA): \"written ca for remy calder, she was late\", the app asks the date, \"11/12\": the written is kept",
    report: `${REPORT}: the request's level survives the card's own date question`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const standIn = loopStandIn((view): LoopDecision => {
        const said = view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
        if (/^written ca/i.test(said)) return { text: "What date was Remy Calder late?" };
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!lastResult(view, "propose_form")) {
          return { tool: "propose_form", input: { template_key: "dpoa", employee_id: firstMatch(view)?.employee_id, what_happened: "Remy Calder was late.", incident_date: "2026-11-12", warning_level: "written", level_evidence: evidenceFrom(view, "written ca for remy calder", 1) } };
        }
        return { text: "Here is the card." };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      await thread.say("written ca for remy calder, she was late");
      await thread.say("11/12");
      const out = proposeOutputs(standIn.views).at(-1)!;
      expect(out.reason_code, JSON.stringify(out)).toBeUndefined();
      expect((out.card as { warning_level?: unknown }).warning_level).toBe("written");
    },
  },
  {
    id: "nov15-agent-loop-pr1c-first-name-is-another-person",
    title: "PR 1c (QA): \"verbal for remy, late 11/9\" then \"now a ca for juno paxton, late on 11/12\": Juno has no level (a first name names Remy: other_person)",
    report: `${REPORT}: the person guard reads first and preferred names`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const standIn = loopStandIn((view): LoopDecision => {
        const said = view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
        const juno = /juno/i.test(said);
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: juno ? "juno paxton" : "remy calder" } };
        if (!lastResult(view, "propose_form")) {
          return {
            tool: "propose_form",
            input: {
              template_key: "dpoa", employee_id: firstMatch(view)?.employee_id, what_happened: juno ? "Juno Paxton was late on 11/12." : "Remy Calder was late on 11/9.", incident_date: juno ? "2026-11-12" : "2026-11-09",
              warning_level: "verbal", level_evidence: evidenceFrom(view, "verbal for remy", juno ? 1 : 0),
            },
          };
        }
        return { text: `Here's the card for **${juno ? "Juno Paxton" : "Remy Calder"}**.` };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      await thread.say("verbal for remy, late 11/9");
      expect(((proposeOutputs(standIn.views).at(-1)!.card) as { warning_level?: unknown }).warning_level, "Remy's own level").toBe("verbal");
      await thread.say("now a ca for juno paxton, late on 11/12");
      const out = proposeOutputs(standIn.views).at(-1)!;
      expect(out.reason_code, JSON.stringify(out)).toBe("level_not_stated");
      expect(out.level_evidence).toBe("other_person");
      expect((out.card as { warning_level?: unknown }).warning_level ?? null).toBeNull();
    },
  },
  {
    id: "nov15-agent-loop-pr1c-older-payroll-answer-is-not-a-new-cards",
    title: "PR 1c (QA): Remy \"yes\", \"thanks\", then \"another ca for remy calder, late on 11/14 too\": the new card has no payroll (evidence_after_card)",
    report: `${REPORT}: payroll is the current message, or the answer right after the most recent reply showing this card`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const standIn = loopStandIn((view): LoopDecision => {
        const said = view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
        if (/^thanks/i.test(said)) return { text: "You're welcome." };
        const again = /^another/i.test(said);
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!lastResult(view, "propose_form")) {
          const answered = /^yes/i.test(said) || again;
          return {
            tool: "propose_form",
            input: {
              template_key: "dpoa", employee_id: firstMatch(view)?.employee_id, what_happened: "Remy Calder was late.", incident_date: again ? "2026-11-14" : "2026-11-12",
              ...(answered ? { payroll_deduct: "yes", payroll_evidence: evidenceFrom(view, "yes", again ? 2 : 0) } : {}),
            },
          };
        }
        return { text: "Here's the Corrective Action Form for **Remy Calder**." };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      await thread.say("ca for remy calder, late on 11/12");
      // Changed on purpose (fix batch item 7, c163): a bare "yes" to "Payroll deduct and warning level aren't set" sets
      // neither; the answer says which, so this case still checks whose card a payroll answer belongs to.
      await thread.say("yes, payroll deduct");
      expect(((proposeOutputs(standIn.views).at(-1)!.card) as { payroll_deduct?: unknown }).payroll_deduct, "Remy's own answer").toBe("yes");
      await thread.say("thanks");
      await thread.say("another ca for remy calder, late on 11/14 too");
      const out = proposeOutputs(standIn.views).at(-1)!;
      expect(out.reason_code, JSON.stringify(out)).toBe("payroll_not_stated");
      expect(out.payroll_evidence).toBe("evidence_after_card");
      expect((out.card as { payroll_deduct?: unknown }).payroll_deduct ?? null).toBeNull();
    },
  },
];
