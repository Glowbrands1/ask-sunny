import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * PR 4 OF THE LOOP REBUILD: A REFUSAL HAS A REASON CODE (Pau's audit, 15 Nov 2026)
 * ============================================================================
 *
 * A refusal says WHY with a fixed code (`reason_code`), and the trace's error_kind is that code: it was read from the
 * error's wording (`ERROR_KINDS`, run.ts), which logged the privacy and right-person refusals as plain "refused".
 * These are the codes that need no evidence: not_a_saved_form, finalized_revision_refused, not_on_roster,
 * ambiguous_person, date_after_today. Every person is invented; no message-reading list is added.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Pau's audit of the agent loop (15 Nov 2026), PR 4";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

/** A second Remy Calder at another salon: two people share the name. */
const REMY_TWO: DirectoryRow = { id: "e-remy-calder-2", firstName: "Remy", lastName: "Calder", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

type Step = { tool: string; ok: boolean; error_kind?: string };
const stepsOf = (t: ReplayContext): Step[] => {
  const rows = t.rows?.("chat_traces") ?? [];
  const row = [...rows].reverse().find((entry) => (entry.slots as { agent_loop?: unknown } | undefined)?.agent_loop);
  expect(row, "no chat trace with the loop's steps").toBeTruthy();
  return (row!.slots as { agent_loop: { steps: Step[] } }).agent_loop.steps;
};
const results = (views: readonly { results: readonly { tool: string; output: Record<string, unknown> }[] }[], tool: string) =>
  views.flatMap((view) => view.results.filter((result) => result.tool === tool)).map((result) => result.output);

function start(t: ReplayContext, extra: readonly DirectoryRow[] = []) {
  vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
  t.directory([...STAFF, ...extra]);
  t.as("salon_director", KEARNEY);
}

export const NOV15_AGENT_LOOP_PR4_CASES: ReplayCase[] = [
  {
    id: "nov15-agent-loop-pr4-not-a-saved-form",
    title: "PR 4: edit_form on the card on screen (no saved form behind it) says it is the card on screen and changes with propose_form; error_kind not_a_saved_form",
    report: `${REPORT}: a non-uuid or unsaved card id gave "could not be changed just now"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const standIn = loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was late on 11/12.", incident_date: "2026-11-12" } };
        if (!lastResult(view, "edit_form")) return { tool: "edit_form", input: { instance_id: "card-on-screen", values: { form_date: "2026-11-12" } } };
        return { text: "Here is the card." };
      });
      t.loopModel!(standIn);
      await t.thread().say("ca for remy calder, late on 11/12");
      const edit = results(standIn.views, "edit_form")[0]!;
      expect(edit.reason_code).toBe("not_a_saved_form");
      expect(String(edit.error)).toMatch(/card on screen; it isn't created yet\. Change it with propose_form/);
      expect(String(edit.error), "the old wording").not.toMatch(/could not be changed just now/);
      expect(stepsOf(t).find((step) => step.tool === "edit_form")?.error_kind).toBe("not_a_saved_form");
    },
  },
  {
    id: "nov15-agent-loop-pr4-not-on-roster-and-ambiguous",
    title: "PR 4: find_staff for a name nobody has logs not_on_roster; for a name two people share, ambiguous_person",
    report: `${REPORT}: roster outcomes had no code`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t, [REMY_TWO]);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const tried = view.results.filter((result) => result.tool === "find_staff").length;
        if (tried === 0) return { tool: "find_staff", input: { name: "zebulon marchbanks" } };
        if (tried === 1) return { tool: "find_staff", input: { name: "remy calder" } };
        return { text: "Which Remy Calder?" };
      }));
      await t.thread().say("ca for zebulon marchbanks, then remy calder");
      const kinds = stepsOf(t).filter((step) => step.tool === "find_staff").map((step) => step.error_kind);
      expect(kinds).toEqual(["not_on_roster", "ambiguous_person"]);
    },
  },
  {
    id: "nov15-agent-loop-pr4-date-after-today",
    title: "PR 4: a date after today on a saved draft is refused with date_after_today (G11 kept: nothing written)",
    report: `${REPORT}: the date refusal was named by its wording`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      let draftId = "";
      const standIn = loopStandIn((view): LoopDecision => {
        const said = view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
        if (/change the date/i.test(said)) {
          return lastResult(view, "edit_form") ? { text: "That date is after today." } : { tool: "edit_form", input: { instance_id: draftId, values: { form_date: "2026-12-20" } } };
        }
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was late on 11/12.", incident_date: "2026-11-12" } };
        return { text: "Here is the card." };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      await thread.say("ca for remy calder, late on 11/12");
      draftId = await thread.create();
      await thread.say("change the date to 12/20");
      const edit = results(standIn.views, "edit_form")[0]!;
      expect(edit.reason_code, JSON.stringify(edit)).toBe("date_after_today");
      expect(stepsOf(t).find((step) => step.tool === "edit_form")?.error_kind).toBe("date_after_today");
    },
  },
  {
    id: "nov15-agent-loop-pr4-finalized-revision-refused",
    title: "PR 4: a refused edit on a finalized form is finalized_revision_refused, its revision draft is deleted (revision_cleanup deleted) and the original is unchanged",
    report: `${REPORT}: the cleanup must be kept and a failed delete logged`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      let finalizedId = "";
      const standIn = loopStandIn((view): LoopDecision => {
        const said = view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
        if (/\bchange\b/i.test(said)) {
          return lastResult(view, "edit_form") ? { text: "That field isn't on the form." } : { tool: "edit_form", input: { instance_id: finalizedId, values: { not_a_field_on_this_form: "anything" } } };
        }
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was late on 11/12.", incident_date: "2026-11-12" } };
        return { text: "Here is the card." };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      await thread.say("ca for remy calder, late on 11/12");
      t.draftWrites({ observation: "Observed:\nRemy Calder arrived 20 minutes late for her shift on 11/12/26." });
      finalizedId = await thread.create();
      Object.assign(t.forms().find((row) => row.id === finalizedId)!, { status: "finalized" });
      await thread.say("change the not a field on this form on remy calder's ca");
      const edit = results(standIn.views, "edit_form")[0]!;
      expect(edit.reason_code, JSON.stringify(edit)).toBe("finalized_revision_refused");
      expect(edit.refused_reason_code).toBe("unknown_field");
      expect(edit.revision_cleanup).toBe("deleted");
      expect(t.forms().filter((row) => row.revises_instance_id === finalizedId), "a refused edit left a revision draft").toHaveLength(0);
      expect(stepsOf(t).find((step) => step.tool === "edit_form")?.error_kind).toBe("finalized_revision_refused");
    },
  },
];
