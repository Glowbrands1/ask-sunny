import { expect, vi } from "vitest";

import { TESTY, TESTY_ACCOUNT } from "@/lib/ai/agent-loop/phrasing-table";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A CHANGE THE DRAFT ALREADY HOLDS IS SAID SO, NEVER "DIDN'T UPDATE" (QA's live re-test, dateedit r2, main 63ba4c48)
 * ============================================================================
 *
 * dateedit r1 had put 11/09/2026 on Test Testy's revision draft. r2, a new chat, asked again: T1 "the corrective action
 * for test testy, change the date to 11/09/2026" → which one; "the 11/10 one" → "The date didn't actually update to
 * 11/09/2026 - it's still showing as before. Could you confirm the date again"; "the finalized one" → "The date actually
 * did not change - form_date is still unchanged. Could you confirm…". edit_form reported the field only as `unchanged`.
 * General rule (QA): when edit_form's requested value equals what the draft already holds, the result says so
 * (already_set {field, value}), for any field (date, level, payroll, amount); the reply says "The date on the draft is
 * already 11/09/2026", with no "didn't update" and no re-ask. Test Testy is the app's test employee.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's live re-test (16 Nov 2026, main 63ba4c48, dateedit r2): a date the revision draft already held got \"didn't update … confirm the date again\"";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

const TEST_TESTY: DirectoryRow = { id: TESTY.id, firstName: TESTY.firstName, lastName: TESTY.lastName, preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const said = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
const results = (views: readonly LoopView[], tool: string) => views.flatMap((view) => view.results.filter((result) => result.tool === tool)).map((result) => result.output);

type Forms = { id: string; status?: string; form_date?: string | null; revises_instance_id?: string | null }[];
type Edit = { saved?: { field: string }[]; unchanged?: string[]; already_set?: { field: string; value: string }[]; revision_draft?: { id: string } };

const LABEL: Record<string, string> = { form_date: "date", warning_type: "warning level", payroll_deduct: "payroll deduct", payroll_deduct_amount: "payroll deduction amount" };

/** Test Testy's Corrective Actions on file: 11/10 finalized and 11/10 draft. Returns their ids. */
async function onFile(t: ReplayContext): Promise<{ tenthFinal: string; tenthDraft: string }> {
  vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
  t.directory([...STAFF, TEST_TESTY]);
  t.as("salon_director", KEARNEY);
  const made: string[] = [];
  for (const finalized of [true, false]) {
    /*
     * CHANGED ON PURPOSE (port of Ask Bubbles #1123, 24 Nov 2026): a second CA card for Testy on 11/10 is now asked about
     * ("open that one, or is this a separate incident?") instead of made. The second setup card is proposed for 11/09;
     * the line below still dates both forms 11/10, so what this case checks is unchanged.
     */
    const proposeOn = made.length === 0 ? "2026-11-10" : "2026-11-09";
    t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form") ? { text: "Here's the card." } : { tool: "propose_form", input: { template_key: "dpoa", employee_id: TESTY.id, what_happened: TESTY_ACCOUNT, incident_date: proposeOn } })));
    const setup = t.thread();
    await setup.say("ca for test testy, she was late to open the salon on 11/10");
    const id = await setup.create();
    Object.assign(t.forms().find((row) => row.id === id)!, { status: finalized ? "finalized" : "draft", form_date: "2026-11-10" });
    made.push(id);
  }
  return { tenthFinal: made[0]!, tenthDraft: made[1]! };
}

/**
 * The live model: asks "which one?" until the manager singles out the finalized form, opens it, and sends the date from the
 * request's first message. Its reply follows the tool: saved → "Saved on the draft."; already_set → "The <field> on the
 * draft is already <value>." (the rules book); otherwise what the live reply said ("didn't update … confirm").
 */
function whichThenEdit(ids: () => { tenthFinal: string }) {
  const first = "the corrective action for test testy";
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
    if (edits.length > 0) {
      const done = edits.find((row) => (row.saved?.length ?? 0) > 0);
      const already = edits.flatMap((row) => row.already_set ?? []);
      if (done) return { text: "Saved on the draft." };
      if (already.length > 0) return { text: already.map((row) => `The ${LABEL[row.field] ?? row.field} on the draft is already ${row.value}.`).join(" ") };
      return { text: "The date didn't actually update to 11/09/2026 - it's still showing as before. Could you confirm the date again?" };
    }
    const revision = edits.map((row) => row.revision_draft?.id).find(Boolean);
    return { tool: "edit_form", input: { instance_id: revision ?? ids().tenthFinal, values: { form_date: "11/09/2026" } } };
  });
}

/** One run of the dateedit chat: the three turns QA reported. */
async function dateedit(t: ReplayContext, ids: { tenthFinal: string }) {
  const standIn = whichThenEdit(() => ids);
  t.loopModel!(standIn);
  const thread = t.thread();
  await thread.say("the corrective action for test testy, change the date to 11/09/2026");
  await thread.say("the 11/10 one");
  const reply = await thread.say("the finalized one");
  return { standIn, reply };
}

export const NOV16_AGENT_LOOP_EDIT_ALREADY_SET_CASES: ReplayCase[] = [
  {
    id: "nov16-edit-already-set-dateedit-r2",
    title: "dateedit r2: r1 saved 11/09/2026 on the finalized 11/10 form's revision draft; a new chat asks the same (\"change the date to 11/09/2026\" → \"the 11/10 one\" → \"the finalized one\"): edit_form returns already_set {form_date, 11/09/2026} and the reply says the date is already 11/09/2026, never \"didn't update\" or \"confirm the date\"",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      const ids = await onFile(t);
      // r1: the date is saved on the revision draft (the case proves nothing otherwise).
      await dateedit(t, ids);
      const revision = (t.forms() as Forms).find((row) => row.revises_instance_id === ids.tenthFinal);
      expect(revision?.form_date, "r1 did not save 11/09/2026 on the revision draft").toBe("2026-11-09");
      // r2: the same three turns, in a new chat.
      const { standIn, reply } = await dateedit(t, ids);
      const edit = (results(standIn.views, "edit_form") as Edit[]).at(-1)!;
      expect(edit.already_set, `the date the draft already held was not reported as already set:\n${JSON.stringify(edit)}`).toEqual([{ field: "form_date", value: "11/09/2026" }]);
      expect(edit.unchanged ?? [], "an already-set field is still listed as unchanged").not.toContain("form_date");
      expect(reply.content).toContain("The date on the draft is already 11/09/2026.");
      expect(reply.content).not.toMatch(/didn'?t|did not|confirm/i);
    },
  },
  {
    id: "nov16-edit-already-set-level-payroll-amount",
    title: "Any field: \"make it a written and yes payroll $15\" saved on a Corrective Action draft; the same message again reports already_set for the level (Written), payroll deduct (Yes) and the amount ($15), none as unchanged, and a new value still saves",
    report: `${REPORT}; the same treatment for every field (QA)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was 20 minutes late on 11/12." } };
        return { text: "Here's the Corrective Action Form for **Remy Calder**." };
      }));
      const thread = t.thread();
      await thread.say("ca for remy calder, she was 20 minutes late on 11/12");
      const id = await thread.create();
      const model = loopStandIn((view): LoopDecision => {
        const edit = lastResult(view, "edit_form") as Edit | null;
        const amount = /\$(\d+)/.exec(said(view))?.[1] ?? "15";
        if (!edit) return { tool: "edit_form", input: { level_evidence: evidenceFrom(view), payroll_evidence: evidenceFrom(view), instance_id: id, values: { warning_type: "written", payroll_deduct: "yes", payroll_deduct_amount: `$${amount}` } } };
        return { text: (edit.already_set ?? []).length > 0 ? edit.already_set!.map((row) => `The ${LABEL[row.field] ?? row.field} on the draft is already ${row.value}.`).join(" ") : "Saved on the draft." };
      });
      t.loopModel!(model);
      await thread.say("make it a written and yes payroll $15");
      const first = (results(model.views, "edit_form") as Edit[]).at(-1)!;
      expect(first.saved?.map((row) => row.field), "the first edit saved nothing (the case proves nothing)").toEqual(expect.arrayContaining(["warning_type", "payroll_deduct"]));
      expect(first.already_set, "a field that changed was reported as already set").toBeUndefined();
      const reply = await thread.say("make it a written and yes payroll $15");
      const second = (results(model.views, "edit_form") as Edit[]).at(-1)!;
      const already = Object.fromEntries((second.already_set ?? []).map((row) => [row.field, row.value]));
      expect(already.warning_type, JSON.stringify(second)).toBe("Written");
      expect(already.payroll_deduct, JSON.stringify(second)).toBe("Yes");
      expect(already.payroll_deduct_amount ?? "", JSON.stringify(second)).toMatch(/^\$15(?:\.00)?$/);
      expect(second.unchanged ?? []).toEqual([]);
      expect(reply.content).not.toMatch(/didn'?t|did not|confirm/i);
      // A different amount is a change, saved as before.
      await thread.say("make it a written and yes payroll $25");
      const third = (results(model.views, "edit_form") as Edit[]).at(-1)!;
      expect(third.saved?.map((row) => row.field), JSON.stringify(third)).toContain("payroll_deduct_amount");
      expect(t.values(id).payroll_deduct_amount ?? "").toMatch(/25/);
    },
  },
];
