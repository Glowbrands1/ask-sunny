import { expect, vi } from "vitest";

import { TESTY, TESTY_ACCOUNT } from "@/lib/ai/agent-loop/phrasing-table";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE ANSWER TO "WHICH ONE?" CARRIES THE REQUEST'S EDIT (QA's live re-test, 16 Nov 2026, main 269ac0d9)
 * ============================================================================
 *
 * Test Testy (the test employee) has two Corrective Actions dated 11/10 on file, one draft and one finalized:
 * - dateedit: T1 "the corrective action for test testy, change the date to 11/09/2026" → "Which one should I open?";
 *   T2 "the 11/10 one" → "Two forms are dated 11/10, one a draft, one finalized. Which one?"; T3 "the finalized one"
 *   opened the revision draft but asked "Could you confirm the date again?" (a date stated at T1).
 * - paycheck: T1 "on the 11/10 corrective action for test testy, tick payroll deduct" → "Which one?"; "the finalized
 *   one" → "I wasn't able to save the payroll deduct change …", and the amount was never asked.
 * Cause: edit_form took a typed date only from this message or the one right before it (#1062), and level/payroll
 * evidence only from this message. General rule: the turns of the OPEN request this message finishes (each answered by
 * a loop turn that saved nothing and made no card, per the trace records) carry their edit to the answer turn, with
 * this message's evidence rules; a finished request's never do. Then #1063's payroll_amount_missing asks the amount.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's live re-test (16 Nov 2026, main 269ac0d9): the answer to a which-form question dropped the request's edit";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

const TEST_TESTY: DirectoryRow = { id: TESTY.id, firstName: TESTY.firstName, lastName: TESTY.lastName, preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const said = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
const results = (views: readonly LoopView[], tool: string) => views.flatMap((view) => view.results.filter((result) => result.tool === tool)).map((result) => result.output);

type Forms = { id: string; status?: string; form_date?: string | null; revises_instance_id?: string | null }[];
type Edit = { saved?: { field: string }[]; reason_code?: string; refused_reason_code?: string; refused?: { field: string; reason_code: string }[]; payroll_amount_missing?: { ask_exactly: string }; revision_draft?: { id: string } };

/** Test Testy's Corrective Actions on file: 11/10 finalized, 11/10 draft, 11/12 finalized. Returns their ids. */
async function onFile(t: ReplayContext): Promise<{ tenthFinal: string; tenthDraft: string; twelfth: string }> {
  vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
  t.directory([...STAFF, TEST_TESTY]);
  t.as("salon_director", KEARNEY);
  const made: string[] = [];
  for (const [date, finalized] of [["2026-11-10", true], ["2026-11-10", false], ["2026-11-12", true]] as const) {
    t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form") ? { text: "Here's the card." } : { tool: "propose_form", input: { template_key: "dpoa", employee_id: TESTY.id, what_happened: TESTY_ACCOUNT, incident_date: date } })));
    const setup = t.thread();
    await setup.say(`ca for test testy, she was late to open the salon on ${date.slice(5).replace("-", "/")}`);
    const id = await setup.create();
    Object.assign(t.forms().find((row) => row.id === id)!, { status: finalized ? "finalized" : "draft", form_date: date });
    made.push(id);
  }
  return { tenthFinal: made[0]!, tenthDraft: made[1]!, twelfth: made[2]! };
}

/**
 * A stand-in for the live model: it asks "which one?" until the manager singles out a form, then opens it and makes the
 * edit with the manager's words from the request's FIRST message as its evidence (as the live model did).
 */
function whichThenEdit(first: string, ids: () => { tenthFinal: string }, edit: (view: LoopView) => Record<string, unknown>) {
  return loopStandIn((view): LoopDecision => {
    const text = said(view);
    const back = view.turns.filter((turn) => turn.role === "user").length - 1;
    if (!/finalized one/i.test(text)) {
      if (!lastResult(view, "find_past_forms")) return { tool: "find_past_forms", input: { employee_name: "Test Testy", form: "dpoa", open: true, ...(/11\/10/.test(text) ? { date: "11/10" } : {}), forms_on_file_evidence: evidenceFrom(view, first, back) } };
      return { text: /11\/10/.test(text) ? "Two forms are dated 11/10, one a draft and one finalized. Which one?" : "Which one should I open?" };
    }
    // Changed on purpose (port from Ask Bubbles 1b34db2, A11): after "Which one should I open?" the open passes the manager's pick from this message (choice_evidence); the expectations are unchanged.
    if (!lastResult(view, "open_form")) return { tool: "open_form", input: { instance_id: ids().tenthFinal, forms_on_file_evidence: evidenceFrom(view, first, back), choice_evidence: evidenceFrom(view) } };
    const edits = results([view], "edit_form") as Edit[];
    if (edits.length >= 2 || edits.some((row) => (row.saved?.length ?? 0) > 0)) {
      const done = edits.find((row) => (row.saved?.length ?? 0) > 0);
      return { text: done ? ["Saved on the draft.", done.payroll_amount_missing?.ask_exactly].filter(Boolean).join("\n\n") : "I wasn't able to save that change. Could you confirm it again?" };
    }
    const revision = edits.map((row) => row.revision_draft?.id).find(Boolean);
    return { tool: "edit_form", input: { instance_id: revision ?? ids().tenthFinal, ...edit(view) } };
  });
}

export const NOV16_WHICH_FORM_ANSWER_CARRIES_CASES: ReplayCase[] = [
  {
    id: "nov16-which-form-answer-carries-date-dateedit",
    title: "dateedit: \"the corrective action for test testy, change the date to 11/09/2026\" → which one; \"the 11/10 one\" → two dated 11/10, which one; \"the finalized one\" saves 11/09/2026 on its revision draft, never asking the date again",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      let ids = { tenthFinal: "", tenthDraft: "", twelfth: "" };
      ids = await onFile(t);
      const standIn = whichThenEdit("the corrective action for test testy", () => ids, () => ({ values: { form_date: "11/09/2026" } }));
      t.loopModel!(standIn);
      const thread = t.thread();
      await thread.say("the corrective action for test testy, change the date to 11/09/2026");
      await thread.say("the 11/10 one");
      const reply = await thread.say("the finalized one");
      const edits = results(standIn.views, "edit_form") as Edit[];
      expect(edits.flatMap((row) => [row.reason_code, row.refused_reason_code]), JSON.stringify(edits)).not.toContain("date_not_stated");
      const revision = (t.forms() as Forms).find((row) => row.revises_instance_id === ids.tenthFinal);
      expect(revision?.form_date, `the date stated at T1 was not saved:\n${reply.content}`).toBe("2026-11-09");
      expect(reply.content).not.toMatch(/confirm the date|couldn't|wasn't able/i);
      expect((t.forms() as Forms).find((row) => row.id === ids.tenthDraft)?.form_date, "the 11/10 draft was changed instead").toBe("2026-11-10");
    },
  },
  {
    id: "nov16-which-form-answer-carries-payroll-paycheck",
    title: "paycheck: \"on the 11/10 corrective action for test testy, tick payroll deduct\" → two dated 11/10, which one; \"the finalized one\" saves Payroll = Yes on its revision draft and asks the amount once (payroll_amount_missing)",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      let ids = { tenthFinal: "", tenthDraft: "", twelfth: "" };
      ids = await onFile(t);
      const first = "on the 11/10 corrective action for test testy, tick payroll deduct";
      const standIn = whichThenEdit(first, () => ids, (view) => ({ values: { payroll_deduct: "yes" }, payroll_evidence: evidenceFrom(view, "tick payroll deduct", view.turns.filter((turn) => turn.role === "user").length - 1) }));
      t.loopModel!(standIn);
      const thread = t.thread();
      await thread.say(first);
      const reply = await thread.say("the finalized one");
      const edits = results(standIn.views, "edit_form") as Edit[];
      const revision = (t.forms() as Forms).find((row) => row.revises_instance_id === ids.tenthFinal);
      expect(revision, "no revision draft was opened").toBeTruthy();
      expect(t.checked(revision!.id).payroll_deduct, `the payroll answer from T1 was not saved:\n${JSON.stringify(edits)}`).toEqual(["yes"]);
      expect(reply.content).not.toMatch(/wasn't able|can only apply/i);
      expect(reply.content, "the amount was not asked").toMatch(/Payroll deduction amount/);
    },
  },
  {
    id: "nov16-which-form-answer-finished-request-payroll-not-carried",
    title: "Control: a FINISHED request's payroll answer (\"tick payroll deduct on test testy's 11/12 ca\", saved) never carries to the next request (\"open test testy's 11/10 ca, the finalized one\"): payroll_not_stated, and the 11/10 form's payroll stays unset",
    report: `${REPORT}; only an OPEN request's turns carry (QA's review of #1062)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      const ids = await onFile(t);
      const standIn = loopStandIn((view): LoopDecision => {
        const text = said(view);
        const twelfth = /11\/12 ca/.test(text);
        const target = twelfth ? ids.twelfth : ids.tenthFinal;
        const ask = twelfth ? "tick payroll deduct on test testy's 11/12 ca" : "open test testy's 11/10 ca";
        if (!lastResult(view, "open_form")) return { tool: "open_form", input: { instance_id: target, forms_on_file_evidence: evidenceFrom(view, ask) } };
        if (!lastResult(view, "edit_form")) {
          const back = twelfth ? 0 : 1;
          return { tool: "edit_form", input: { instance_id: target, values: { payroll_deduct: "yes" }, payroll_evidence: evidenceFrom(view, "tick payroll deduct", back) } };
        }
        return { text: "Done." };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      await thread.say("tick payroll deduct on test testy's 11/12 ca");
      const first = results(standIn.views, "edit_form")[0] as Edit;
      expect(first.saved?.map((row) => row.field), "the finished request's payroll was not saved (the case proves nothing)").toContain("payroll_deduct");
      await thread.say("open test testy's 11/10 ca, the finalized one");
      const second = results(standIn.views, "edit_form").at(-1) as Edit;
      expect([second.reason_code, second.refused_reason_code], JSON.stringify(second)).toContain("payroll_not_stated");
      const onTenth = (t.forms() as Forms).filter((row) => row.id === ids.tenthFinal || row.revises_instance_id === ids.tenthFinal);
      expect(onTenth.map((row) => t.checked(row.id).payroll_deduct ?? null), "an earlier request's payroll went on the next form").not.toContainEqual(["yes"]);
    },
  },
];

/*
 * QA (16 Nov 2026): the same two chats as production sends them. The first message's trace had a null conversation_id
 * and the history's message ids did not match the trace's, so T1's turn record was found only through #1075's lookup.
 * T2 and T3 go with the history renumbered (as in #1075's live cases); openRequestTurns finds the open request through
 * `replyTurns`, the same lookup, so the request's edit still carries.
 */
const renumbered = (thread: { conversation?: readonly { id: string; role: string; content: string }[] }) =>
  (thread.conversation ?? []).map((message) => ({ id: `prod-${message.id}`, role: message.role, content: message.content }));

NOV16_WHICH_FORM_ANSWER_CARRIES_CASES.push(
  {
    id: "nov16-which-form-answer-carries-date-dateedit-production-ids",
    title: "dateedit with production's message ids (renumbered history, T1's record found by #1075's lookup): \"the finalized one\" still saves 11/09/2026 on the revision draft",
    report: `${REPORT}; with #1075's record lookup`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      let ids = { tenthFinal: "", tenthDraft: "", twelfth: "" };
      ids = await onFile(t);
      t.loopModel!(whichThenEdit("the corrective action for test testy", () => ids, () => ({ values: { form_date: "11/09/2026" } })));
      const thread = t.thread();
      await thread.say("the corrective action for test testy, change the date to 11/09/2026");
      await thread.say("the 11/10 one", {}, { history: renumbered(thread) });
      const reply = await thread.say("the finalized one", {}, { history: renumbered(thread) });
      const revision = (t.forms() as Forms).find((row) => row.revises_instance_id === ids.tenthFinal);
      expect(revision?.form_date, `the date stated at T1 was not saved:\n${reply.content}`).toBe("2026-11-09");
    },
  },
  {
    id: "nov16-which-form-answer-carries-payroll-paycheck-production-ids",
    title: "paycheck with production's message ids (renumbered history): \"the finalized one\" still saves Payroll = Yes and asks the amount",
    report: `${REPORT}; with #1075's record lookup`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      let ids = { tenthFinal: "", tenthDraft: "", twelfth: "" };
      ids = await onFile(t);
      const first = "on the 11/10 corrective action for test testy, tick payroll deduct";
      t.loopModel!(whichThenEdit(first, () => ids, (view) => ({ values: { payroll_deduct: "yes" }, payroll_evidence: evidenceFrom(view, "tick payroll deduct", view.turns.filter((turn) => turn.role === "user").length - 1) })));
      const thread = t.thread();
      await thread.say(first);
      const reply = await thread.say("the finalized one", {}, { history: renumbered(thread) });
      const revision = (t.forms() as Forms).find((row) => row.revises_instance_id === ids.tenthFinal);
      expect(revision && t.checked(revision.id).payroll_deduct, `the payroll answer from T1 was not saved:\n${reply.content}`).toEqual(["yes"]);
      expect(reply.content).toMatch(/Payroll deduction amount/);
    },
  },
);
