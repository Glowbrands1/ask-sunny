import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * A FORM ON FILE IS A PRIOR ACTION ONLY WHEN IT CAME BEFORE THIS INCIDENT (port of Ask Bubbles #1083, 0fbdd8b; its U09)
 * ============================================================================
 *
 * Bubbles' U09 turns, word for word (Sunny's salon; the person invented): T1 "create a written CA for <P>." T2 "JBA Policy
 * Manual 1-1-2026, Verbal CA 11-1-2026. On 11-1-26 <P> violated care and cleaning of facilities policy". Live (Bubbles),
 * the card's Prior actions listed ten forms on file dated 11/10–11/17, all after the incident of 11/1. Sunny's
 * finalizedPriorsOnFile counted every finalized form on or before today, as Bubbles' did. Now a form counts only when it
 * is dated before the card's incident date (this proposal's, else this person's card earlier this turn or on screen).
 * Only the date filter is ported: Pau's 23 Nov ruling (forms on file are offered, never added automatically) comes
 * separately once Bubbles has it.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Ask Bubbles #1083 (its QA's live re-run, 23 Nov 2026, U09): Prior actions listed forms on file dated after the incident (11/10–11/17 for an incident on 11/1)";
const INES: DirectoryRow = { id: "e-ines-larkspur", firstName: "Ines", lastName: "Larkspur", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const T1 = "create a written CA for Ines Larkspur.";
const T2 = "JBA Policy Manual 1-1-2026, Verbal CA 11-1-2026. On 11-1-26 Ines violated care and cleaning of facilities policy";
const ADMIN = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

/** Ines's finalized forms on file: one before the incident (10/2), two after it (11/10, 11/17). */
function onFile(t: ReplayContext): void {
  const row = (id: string, formDate: string) => ({
    id, ...t.templateIds!("dpoa"), variant_key: null, employee_role: null, location_id: KEARNEY.primaryAreaId, location_name: "NE Kearney",
    created_by: "another-manager", created_by_role: "salon_director", source: "ask_sunny", status: "finalized", follow_up_date: null, archived_at: null,
    revises_instance_id: null, template_key: "dpoa", template_name: "Corrective Action Form", employee_name: "Ines Larkspur", form_date: formDate,
    created_at: `${formDate}T15:00:00Z`, updated_at: `${formDate}T15:00:00Z`,
  });
  (t.forms() as Record<string, unknown>[]).push(row("ca-ines-1002", "2026-10-02"), row("ca-ines-1110", "2026-11-10"), row("ca-ines-1117", "2026-11-17"));
  for (const id of ["ca-ines-1002", "ca-ines-1110", "ca-ines-1117"]) t.checkOnForm!(id, { warning_type: ["verbal"] });
}

export const NOV23_AGENT_LOOP_PRIORS_ON_FILE_BEFORE_INCIDENT_CASES: ReplayCase[] = [
  {
    id: "nov23-1083-forms-on-file-before-incident-only",
    title: "Port of Bubbles #1083 (U09's T1–T2, incident 11/1): the card's Prior actions from the forms on file holds the form of 10/2 and never those of 11/10 and 11/17 — also when the card is proposed again with no incident date",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
      t.directory([...STAFF, INES]);
      t.as("admin", ADMIN);
      onFile(t);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const said = view.turns.filter((turn) => turn.role === "user" && !turn.text.includes("[app check]")).at(-1)?.text ?? "";
        const level = { warning_level: "written", level_evidence: evidenceFrom(view, "written", said.startsWith("JBA") ? 1 : 0) };
        const proposals = view.results.filter((entry) => entry.tool === "propose_form").length;
        const account = { what_happened: "On 11/1/26 Ines violated the care and cleaning of facilities policy.", policy: headingWith(view, /care and cleaning/i), person_evidence: evidenceFrom(view, "Ines", 0) };
        /* As live: at T2 the card is proposed again in the same turn, this time with no incident date. */
        if (said.startsWith("JBA") && proposals === 1) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: INES.id, ...level, ...account } };
        if (lastResult(view, "propose_form")) return { text: "Here's the Corrective Action Form for **Ines Larkspur**." };
        if (!said.startsWith("JBA")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: INES.id, ...level, person_evidence: evidenceFrom(view, "Ines Larkspur") } };
        return { tool: "propose_form", input: { template_key: "dpoa", employee_id: INES.id, ...level, ...account, incident_date: "2026-11-01" } };
      }));
      const thread = t.thread();
      await thread.say(T1);
      await thread.say(T2);
      const prior = (thread.proposal as { priorActions?: string | null } | null)?.priorActions ?? "";
      expect(prior, "a form on file dated after the incident is a prior action").not.toMatch(/11\/10\/2026|11\/17\/2026/);
      expect(prior, "the form on file of 10/2, before the incident, left Prior actions").toMatch(/10\/02\/2026/);
    },
  },
];
