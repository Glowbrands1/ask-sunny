import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * TOOLS RETURN EXACTLY WHAT WAS SAVED (rebuild plan PR 3; owner's audit, 15 Nov 2026)
 * ============================================================================
 *
 * edit_form returns `saved: [{field, before, after}]`, read back from the database after the write (text, tick boxes
 * and the date alike), and `refused: [{field, reason_code}]`. propose_form returns `card` and `not_on_card`. A finalized
 * form's revision returns `revision_draft: {id, from_id}`. The turn's own summary and the trace use that list; the trace
 * holds names and codes, never values. Invented names (Remy Calder, Tamsin Orwell).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "The owner's audit, PR 3: tools return exactly what was saved (15 Nov 2026)";

type Saved = { field: string; before: string; after: string };
type Refused = { field: string; reason_code: string };
type EditResult = { saved?: Saved[]; refused?: Refused[]; unchanged?: string[]; updated?: string[]; revision_draft?: { id?: string; from_id?: string } };

const stepsOf = (t: ReplayContext) => {
  const row = [...(t.rows?.("chat_traces") ?? [])].reverse().find((entry) => (entry.slots as { agent_loop?: unknown } | undefined)?.agent_loop);
  return ((row?.slots as { agent_loop: { steps: Record<string, unknown>[] } } | undefined)?.agent_loop.steps ?? []);
};

const loopTraceOf = (t: ReplayContext) => {
  const row = [...(t.rows?.("chat_traces") ?? [])].reverse().find((entry) => (entry.slots as { agent_loop?: unknown } | undefined)?.agent_loop);
  return (row?.slots as { agent_loop: { stopped: string; steps_used: number; step_limit: number } }).agent_loop;
};

/** A Corrective Action draft for Remy Calder, created, dated 11/12; returns its id. */
async function remyDraft(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  t.loopModel!(loopStandIn((view): LoopDecision => {
    if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
    if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was 20 minutes late on 11/12.", incident_date: "2026-11-12" } };
    return { text: "Here's the Corrective Action Form for **Remy Calder**." };
  }));
  const thread = t.thread();
  await thread.say("ca for remy calder, she was 20 minutes late on 11/12");
  return { thread, id: await thread.create() };
}

export const NOV15_AGENT_LOOP_SAVED_DIFF_CASES: ReplayCase[] = [
  {
    id: "nov15-pr3-saved-list-checkbox-and-text",
    title: "PR 3: \"make it a written and yes payroll $15\": edit_form returns saved before/after for the level and payroll boxes and the amount, read from the saved form; the trace names the fields and holds no value",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { thread, id } = await remyDraft(t);
      const model = loopStandIn((view): LoopDecision => (lastResult(view, "edit_form")
        ? { text: "Saved." }
        : { tool: "edit_form", input: { instance_id: id, values: { warning_type: "written", payroll_deduct: "yes", payroll_deduct_amount: "$15" } } }));
      t.loopModel!(model);
      await thread.say("make it a written and yes payroll $15");
      const result = lastResult({ results: model.views.at(-1)!.results } as LoopView, "edit_form") as EditResult;
      const saved = new Map((result.saved ?? []).map((change) => [change.field, change]));
      expect(saved.get("warning_type"), JSON.stringify(result)).toMatchObject({ before: "", after: "written" });
      expect(saved.get("payroll_deduct"), JSON.stringify(result)).toMatchObject({ before: "", after: "yes" });
      expect(saved.get("payroll_deduct_amount")?.after, JSON.stringify(result)).toMatch(/15/);
      expect(result.refused ?? [], JSON.stringify(result)).toEqual([]);
      expect(t.checked(id).warning_type).toEqual(["written"]);
      const edit = stepsOf(t).find((step) => step.tool === "edit_form") as { saved_fields?: string[] } | undefined;
      expect(edit?.saved_fields, "the trace does not name the saved fields").toEqual(expect.arrayContaining(["warning_type", "payroll_deduct"]));
      expect(JSON.stringify(stepsOf(t)), "a field value is in the trace").not.toMatch(/\$15|written\b.*payroll_deduct_amount|"after"/);
    },
  },
  {
    id: "nov15-pr3-saved-list-date",
    title: "PR 3: \"change the date to 11/13\": the date is in saved with its value before (11/12) and after (11/13), read back",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { thread, id } = await remyDraft(t);
      const model = loopStandIn((view): LoopDecision => (lastResult(view, "edit_form")
        ? { text: "Saved." }
        : { tool: "edit_form", input: { instance_id: id, values: { form_date: "11/13" } } }));
      t.loopModel!(model);
      await thread.say("change the date to 11/13");
      const result = lastResult({ results: model.views.at(-1)!.results } as LoopView, "edit_form") as EditResult;
      const change = (result.saved ?? []).find((entry) => entry.field === "form_date");
      expect(change, JSON.stringify(result)).toBeTruthy();
      expect(change!.before).toMatch(/11\/12|2026-11-12/);
      expect(change!.after).toMatch(/11\/13|2026-11-13/);
    },
  },
  {
    id: "nov15-pr3-same-value-is-unchanged-not-refused",
    title: "PR 3: a write that leaves a field as it was (the same text again) is listed as unchanged, not refused, and is not in saved",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { thread, id } = await remyDraft(t);
      const same = t.values(id).observation ?? "";
      expect(same, "the draft has no observation to repeat").not.toBe("");
      const model = loopStandIn((view): LoopDecision => (lastResult(view, "edit_form")
        ? { text: "Done." }
        : { tool: "edit_form", input: { instance_id: id, values: { observation: same } } }));
      t.loopModel!(model);
      await thread.say("put the observation on the form");
      const result = lastResult({ results: model.views.at(-1)!.results } as LoopView, "edit_form") as EditResult;
      expect((result.saved ?? []).map((change) => change.field), JSON.stringify(result)).not.toContain("observation");
      expect(result.unchanged, JSON.stringify(result)).toContain("observation");
      expect(result.refused ?? [], JSON.stringify(result)).toEqual([]);
    },
  },
  {
    id: "nov15-pr3-revision-draft-and-saved",
    title: "PR 3: a change to a finalized form returns revision_draft {id, from_id} and the saved list of the revision draft; the turn's summary names what was saved on the draft",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { thread, id } = await remyDraft(t);
      t.draftWrites({ observation: "Observed:\nRemy Calder was 20 minutes late on 11/12." }, { warning_type: ["verbal"] });
      Object.assign(t.forms().find((row) => row.id === id)!, { status: "finalized", form_date: "2026-11-12" });
      const model = loopStandIn((view): LoopDecision => (lastResult(view, "edit_form")
        ? { text: "Saved." }
        : { tool: "edit_form", input: { instance_id: id, values: { form_date: "11/13" } } }));
      t.loopModel!(model);
      const reply = await thread.say("change the date on that CA to 11/13");
      const result = lastResult({ results: model.views.at(-1)!.results } as LoopView, "edit_form") as EditResult;
      expect(result.revision_draft?.from_id, JSON.stringify(result)).toBe(id);
      expect(result.revision_draft?.id).toBeTruthy();
      expect(result.revision_draft?.id).not.toBe(id);
      expect((result.saved ?? []).some((change) => change.field === "form_date"), JSON.stringify(result)).toBe(true);
      expect(reply.formOpened?.instanceId).toBe(result.revision_draft?.id);
    },
  },
  {
    id: "nov15-pr3-card-and-not-on-card",
    title: "PR 3: propose_form asked for a written level the manager never said: the card shows no level, and not_on_card lists warning_level with a reason code",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was 20 minutes late on 11/12.", incident_date: "2026-11-12", warning_level: "written" } };
        return { text: "Here's the Corrective Action Form for **Remy Calder**." };
      });
      t.loopModel!(model);
      await t.thread().say("ca for remy calder, she was 20 minutes late on 11/12");
      const result = lastResult({ results: model.views.at(-1)!.results } as LoopView, "propose_form") as { card?: Record<string, unknown>; not_on_card?: Refused[] };
      expect(result.card?.warning_level ?? null).toBeNull();
      expect(result.card).toHaveProperty("form_date");
      expect(result.not_on_card, JSON.stringify(result)).toEqual([{ field: "warning_level", reason_code: "level_not_stated" }]);
    },
  },
  {
    id: "nov15-pr3-three-saved-edits-in-one-turn",
    title: "PR 6 (owner's addition): a turn that makes 3 saved edits in a row finishes under the step limit (the trace says stopped: reply), and the turn's update lists all 3 changes, merged across the calls",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { thread, id } = await remyDraft(t);
      const edits: Record<string, string>[] = [{ warning_type: "written" }, { payroll_deduct: "yes", payroll_deduct_amount: "$15" }, { form_date: "11/13" }];
      const model = loopStandIn((view): LoopDecision => {
        const done = view.results.filter((result) => result.tool === "edit_form");
        return done.length < edits.length ? { tool: "edit_form", input: { instance_id: id, values: edits[done.length] } } : { text: "Done." };
      });
      t.loopModel!(model);
      const reply = await thread.say("make it a written, yes payroll $15, and change the date to 11/13");
      const trace = loopTraceOf(t);
      expect(trace.stopped, "the turn hit the step limit").toBe("reply");
      expect(trace.steps_used, "the turn used every step").toBeLessThan(trace.step_limit);
      expect([...(reply.formUpdate?.updated ?? [])].sort(), "the turn's update lists only the last call's fields").toEqual(["form_date", "payroll_deduct", "payroll_deduct_amount", "warning_type"]);
      expect(t.checked(id).warning_type).toEqual(["written"]);
      expect(t.checked(id).payroll_deduct).toEqual(["yes"]);
    },
  },
  {
    id: "nov15-pr3-the-turn-summary-lists-all-saved-edits",
    title: "PR 3: when the model's own reply is empty after 3 saved edits, the reply built from the saved list names all 3 with readable labels and values (Written, 11/13/2026), never \"nothing was saved\"",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { thread, id } = await remyDraft(t);
      const edits: Record<string, string>[] = [{ warning_type: "written" }, { payroll_deduct: "yes" }, { form_date: "11/13" }];
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const done = view.results.filter((result) => result.tool === "edit_form");
        return done.length < edits.length ? { tool: "edit_form", input: { instance_id: id, values: edits[done.length] } } : { text: "" };
      }));
      const reply = await thread.say("make it a written, yes payroll, and change the date to 11/13");
      for (const named of ["Type of warning (now Written)", "Payroll deduct (now Yes)", "Date (now 11/13/2026)"]) expect(reply.content, `missing "${named}":\n${reply.content}`).toContain(named);
      expect(reply.content).not.toMatch(/nothing was saved|didn't change anything/i);
    },
  },
];
