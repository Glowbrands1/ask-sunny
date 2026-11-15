import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn } from "./loop-stand-in";

/**
 * ============================================================================
 * BATCH J, KEPT (QA, 15 Nov 2026): the items the agent-loop rebuild keeps (docs/agent-loop/rebuild-plan.md)
 * ============================================================================
 *
 * Each case uses the manager's words from the re-run, with the people invented (Juno Paxton is STAFF's), and runs
 * through the real chat route with the loop on for this case's manager.
 */
const REPORT = "QA, batch J (15 Nov 2026): the live re-run, part 1";
/*
 * Live (AGENT_LOOP_LIVE=1) the real model takes the stand-in's place, so a check of a state only the stand-in forces
 * (the step limit, a hand-back, a lookup the rules book now says to skip) runs offline only, as nov14-live-r5's do.
 */
const offline = process.env.AGENT_LOOP_LIVE !== "1";
const FLAG = "AGENT_LOOP_ENABLED";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-15T05:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV15_AGENT_LOOP_BATCH_J_KEEP_CASES: ReplayCase[] = [
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
          : { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-3", policy: "Late Opening", what_happened: "Late opening the salon on 11/12.", payroll_deduct: /payroll/i.test(view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "") ? "yes" : undefined, payroll_evidence: evidenceFrom(view) } },
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
    id: "nov15-batch-j8-hand-back-asks-as-the-turn-did",
    title: "J8: the self-check hand-back asks with the turn's own thinking and effort, and marks its last message for the cache",
    report: `${REPORT}; J6's speed report: the J1 hand-back read 3838 input tokens with nothing from the cache`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      // A reply that says a level the card does not hold, so the self-check hands it back once.
      const model = loopStandIn((view) => {
        if (/\[app check\]/.test(view.turns.at(-1)?.text ?? "")) return { text: "Here's the Corrective Action Form for **Juno Paxton**.\n\n**Type of Warning:** Verbal Warning, as you said." };
        return lastResult(view, "propose_form")
          ? { text: "Here's the Corrective Action Form for **Juno Paxton**.\n\n**Type of Warning:** Written Warning, as you said." }
          : { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-3", policy: "Late Opening", warning_level: "verbal", level_evidence: evidenceFrom(view), what_happened: "Late opening the salon on 11/12." } };
      });
      const thread = start(t);
      t.loopModel!(model);
      await thread.say("verbal CA for juno paxton, ASD, late to open 11/12");
      if (!offline) return;
      const handBack = model.views.findIndex((view) => /\[app check\]/.test(view.turns.at(-1)?.text ?? ""));
      expect(handBack, "no hand-back ran").toBeGreaterThan(0);
      expect(model.providerOptions[handBack], "the hand-back asked with other provider options than the turn").toEqual(model.providerOptions[0]);
      const prompt = model.prompts[handBack] as { providerOptions?: { anthropic?: { cacheControl?: unknown } } }[];
      expect(prompt.at(-1)?.providerOptions?.anthropic?.cacheControl, "the hand-back's last message is not marked for the cache").toEqual({ type: "ephemeral" });
    },
  },
  {
    id: "nov15-batch-j9-what-happened-is-the-managers-account",
    title: "J9: propose_form's what_happened is no longer than the manager's own account plus a small margin (the stand-in offline, the real model with AGENT_LOOP_LIVE_ALL)",
    report: `${REPORT}; J6's speed report: one step wrote 1446 output tokens of retyped account into propose_form`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const account = "she was 20 minutes late on 11/9/26 and did not call ahead";
      // Offline, a model that follows the rules book's line; live, the real model is held to the same bound.
      const model = loopStandIn((view) =>
        lastResult(view, "propose_form")
          ? { text: "Here's the Corrective Action Form for **Remy Calder**." }
          : { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", policy: "Attendance", warning_level: "verbal", level_evidence: evidenceFrom(view), what_happened: `Remy Calder ${account.replace(/^she /, "")}.` } },
      );
      const thread = start(t);
      t.loopModel!(model);
      await thread.say(`verbal ca for remy calder, ${account}`);
      const issue = thread.proposal?.issue ?? "";
      expect(issue, "no account on the card").not.toBe("");
      // The manager's account, the person's full name in front and a little punctuation: never an expanded retelling.
      expect(issue.length, `what_happened was retyped longer than the account:\n${issue}`).toBeLessThanOrEqual(account.length + "Remy Calder ".length + 20);
    },
  },
  {
    id: "nov15-batch-j-amount-unknown-after-but-todays-path",
    title: "today's chat: \"yes payroll but I don't know the amount\" is payroll Yes with the amount left blank, never asked for; \"yes payroll but only for the shift\" is not an unknown amount",
    report: `${REPORT}; QA: fix the shared reader (saysAmountUnknown) so today's chat reads it too`,
    status: "fixed",
    fixFlags: ["AMOUNT_UNKNOWN_ACK_ENABLED"],
    async run(t) {
      const thread = start(t);
      await thread.say("verbal ca for remy calder, she was 20 minutes late on 11/9/26");
      const reply = await thread.say("yes payroll but I don't know the amount");
      expect(reply.content, "the amount was not acknowledged as unknown").toContain("Noted — I'll leave the **Payroll deduction amount** blank for you to fill on the form once you know it.");
      expect(reply.content, "the amount was asked for after the manager said it is not known").not.toContain("One more question: **Payroll deduction amount**?");
      expect((thread.proposal as { payrollDeduct?: string | null } | undefined)?.payrollDeduct).toBe("yes");

      // A clause after "but" that is not about the amount is no unknown amount: the amount question stays.
      const other = start(t);
      await other.say("verbal ca for remy calder, she was 20 minutes late on 11/9/26");
      const asked = await other.say("yes payroll but only for the shift");
      expect(asked.content).not.toContain("I'll leave the **Payroll deduction amount** blank");
    },
  },
  {
    id: "nov15-batch-j-payroll-answer-not-observation-todays-path",
    title: "today's chat: the payroll answer \"yes payroll but I don't know the amount\" is never written into the card's Observation",
    report: `${REPORT}; seen in the amount reader's case: the Observation read "she was 20 minutes late on 11/9/26 yes payroll but I don't know the amount"`,
    status: "fixed",
    fixFlags: ["PAYROLL_CLAUSE_NOT_ACCOUNT_ENABLED"],
    async run(t) {
      const thread = start(t);
      await thread.say("verbal ca for remy calder, she was 20 minutes late on 11/9/26");
      for (const answer of ["yes payroll but I don't know the amount", "yes payroll"]) {
        const reply = await thread.say(answer);
        const observation = /\*\*Observation of Offense:\*\*([^\n]*)/.exec(reply.content)?.[1] ?? "";
        expect(observation, `"${answer}" was written into the Observation`).not.toMatch(/payroll|know the amount/i);
        expect(observation).toMatch(/20 minutes late on 11\/9\/26/);
        expect(thread.proposal?.issue ?? "", `"${answer}" is in the card's account`).not.toMatch(/payroll|know the amount/i);
      }
    },
  },
  {
    id: "nov15-j-keep-review-unknown-amount-of-something-else-todays-path",
    title: "today's chat: an unknown amount of time, of a drawer shortage or of a total is never the payroll amount; the amount question stays",
    report: "QA's #1028 review (MEDIUM, 15 Nov 2026): saysAmountUnknown read any clause, so these replaced the payroll amount question with \"Noted — I'll leave the Payroll deduction amount blank\"",
    status: "fixed",
    fixFlags: ["AMOUNT_UNKNOWN_ACK_ENABLED"],
    async run(t) {
      for (const said of ["she was late, but I don't know the amount of time", "she was short on the drawer, not sure of the amount", "verbal for Remy, she was $40 short, idk the total"]) {
        const thread = start(t);
        await thread.say("verbal ca for remy calder, she was 20 minutes late on 11/9/26");
        await thread.say("yes payroll");
        const reply = await thread.say(said);
        expect(reply.content, `"${said}" was read as the payroll amount`).not.toContain("I'll leave the **Payroll deduction amount** blank");
      }
      // The positive: the payroll answer and the not-known amount in one message.
      const thread = start(t);
      await thread.say("verbal ca for remy calder, she was 20 minutes late on 11/9/26");
      const reply = await thread.say("yes payroll but I don't know the amount");
      expect(reply.content).toContain("Noted — I'll leave the **Payroll deduction amount** blank for you to fill on the form once you know it.");
    },
  },
  {
    id: "nov15-j-keep-review-payroll-reader-keeps-lines-todays-path",
    title: "today's chat: the payroll reader keeps the manager's line breaks, so a request line or a state line on its own line never joins the account",
    report: "QA's #1028 review (HIGH, 15 Nov 2026): withoutPayrollClauses joined lines with \" \", so \"she was late on 11/9\\ncan you make it a written\" lost the account and \"Policy reference: Attendance\" went into the Observation",
    status: "fixed",
    fixFlags: ["PAYROLL_CLAUSE_NOT_ACCOUNT_ENABLED"],
    async run(t) {
      for (const [said, never] of [
        ["verbal ca for remy calder\nshe was late on 11/9\ncan you make it a written", /make it a written/i],
        ["verbal ca for remy calder\nshe was late on 11/9\nPolicy reference: Attendance", /Policy reference/i],
      ] as const) {
        const thread = start(t);
        const reply = await thread.say(said);
        const issue = /\*\*Observation of Offense:\*\*([^\n]*)/.exec(reply.content)?.[1] ?? "";
        expect(issue, `the account was lost from ${JSON.stringify(said)}`).toMatch(/late on 11\/9/);
        expect(issue, `a line that is not the account joined it: ${issue}`).not.toMatch(never);
      }
    },
  },
];
