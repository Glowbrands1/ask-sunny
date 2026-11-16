import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE REPLY REVIEWS ITSELF AGAINST THE CARD (QA's urgent regression, 14 Nov 2026)
 * ============================================================================
 *
 * Live on Pau's account after batch A: "make it a written" on a card not yet created was answered "**Type of
 * Warning:** Written Warning, as you said." with no new card, so the card had no level and Create would have saved
 * the form without it. Pau asked: does it review its own work? These cases hold the self-review in `run.ts`: a
 * reply's stated card fields are checked against the card; a difference is handed back to the model once with the
 * card's facts; only a second miss says plainly that the change is not on the card yet. A turn with no difference
 * costs no extra model call.
 *
 * QA's wording is kept; the employee is invented (the live chat's person is not named here).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA, 14 Nov 2026 (urgent: batch A, live on Pau's account, chat conv_mwgtunfd2ev7rau)";
const TAMSIN: DirectoryRow = { id: "e-tamsin-orwell", firstName: "Tamsin", lastName: "Orwell", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

const T1 = "please make a ca for tamsin orwel for not doing th e10 minute sanitaion";
const T2 = "yes payroll, $20";
const T3 = "make it a written";

const said = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").map((turn) => turn.text).join("\n");
const latest = (view: LoopView) => [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";
const checked = (view: LoopView) => /\[app check\]/.test(latest(view));

/**
 * A model that answers the card's questions. `fixes` decides whether it calls propose_form when the app hands its reply
 * back; `skips` is the manager's message it answers in words only (the live failure).
 */
function cardModel(options: { skips: RegExp; fixes: boolean; extra?: (view: LoopView) => Record<string, unknown> }) {
  return loopStandIn((view): LoopDecision => {
    const all = said(view);
    const now = latest(view);
    const review = checked(view);
    const fields = {
      template_key: "dpoa",
      what_happened: "Tamsin Orwell did not do the 10-minute sanitation.",
      ...(/\$20/.test(all) ? { payroll_deduct: "yes", payroll_amount: "20", payroll_evidence: evidenceFrom(view) } : {}),
      ...(/written/.test(all) ? { warning_level: "written", level_evidence: evidenceFrom(view) } : {}),
      ...(options.extra?.(view) ?? {}),
    };
    const skip = options.skips.test(review ? view.turns.filter((turn) => turn.role === "user").at(-2)?.text ?? "" : now) && !(review && options.fixes);
    if (!skip) {
      if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "tamsin orwel" } };
      if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { ...fields, employee_id: TAMSIN.id } };
      // ruling (b), QA 17 Nov: a typed full name whose last name differs from the staff list's is asked, never seated.
      // A model told to ask (the card refused with ask_exactly: "Did you mean **Tamsin Orwell**?") asks it, and nothing else.
      const refused = lastResult(view, "propose_form") as { reason_code?: string; ask_exactly?: string } | null;
      if (refused?.reason_code && refused.ask_exactly) return { text: refused.ask_exactly };
    }
    const lines = [
      "Here's the Corrective Action Form for **Tamsin Orwell**.",
      "**Observation of Offense:** Tamsin Orwell did not do the 10-minute sanitation.",
      ...(/written/.test(all) ? ["**Type of Warning:** Written Warning, as you said."] : []),
      ...(/\$20/.test(all) ? ["**Is payroll deduct applicable?** Yes, as you said. **Payroll deduction amount:** $20."] : []),
      ...(options.extra ? [String(options.extra(view).say ?? "")] : []),
    ].filter(Boolean);
    return { text: lines.join("\n\n") };
  });
}

export const NOV14_AGENT_LOOP_SELF_REVIEW_CASES: ReplayCase[] = [
  {
    id: "nov14-agent-loop-self-review-written-reaches-card",
    title: "QA's 3 turns (\"please make a ca for … not doing th e10 minute sanitaion\", \"yes payroll, $20\", \"make it a written\"): a reply that says Written Warning with no new card is handed back once with the card's facts, the model proposes the card again, and the card carries written, payroll yes and $20",
    report: `${REPORT}: "the reply says Type of Warning: Written Warning, as you said but the response carries NO formProposal"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, TAMSIN]);
      t.as("salon_director", KEARNEY);
      const model = cardModel({ skips: /make it a written/, fixes: true });
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say(T1);
      // ruling (b), QA 17 Nov: a typed full name whose last name differs from the staff list's is asked, never seated.
      await thread.say("yes");
      const payroll = await thread.say(T2);
      expect(payroll.formProposal, "the payroll answer did not re-propose the card").toMatchObject({ payrollDeduct: "yes", payrollDeductAmount: "20" });
      expect(model.views.some(checked), "a matching reply was handed back").toBe(false);
      const written = await thread.say(T3);
      expect(model.views.some(checked), "the reply was not handed back").toBe(true);
      expect(written.formProposal, `no card after "make it a written":\n${written.content}`).toMatchObject({ warningLevel: "written", payrollDeduct: "yes", payrollDeductAmount: "20" });
      expect(written.content).not.toMatch(/isn't on the card yet/);
      expect(model.views.filter(checked).at(0)?.turns.at(-1)?.text ?? "", "the card's facts were not given").toMatch(/Card now: \{"card_this_turn":null\}|warning level \(written\)/);
    },
  },
  {
    id: "nov14-agent-loop-self-review-second-miss-says-so",
    title: "a model that still answers in words after the hand-back: the reply says plainly the change is not on the card yet, and never claims it",
    report: `${REPORT}: "only if that fails, say plainly that it isn't on the card yet"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, TAMSIN]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(cardModel({ skips: /make it a written/, fixes: false }));
      const thread = t.thread();
      await thread.say(T1);
      // ruling (b), QA 17 Nov: a typed full name whose last name differs from the staff list's is asked, never seated.
      await thread.say("yes");
      await thread.say(T2);
      const written = await thread.say(T3);
      expect(written.formProposal ?? null).toBeNull();
      expect(written.content, "the reply still claims the level").not.toMatch(/Written Warning, as you said/);
      expect(written.content).toMatch(/That change isn't on the card yet: warning level \(written\)/);
    },
  },
  {
    id: "nov14-agent-loop-self-review-date-and-policy",
    title: "QA's pre-create date and policy changes (\"change the date to 11/4\", \"make it attendance instead\"): a reply that states the new date or policy with no new card is handed back and the card is proposed again with it",
    report: `${REPORT}: "cover it with … a pre-create level, date and policy-change case"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, TAMSIN]);
      t.as("salon_director", KEARNEY);
      const dated = cardModel({
        skips: /change the date/,
        fixes: true,
        extra: (view) => (/11\/4/.test(said(view)) ? { incident_date: "2026-11-04", what_happened: "On 11/4, Tamsin Orwell did not do the 10-minute sanitation.", say: "Dated 11/4 (when it happened)." } : {}),
      });
      t.loopModel!(dated);
      const one = t.thread();
      await one.say(T1);
      // ruling (b), QA 17 Nov: a typed full name whose last name differs from the staff list's is asked, never seated.
      await one.say("yes");
      const date = await one.say("change the date to 11/4");
      expect(date.formProposal?.formDate, `the date did not reach the card:\n${date.content}`).toBe("2026-11-04");

      const policied = cardModel({
        skips: /attendance instead/,
        fixes: true,
        extra: (view) => {
          if (!/attendance instead/.test(said(view))) return {};
          const heading = headingWith(view, /attendance/i) ?? "Attendance";
          return { policy: heading, what_happened: "Tamsin Orwell was late for her shift on 11/12.", say: `**Policy:** ${heading} Policy, JBA Policy Manual` };
        },
      });
      t.loopModel!(policied);
      const two = t.thread();
      await two.say("ca for tamsin orwell, she was late for her shift on 11/12");
      const policy = await two.say("make it attendance instead");
      expect((policy.formProposal as { policyLine?: string | null } | undefined)?.policyLine ?? "", `the policy did not reach the card:\n${policy.content}`).toMatch(/^Attendance/);
    },
  },
];
