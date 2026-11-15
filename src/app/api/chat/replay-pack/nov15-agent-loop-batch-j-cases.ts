import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn } from "./loop-stand-in";

/**
 * ============================================================================
 * BATCH J: QA'S LIVE RE-RUN, PART 1 (15 Nov 2026; main f6c3a3ca, batches F and H live)
 * ============================================================================
 *
 * Each case uses the manager's words from the re-run, with the people invented (Juno Paxton is STAFF's), and runs
 * through the real chat route with the loop on for this case's manager.
 */
const REPORT = "QA, batch J (15 Nov 2026): the live re-run, part 1";
const FLAG = "AGENT_LOOP_ENABLED";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-15T05:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV15_AGENT_LOOP_BATCH_J_CASES: ReplayCase[] = [
  {
    id: "nov15-batch-j1-policy-line-with-source-marker-is-the-card",
    title: "J1: a reply whose Policy line is the card's own line with a source marker (\"… p.12 [S1]\") is never replaced by \"That change isn't on the card yet\"",
    report: `${REPORT}; L4 t1 (19.9s): "That change isn't on the card yet: policy (Standards of Conduct Policy, JBA Policy Manual p.12). Tell me again…" while the card had that policy`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      // The model's reply as the live one wrote it: the card's Policy line, then the source marker of read_policy.
      const model = loopStandIn((view) => {
        const card = (lastResult(view, "propose_form") as { card?: { policy?: string | null } } | undefined)?.card;
        if (!card) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-3", policy: "Standards of Conduct" } };
        return { text: `Here's the Corrective Action Form for **Juno Paxton**.\n\nWhat happened?\n\n**Policy:** ${card.policy} [S1]` };
      });
      t.loopModel!(model);
      const reply = await thread.say("create a CA for salon director, juno paxton for violating the standards of conduct");
      expect(thread.proposal, "no CA card for Juno Paxton").toMatchObject({ templateKey: "dpoa", employeeName: "Juno Paxton" });
      expect(reply.content, "a good reply was replaced by a false self-check").not.toMatch(/isn't on the card yet/);
      expect(reply.content).toMatch(/\*\*Policy:\*\* Standards of Conduct Policy, JBA Policy Manual p\.12/);
    },
  },
  {
    id: "nov15-batch-j5-late-to-open-is-late-opening",
    title: "J5: \"CA for <name>, ASD, late to open 11/12\" cites Late Opening, never Attendance; \"late for her opening shift\" stays Attendance",
    report: `${REPORT}; "late to open" cited Attendance p.14, where today's chat and #786 (FAILURE_TO_OPEN_IS_LATE_OPENING) give Late Opening p.15`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      // The model's first pick, as the live one made it: Attendance. It proposes again with what propose_form says.
      const model = loopStandIn((view) => {
        const result = lastResult(view, "propose_form") as { card?: unknown; error?: string } | undefined;
        if (!result) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-3", policy: "Attendance", what_happened: "Late opening the salon on 11/12." } };
        if (result.error && /Late Opening/.test(result.error)) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-3", policy: "Late Opening", what_happened: "Late opening the salon on 11/12." } };
        return { text: "Here's the Corrective Action Form for **Juno Paxton**." };
      });
      const thread = start(t);
      t.loopModel!(model);
      await thread.say("CA for juno paxton, ASD, late to open 11/12");
      const policy = (thread.proposal as { policyLine?: string | null } | undefined)?.policyLine ?? "";
      expect(policy, "\"late to open\" was cited as Attendance").toMatch(/^Late Opening Policy, JBA Policy Manual p\.15/);

      // Late FOR a shift is Attendance, as today's chat reads it: never refused.
      const shift = start(t);
      const kept = loopStandIn((view) =>
        lastResult(view, "propose_form") ? { text: "Here is the card." } : { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-3", policy: "Attendance", what_happened: "Late for her opening shift on 11/12." } },
      );
      t.loopModel!(kept);
      await shift.say("CA for juno paxton, ASD, she was late for her opening shift 11/12");
      expect((shift.proposal as { policyLine?: string | null } | undefined)?.policyLine ?? "").toMatch(/^Attendance Policy/);
    },
  },
  {
    id: "nov15-batch-j-h1-yes-payroll-but-amount-unknown",
    title: "H1 follow-up: \"yes payroll but I don't know the amount\" is payroll Yes with the amount left blank, never \"tell me the figure\"",
    report: `${REPORT}; the late-to-open conversation's second turn: "yes payroll but I don't know the amount" got "The payroll deduction amount isn't set; tell me the figure if there is one."`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const model = loopStandIn((view) =>
        lastResult(view, "propose_form")
          ? { text: "Here is the card." }
          : { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-3", policy: "Late Opening", what_happened: "Late opening the salon on 11/12.", payroll_deduct: /payroll/i.test(view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "") ? "yes" : undefined } },
      );
      const thread = start(t);
      t.loopModel!(model);
      await thread.say("CA for juno paxton, ASD, late to open 11/12");
      await thread.say("yes payroll but I don't know the amount");
      const facts = (model.views.flatMap((view) => view.results).filter((result) => result.tool === "propose_form").at(-1)?.output as { facts?: Record<string, unknown> } | undefined)?.facts ?? {};
      expect(facts.payroll_amount_unknown, "the unknown amount was not a fact").toBe(true);
      expect(facts.payroll_amount_unset, "the amount was asked for").toBeUndefined();
    },
  },
  {
    id: "nov15-batch-j4-yes-to-the-name-never-repeats-what-happened",
    title: "J4: \"create a corrective action form for <misspelled name>\" → \"Using <name> from your staff list … What happened?\" → \"Yes\": the question is a fact, never asked again word for word",
    report: `${REPORT}; L5: after "Yes", the reply was the same card and "What happened?" again (E2: never repeat a question word for word)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      // The model as the rules book teaches it: the asked-before fact makes it acknowledge and ask another way.
      const model = loopStandIn((view) => {
        const result = lastResult(view, "propose_form") as { facts?: { question_asked_before?: string } } | undefined;
        if (!result) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-1" } };
        return result.facts?.question_asked_before
          ? { text: "Got it, **Marnie Holloway**. Tell me what Marnie did, and when." }
          : { text: "Using **Marnie Holloway** from your staff list.\n\nHere's the Corrective Action Form for **Marnie Holloway**.\n\nWhat happened?" };
      });
      const thread = start(t);
      t.loopModel!(model);
      const first = await thread.say("create a corrective action form for Marnie Holoway");
      expect(first.content).toMatch(/What happened\?/);
      const again = await thread.say("Yes");
      const facts = (model.views.flatMap((view) => view.results).filter((result) => result.tool === "propose_form").at(-1)?.output as { facts?: Record<string, unknown> } | undefined)?.facts ?? {};
      expect(facts.question_asked_before, "the question just asked was not a fact").toBe("What happened?");
      expect(again.content, "\"What happened?\" was asked again word for word").not.toMatch(/What happened\?/);
    },
  },
  {
    id: "nov15-batch-j3-step-limit-names-what-was-not-saved",
    title: "J3: \"make it a written and yes payroll $15\" on an open draft, saved without the $15 and stopped at the step limit: the reply says the $15 is not saved",
    report: `${REPORT}; 9b (38s): payroll yes saved, the $15 not, the step limit hit, and the reply never said the $15 was not saved`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      let draftId = "";
      // The live turn's shape: the level and payroll written, then reads until the step limit; the amount never written.
      const model = loopStandIn((view) => {
        const said = view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
        if (/payroll \$15/.test(said)) {
          if (!lastResult(view, "edit_form")) return { tool: "edit_form", input: { instance_id: draftId, values: { warning_type: "written", payroll_deduct: "yes" } } };
          return { tool: "read_form", input: { instance_id: draftId } };
        }
        return lastResult(view, "propose_form")
          ? { text: "Here is the card." }
          : { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-3", policy: "Late Opening", what_happened: "Late opening the salon on 11/12." } };
      });
      const thread = start(t);
      t.loopModel!(model);
      await thread.say("CA for juno paxton, ASD, late to open 11/12");
      t.draftWrites({ observation: "Observed:\nJuno Paxton opened the salon late on 11/12." });
      draftId = await thread.create();
      const reply = await thread.say("make it a written and yes payroll $15");
      // Payroll on a draft is G5's (batch G); until it lands, payroll Yes is not written either, and the reply says so too.
      expect(reply.content, "the reply never said the $15 was not saved").toMatch(/Not saved yet: [^\n]*\*\*Payroll deduction amount\*\* \(\$15\)/);
      expect(reply.content).not.toMatch(/What's the one thing still left\?/);
      expect(reply.content, "the saved level was listed as not saved").not.toMatch(/\*\*Type of Warning\*\* \(Written/);
      expect(reply.content).toMatch(/I saved the change on the form: warning type\./);
    },
  },
];
