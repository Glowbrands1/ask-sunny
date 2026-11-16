import { expect, vi } from "vitest";

import { TESTY, TESTY_ACCOUNT } from "@/lib/ai/agent-loop/phrasing-table";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A DATE CHANGE ON A FINALIZED FORM, ASKED BEFORE "WHICH ONE?" (QA's live finding, 16 Nov 2026, production main e2e92554)
 * ============================================================================
 *
 * The live chat (Test Testy, the test employee; an invented name):
 *   T1 "the corrective action for test testy, change the date to 11/9" → "Which one should I open?" (several on file)
 *   T2 "the 11/10 one" → find_past_forms, open_form, then edit_form ×4 on the date: the reviser (writes no date),
 *      privacy_not_asked, "system fields are not drafted by Ask Sunny", unknown_field. The date was not changed, and the
 *      turn ended on the step-limit fallback.
 *   T3 "change the date to 11/9" → form_date saved in one step.
 * Two general fixes, by records and evidence, no word lists: (1) a form this turn already opened (open_form, or the
 * revision draft edit_form opened) is the open form, not a form on file (no privacy_not_asked), and the document's date
 * the manager typed for THIS request (the message being answered or the manager message right before it) is theirs to
 * set as form_date; (2) the step-limit fallback says only what the turn's records show.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's live finding (16 Nov 2026, production e2e92554): a date change asked before \"Which one?\" ended on the step limit, date not saved";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

const TEST_TESTY: DirectoryRow = { id: TESTY.id, firstName: TESTY.firstName, lastName: TESTY.lastName, preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const said = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
const results = (views: readonly LoopView[], tool: string) => views.flatMap((view) => view.results.filter((result) => result.tool === tool)).map((result) => result.output);

/** Two finalized Corrective Actions for Test Testy, dated 11/10 and 11/12. Returns the 11/10 one's id. */
async function twoFinalized(t: ReplayContext): Promise<string> {
  vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
  t.directory([...STAFF, TEST_TESTY]);
  t.as("salon_director", KEARNEY);
  const ids: string[] = [];
  for (const date of ["2026-11-10", "2026-11-12"]) {
    t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form") ? { text: "Here's the card." } : { tool: "propose_form", input: { template_key: "dpoa", employee_id: TESTY.id, what_happened: TESTY_ACCOUNT, incident_date: date } })));
    const setup = t.thread();
    await setup.say(`ca for test testy, she was late to open the salon on ${date.slice(5).replace("-", "/")}`);
    const id = await setup.create();
    Object.assign(t.forms().find((row) => row.id === id)!, { status: "finalized", form_date: date });
    ids.push(id);
  }
  return ids[0]!;
}

export const NOV16_REVISION_DATE_EDIT_CASES: ReplayCase[] = [
  {
    id: "nov16-revision-date-edit-asked-before-which-one",
    title: "QA's live finding: \"the corrective action for test testy, change the date to 11/9\", \"Which one?\", \"the 11/10 one\": the revision draft gets form_date 11/9 in that turn and the turn ends with the model's reply, never the step limit; the finalized original is unchanged",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      const finalizedId = await twoFinalized(t);
      const original = JSON.stringify(t.values(finalizedId));
      const askedTurn = "the corrective action for test testy";
      const standIn = loopStandIn((view): LoopDecision => {
        const text = said(view);
        if (/^the corrective action/i.test(text)) {
          return lastResult(view, "find_past_forms") ? { text: "Which one should I open?" } : { tool: "find_past_forms", input: { employee_name: "Test Testy", form: "dpoa", open: true, forms_on_file_evidence: evidenceFrom(view, askedTurn) } };
        }
        // T2, as the live model did it: open the 11/10 form, then edit its date; retry on the revision draft it opened.
        if (!lastResult(view, "find_past_forms")) return { tool: "find_past_forms", input: { employee_name: "Test Testy", form: "dpoa", date: "11/10", open: true, forms_on_file_evidence: evidenceFrom(view, askedTurn, 1) } };
        const forms = ((lastResult(view, "find_past_forms") as { forms?: { instance_id: string; form_date: string }[] }).forms ?? []);
        const target = forms.find((form) => form.form_date === "2026-11-10")?.instance_id ?? finalizedId;
        if (!lastResult(view, "open_form")) return { tool: "open_form", input: { instance_id: target, forms_on_file_evidence: evidenceFrom(view, askedTurn, 1) } };
        const edits = results([view], "edit_form") as { revision_draft?: { id: string }; saved?: unknown[]; reason_code?: string }[];
        const savedDate = edits.some((edit) => (edit.saved as { field: string }[] | undefined)?.some((row) => row.field === "form_date"));
        if (savedDate || edits.length >= 3) return { text: savedDate ? "Done: the new draft's date is 11/9/2026." : "I couldn't change the date." };
        const revision = edits.map((edit) => edit.revision_draft?.id).find(Boolean);
        return { tool: "edit_form", input: { instance_id: revision ?? target, values: { form_date: "11/09/2026" } } };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      await thread.say("the corrective action for test testy, change the date to 11/9");
      const reply = await thread.say("the 11/10 one");
      const edits = results(standIn.views, "edit_form") as { reason_code?: string; refused?: { field: string; reason_code: string }[] }[];
      expect(edits.map((edit) => edit.reason_code).filter(Boolean), JSON.stringify(edits)).not.toContain("privacy_not_asked");
      const revision = (t.forms() as { id: string; revises_instance_id?: string | null; form_date?: string | null }[]).find((row) => row.revises_instance_id === finalizedId);
      expect(revision, "no revision draft was opened").toBeTruthy();
      expect(revision!.form_date, "the date the manager asked for was not saved on the revision draft").toBe("2026-11-09");
      expect(reply.content, "the turn ended on the step limit").not.toMatch(/couldn't finish|steps I have/i);
      expect(JSON.stringify(t.values(finalizedId)), "the finalized original changed").toBe(original);
      // T3, as live: "change the date to 11/9" on the revision draft now on screen: one edit_form step, no refusal, still 11/9.
      const third = loopStandIn((view): LoopDecision => (lastResult(view, "edit_form") ? { text: "The date is 11/9/2026." } : { tool: "edit_form", input: { instance_id: revision!.id, values: { form_date: "11/09/2026" } } }));
      t.loopModel!(third);
      await thread.say("change the date to 11/9");
      const t3 = results(third.views, "edit_form") as { reason_code?: string }[];
      expect(t3).toHaveLength(1);
      expect(t3[0]!.reason_code ?? null, JSON.stringify(t3[0])).toBeNull();
      expect((t.forms() as { id: string; form_date?: string | null }[]).find((row) => row.id === revision!.id)?.form_date).toBe("2026-11-09");
    },
  },
];
