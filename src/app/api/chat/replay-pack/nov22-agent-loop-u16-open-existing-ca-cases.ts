import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * "PUT UP THE VERBAL CA FOR <P>" OPENS THE ONE ON FILE (port of Ask Bubbles #1044: its QA's live round-2 re-run, 22 Nov 2026, U16)
 * ============================================================================
 *
 * Found in Ask Bubbles; Sunny's #1224 (the port of #1028) carries the same "put up the verbal CA" new-card example. An
 * admin login (global). <P> (invented) has several finalized and revised Corrective Actions on file, some of them Verbal
 * Warnings. T1 "put up the verbal CA for <P>" started a NEW card instead of opening the existing one (choose if several);
 * T2 "create a verbal CA for <P> with all the same information given" answered "What happened?" with no Create, instead
 * of copying it. With AGENT_LOOP_LIVE=1 the real model plays both turns.
 */

const REPORT = "Ask Bubbles' live round-2 re-run (22 Nov 2026, U16; port of #1044): \"put up the verbal CA for <P>\" started a new card; \"… with all the same information given\" asked \"What happened?\" with no Create";
const ORIEL: DirectoryRow = { id: "e-oriel-tamsworth", firstName: "Oriel", lastName: "Tamsworth", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const T1 = "put up the verbal CA for Oriel Tamsworth";
const T2 = "create a verbal CA for Oriel Tamsworth with all the same information given";
const ADMIN = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const ACCOUNT = "Oriel did not complete the closing cleaning checklist on 11/14/26 and left the tanning beds unwiped.";
/*
 * CHANGED ON PURPOSE (Pau's Failure 2 review via QA, 23-24 Nov 2026; the sibling app's same change): a copy for the SAME
 * person with the SAME incident date as a form on file is that duplicate, so propose_form first asks "Oriel already has a
 * Corrective Action for 11/14 (finalized …). Do you want to open that one, or is this a separate incident?"
 * (same_incident_on_file). The copy case checks that question at T2, and the copy itself after T3 below.
 */
const T3_SEPARATE = "it's a separate incident";
const ASKED_SAME_DAY = /Oriel already has a Corrective Action for 11\/14 \(finalized[^)]*\)\. Do you want to open that one, or is this a separate incident\?/;

/**
 * Oriel's Corrective Actions on file, as Form Monitoring holds them: a Verbal Warning on 11/14 revised once (the
 * revision saved a day later; the original is then "revised"), and an earlier Written Warning.
 */
function onFile(t: ReplayContext): void {
  const ids = t.templateIds!("dpoa");
  const row = (id: string, formDate: string, createdAt: string, revises: string | null, status = "finalized") => ({
    id, ...ids, variant_key: null, employee_role: null,
    location_id: KEARNEY.primaryAreaId, location_name: "NE Kearney", created_by: "another-manager", created_by_role: "salon_director",
    source: "ask_sunny", status, follow_up_date: null, archived_at: null, revises_instance_id: revises,
    template_key: "dpoa", template_name: "Corrective Action Form", employee_name: "Oriel Tamsworth", form_date: formDate,
    created_at: createdAt, updated_at: createdAt,
  });
  (t.forms() as Record<string, unknown>[]).push(
    row("ca-oriel-written", "2026-10-02", "2026-10-02T15:00:00Z", null),
    /* A finalized revision moves its original to "revised" (`supersedeRevised`). */
    row("ca-oriel-verbal", "2026-11-14", "2026-11-14T15:00:00Z", null, "revised"),
    row("ca-oriel-verbal-r1", "2026-11-14", "2026-11-15T16:30:00Z", "ca-oriel-verbal"),
  );
  for (const id of ["ca-oriel-verbal", "ca-oriel-verbal-r1"]) {
    t.typeOnForm(id, { observation: ACCOUNT, policy_violated: "Care and Cleaning of Equipment and Facilities" });
    t.checkOnForm!(id, { warning_type: ["verbal"] });
  }
  t.typeOnForm("ca-oriel-written", { observation: "Oriel was 25 minutes late to open on 10/2/26.", policy_violated: "Attendance" });
  t.checkOnForm!("ca-oriel-written", { warning_type: ["written"] });
}

const users = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").length;

export const NOV22_AGENT_LOOP_U16_OPEN_EXISTING_CA_CASES: ReplayCase[] = [
  {
    id: "nov22-u16-put-up-opens-existing-ca",
    title: `U16 verbatim: "${T1}" (admin; Oriel has CAs on file) looks up her forms on file and never starts a new card; "${T2}" makes a card that carries the form on file's account, never "What happened?"`,
    report: REPORT,
    status: "fixed",
    fixFlags: ["AGENT_LOOP_ENABLED"],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
      t.directory([...STAFF, ORIEL]);
      t.as("admin", ADMIN);
      onFile(t);
      const model = loopStandIn((view): LoopDecision => {
        const found = lastResult(view, "find_past_forms") as { forms?: { choice?: string }[]; which_form_question?: string } | null;
        if (users(view) === 1) {
          if (!found) return { tool: "find_past_forms", input: { employee_name: "Oriel Tamsworth", form: "verbal CA", open: true, forms_on_file_evidence: evidenceFrom(view, T1) } };
          return { text: `${(found.forms ?? []).map((form) => `- ${form.choice}`).join("\n")}\n\n${found.which_form_question ?? ""}` };
        }
        const proposed = lastResult(view, "propose_form") as { card?: unknown; ask_exactly?: string } | null;
        if (proposed?.card) return { text: "Here's the Corrective Action Form for **Oriel**." };
        if (proposed) return { text: proposed.ask_exactly ?? `Stopped: ${JSON.stringify(proposed)}` };
        if (users(view) === 3) {
          if (!lastResult(view, "read_form")) return { tool: "read_form", input: { instance_id: "ca-oriel-verbal-r1", forms_on_file_evidence: evidenceFrom(view, T2, 1) } };
          return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Oriel Tamsworth", person_evidence: evidenceFrom(view, "Oriel Tamsworth", 1), warning_level: "verbal", level_evidence: evidenceFrom(view, "verbal", 1), what_happened: ACCOUNT, policy: headingWith(view, /care and cleaning/i), separate_incident_evidence: evidenceFrom(view, T3_SEPARATE) } };
        }
        const read = lastResult(view, "read_form");
        if (!read) return { tool: "read_form", input: { instance_id: "ca-oriel-verbal-r1", forms_on_file_evidence: evidenceFrom(view, T2) } };
        return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Oriel Tamsworth", person_evidence: evidenceFrom(view, "Oriel Tamsworth"), warning_level: "verbal", level_evidence: evidenceFrom(view, "verbal"), what_happened: ACCOUNT, policy: headingWith(view, /care and cleaning/i) } };
      });
      t.loopModel!(model);
      const thread = t.thread();
      const first = await thread.say(T1);
      expect(first.formProposal ?? null, `T1 started a new card instead of opening the one on file:\n${first.content}`).toBeNull();
      const lookups = model.views.flatMap((view) => view.results.filter((result) => result.tool === "find_past_forms").map((result) => result.output as { forms?: { instance_id: string }[]; best_match?: string }));
      expect(lookups.length, `T1 never looked at the forms on file:\n${first.content}`).toBeGreaterThan(0);
      /* The verbal CA asked for is one form: its current version, never the Written Warning or the original its revision replaced. */
      const offered = lookups.flatMap((found) => [...(found.forms ?? []).map((form) => form.instance_id), ...(found.best_match ? [found.best_match] : [])]);
      expect([...new Set(offered)], JSON.stringify(lookups)).toEqual(["ca-oriel-verbal-r1"]);
      const second = await thread.say(T2);
      expect(second.content, `T2 asked what happened instead of copying the form on file:\n${second.content}`).not.toMatch(/what happened\?/i);
      /* CHANGED ON PURPOSE (see T3_SEPARATE): the copy on the form on file's own date asks first; the manager says it is separate. */
      expect(second.content).toMatch(ASKED_SAME_DAY);
      const third = await thread.say(T3_SEPARATE);
      expect(third.formProposal?.templateKey, third.content).toBe("dpoa");
      expect(String((third.formProposal as { issue?: string } | undefined)?.issue ?? ""), third.content).toMatch(/closing cleaning checklist/);
    },
  },
];
