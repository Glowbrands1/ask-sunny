import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * PR 4 OF THE LOOP REBUILD: A REFUSAL HAS A REASON CODE (Pau's audit, 15 Nov 2026)
 * ============================================================================
 *
 * A refusal says WHY with a fixed code (`reason_code`), and the trace's error_kind is that code: it was read from the
 * error's wording (`ERROR_KINDS`, run.ts), which logged the privacy and right-person refusals as plain "refused".
 * These are the codes that need no evidence: not_a_saved_form (unit test, `not-a-saved-form.test.ts`), not_a_form_id, finalized_revision_refused, not_on_roster,
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
    id: "nov15-agent-loop-pr4-not-a-form-id",
    title: "PR 4 (QA's review of #1022): edit_form with an id that is no saved form's (\"juno-ca\") with a draft open is not_a_form_id and never points the model at propose_form",
    report: `${REPORT}: a made-up id was told "the card on screen; use propose_form"`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      let draftId = "";
      const standIn = loopStandIn((view): LoopDecision => {
        const said = view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
        if (/change the date/i.test(said)) {
          return lastResult(view, "edit_form") ? { text: "That id isn't a saved form." } : { tool: "edit_form", input: { instance_id: "juno-ca", values: { form_date: "2026-11-12" } } };
        }
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was late on 11/12.", incident_date: "2026-11-12" } };
        return { text: "Here is the card." };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      await thread.say("ca for remy calder, late on 11/12");
      draftId = await thread.create();
      expect(draftId).toBeTruthy();
      const formsBefore = t.forms().length;
      await thread.say("change the date to 11/12");
      const edit = results(standIn.views, "edit_form")[0]!;
      expect(edit.reason_code, JSON.stringify(edit)).toBe("not_a_form_id");
      expect(String(edit.error)).toMatch(/isn't a saved form's id; use the instance_id from the open form or find_past_forms/);
      expect(String(edit.error), "pointed the model at propose_form").not.toMatch(/propose_form/);
      expect(t.forms().length, "a form was added").toBe(formsBefore);
      expect(stepsOf(t).find((step) => step.tool === "edit_form")?.error_kind).toBe("not_a_form_id");
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
          return lastResult(view, "edit_form") ? { text: "That field isn't on the form." } : { tool: "edit_form", input: { instance_id: finalizedId, forms_on_file_evidence: evidenceFrom(view), values: { not_a_field_on_this_form: "anything" } } };
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
  {
    id: "nov15-agent-loop-pr4-refused-edit-never-deletes-an-already-open-draft",
    title: "PR 4 (Pau): a refused edit on a finalized form deletes only the revision draft THIS call opened, never one that was already open",
    report: `${REPORT}: only the draft this call created may be cleaned up`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      let finalizedId = "";
      // Changed on purpose (the rebuild plan's PR 1a): edit_form of a form that is not open quotes the manager's ask about it.
      const standIn = loopStandIn((view): LoopDecision => {
        const said = view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
        if (/open a revision/i.test(said)) {
          return lastResult(view, "edit_form") ? { text: "Opened a revision draft." } : { tool: "edit_form", input: { instance_id: finalizedId, values: { form_date: "2026-11-12" }, forms_on_file_evidence: evidenceFrom(view, "remy calder's ca") } };
        }
        if (/\bchange\b/i.test(said)) {
          return lastResult(view, "edit_form") ? { text: "That field isn't on the form." } : { tool: "edit_form", input: { instance_id: finalizedId, values: { not_a_field_on_this_form: "anything" }, forms_on_file_evidence: evidenceFrom(view, "remy calder's ca") } };
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
      await thread.say("open a revision and set the date to 11/12 on remy calder's ca");
      const revisions = () => t.forms().filter((row) => row.revises_instance_id === finalizedId);
      // The case needs a revision draft already open before the refused call.
      expect(revisions().length, "the first edit opened no revision draft, so the case proves nothing").toBeGreaterThan(0);
      const before = revisions().map((row) => row.id);
      await thread.say("change the not a field on this form on remy calder's ca");
      const refused = results(standIn.views, "edit_form").at(-1)!;
      // No cleanup happens for a draft this call did not open, so the refusal keeps its own code (the inner reason).
      expect(refused.reason_code, JSON.stringify(refused)).toBe("unknown_field");
      expect(refused.revision_cleanup, "cleaned up a draft this call did not open").toBeUndefined();
      expect(revisions().map((row) => row.id), "the already-open revision draft was deleted").toEqual(before);
    },
  },
  {
    id: "nov15-agent-loop-pr4-refused-edit-failed-cleanup-is-logged",
    title: "PR 4 (Pau, the owner's additions): when the revision draft a refused edit opened cannot be deleted, the refusal says revision_cleanup failed, the failure is logged (the form id only, never a name), the original is unchanged, and nothing claims the draft is gone",
    report: `${REPORT}: a failed cleanup must be logged, never silent`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      let finalizedId = "";
      const standIn = loopStandIn((view): LoopDecision => {
        const said = view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
        if (/\bchange\b/i.test(said)) {
          return lastResult(view, "edit_form") ? { text: "That field isn't on the form." } : { tool: "edit_form", input: { instance_id: finalizedId, forms_on_file_evidence: evidenceFrom(view), values: { not_a_field_on_this_form: "anything" } } };
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
      const original = JSON.stringify(t.values(finalizedId));
      t.failDeletesOf!("form_instances");
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await thread.say("change the not a field on this form on remy calder's ca");
        const edit = results(standIn.views, "edit_form").at(-1)!;
        expect(edit.reason_code, JSON.stringify(edit)).toBe("finalized_revision_refused");
        expect(edit.refused_reason_code).toBe("unknown_field");
        expect(edit.revision_cleanup, "a failed delete was reported as deleted").toBe("failed");
        const leftover = t.forms().filter((row) => row.revises_instance_id === finalizedId);
        expect(leftover, "the case needs the delete to really fail").toHaveLength(1);
        const cleanupLog = logged.mock.calls.find((call) => String(call[0]).includes("refused revision's draft could not be deleted"));
        expect(cleanupLog, "the failed cleanup was not logged").toBeTruthy();
        expect(cleanupLog![1]).toMatchObject({ instanceId: leftover[0]!.id });
        expect(JSON.stringify(cleanupLog), "the log names a person").not.toMatch(/remy|calder/i);
        expect(JSON.stringify(t.values(finalizedId)), "the finalized original changed").toBe(original);
      } finally {
        logged.mockRestore();
      }
    },
  },
  ...[
    ["a card", "ca for remy calder, late on 11/12", "corrective_action"],
    ["chat", "what can you do?", "general_guidance"],
  ].map(
    ([what, said, category]): ReplayCase => ({
      id: `nov15-agent-loop-pr4-turn-category-${what!.replace(/\W+/g, "-")}`,
      title: `PR 4 (Pau): a loop turn that is ${what} is logged as ${category}, not unclassified`,
      report: `${REPORT}: loop turns were closed as "unclassified" (route.ts)`,
      status: "fixed",
      fixFlags: [FLAG],
      async run(t) {
        if (!t.loopOn?.() || !offline) return;
        start(t);
        t.loopModel!(loopStandIn((view): LoopDecision => {
          if (what === "chat") return { text: "I can help with forms and policy questions." };
          if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
          if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was late on 11/12.", incident_date: "2026-11-12" } };
          return { text: "Here is the card." };
        }));
        await t.thread().say(said!);
        const closed = (t.rows?.("activity_events") ?? []).at(-1) as { category?: string; succeeded?: boolean } | undefined;
        expect(closed, "no turn was closed").toBeTruthy();
        expect(closed!.category).toBe(category);
      },
    }),
  ),
  {
    id: "nov15-agent-loop-pr4-created-cards-proposal-id-resolves-to-the-saved-form",
    title: "PR 4 (QA's review of #1022): edit_form with the proposal id of a card Create already made saves on the saved form it made",
    report: `${REPORT}: a created card's id is the form Create made, not a card to change with propose_form`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      let proposalId = "";
      const standIn = loopStandIn((view): LoopDecision => {
        const said = view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
        if (/change the date/i.test(said)) {
          return lastResult(view, "edit_form") ? { text: "Updated the date." } : { tool: "edit_form", input: { instance_id: proposalId, forms_on_file_evidence: evidenceFrom(view), values: { form_date: "2026-11-10" } } };
        }
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was late on 11/12.", incident_date: "2026-11-12" } };
        return { text: "Here is the card." };
      });
      t.loopModel!(standIn);
      const thread = t.thread();
      await thread.say("ca for remy calder, late on 11/12");
      proposalId = String((thread.proposal as { proposalId?: string } | null)?.proposalId ?? "");
      expect(proposalId, "the card has no proposal id").not.toBe("");
      const formId = await thread.create();
      const formsBefore = t.forms().length;
      await thread.say("change the date to 11/10");
      const edit = results(standIn.views, "edit_form")[0]!;
      expect(edit.reason_code, JSON.stringify(edit)).toBeUndefined();
      expect(edit.error, JSON.stringify(edit)).toBeUndefined();
      expect(t.forms().length, "a form was added").toBe(formsBefore);
      const saved = t.values(formId).form_date ?? "";
      expect(saved, `the date was not saved on the form Create made:\n${JSON.stringify(edit)}`).toMatch(/11\/10|2026-11-10|Nov(?:ember)? 10/);
    },
  },
];
