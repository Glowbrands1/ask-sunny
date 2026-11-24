import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * FORM_DATE_IS_TODAY — A FORM IS DATED THE DAY IT IS WRITTEN (Pau, 24 Nov 2026; port from Ask Bubbles)
 * ============================================================================
 *
 * Pau's words, the employee's name swapped for an invented one: "the form date is wrong i told it <P> was late to
 * work on September 11, 2026. but it put the date …, should be today right". The new Corrective Action was dated
 * 09/11/2026, the day she was late; her Corrective Action finalized on 09/12/2026 was therefore "after" this one and
 * never offered for "List previously received coaching and/or corrective action with date signed" ("it needs to add
 * all past forms"). With FORM_DATE_IS_TODAY_ENABLED the card carries no incident date (Create dates it today) and
 * the 09/12 form on file is offered. Forms on file are still offered, never added unasked (Pau, 23 Nov 2026).
 * Every person is invented.
 */
const FLAG = "FORM_DATE_IS_TODAY_ENABLED";
const REPORT = `Pau, 24 Nov 2026: "the form date is wrong i told it <P> was late to work on September 11, 2026. but it put the date …, should be today right"; invented person`;
const ODESSA: DirectoryRow = { id: "e-odessa-pellham", firstName: "Odessa", lastName: "Pellham", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const SAID = "create a verbal CA for Odessa Pellham, she was late to work on September 11, 2026. no payroll deduct";

/** Her Corrective Action finalized on 09/12/2026. */
function onFile(t: ReplayContext): void {
  (t.forms() as Record<string, unknown>[]).push({
    id: "ca-odessa-0912", ...t.templateIds!("dpoa"), variant_key: null, employee_role: null, location_id: KEARNEY.primaryAreaId, location_name: "NE Kearney",
    created_by: "another-manager", created_by_role: "salon_director", source: "ask_sunny", status: "finalized", follow_up_date: null, archived_at: null,
    revises_instance_id: null, template_key: "dpoa", template_name: "Corrective Action Form", employee_name: "Odessa Pellham", form_date: "2026-09-12",
    created_at: "2026-09-12T15:00:00Z", updated_at: "2026-09-12T15:00:00Z",
  });
  t.checkOnForm!("ca-odessa-0912", { warning_type: ["verbal"] });
}

export const NOV24_FORM_DATE_IS_TODAY_CASES: ReplayCase[] = [
  {
    id: "nov24-form-date-is-today-late-september-11",
    title: `"create a verbal CA for <P>, she was late to work on September 11, 2026" — the card is dated today, and the CA finalized 09/12 is offered as history`,
    report: REPORT,
    status: "fixed", // FORM_DATE_IS_TODAY_ENABLED is on in production (Pau, 24 Nov 2026)
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      vi.setSystemTime(new Date("2026-11-24T18:00:00Z"));
      t.directory([...STAFF, ODESSA]);
      t.as("salon_director", KEARNEY);
      onFile(t);
      const model = loopStandIn((view): LoopDecision => {
        if (lastResult(view, "propose_form")) return { text: "Here's the Corrective Action Form for **Odessa Pellham**." };
        return {
          tool: "propose_form",
          input: {
            template_key: "dpoa",
            employee_id: ODESSA.id,
            person_evidence: evidenceFrom(view, "Odessa Pellham"),
            warning_level: "verbal",
            level_evidence: evidenceFrom(view, "verbal"),
            what_happened: "Odessa was late to work on September 11, 2026.",
            policy: headingWith(view, /attendance/i),
            incident_date: "2026-09-11",
            payroll_deduct: "no",
          },
        };
      });
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say(SAID);
      expect(thread.proposal, "no Corrective Action card").toMatchObject({ templateKey: "dpoa", employeeName: "Odessa Pellham" });
      expect((thread.proposal as { formDate?: string | null }).formDate ?? null, "the card is dated by the incident, not the day it is written").toBeNull();
      const offers = model.views.flatMap((view) => view.results.filter((result) => result.tool === "propose_form"))
        .map((result) => JSON.stringify((result.output as { facts?: { prior_on_file?: unknown } } | null)?.facts?.prior_on_file ?? ""))
        .join("\n");
      expect(offers, "the Corrective Action finalized on 09/12/2026 is not offered as history").toMatch(/09\/12\/2026|2026-09-12/);
    },
  },
  {
    id: "nov24-form-date-is-today-late-september-11-chat",
    title: `"create a corrective action for <P>, she was late to work on September 11, 2026" through the chat (no agent loop) — the card carries no incident date, the form is dated today, and the CA finalized 09/12 is listed`,
    report: REPORT,
    status: "fixed", // FORM_DATE_IS_TODAY_ENABLED is on in production (Pau, 24 Nov 2026)
    fixFlags: [FLAG],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-24T18:00:00Z"));
      t.directory([...STAFF, ODESSA]);
      t.as("salon_director", KEARNEY);
      onFile(t);
      const thread = t.thread();
      const answer = await thread.say("create a corrective action for Odessa Pellham, she was late to work on September 11, 2026. no payroll deduct");
      expect(thread.proposal, "no Corrective Action card").toMatchObject({ templateKey: "dpoa", employeeName: "Odessa Pellham" });
      expect(thread.proposal?.formDate ?? null, "the card is dated by the incident, not the day it is written").toBeNull();
      expect(answer.content, "the reply still dates the form by the incident").not.toMatch(/\*\*Date:\*\* 9\/11\/2026/);
      t.draftWrites({ observation: "Odessa Pellham was late to work on 09/11/2026." });
      const id = await thread.create();
      const row = (t.forms() as Record<string, unknown>[]).find((form) => form.id === id);
      expect(row?.form_date, "the form is dated by the incident, not the day it was written").toBe("2026-11-24");
      const prior = t.values(id).prior_actions ?? "";
      expect(prior, `the Corrective Action finalized on 09/12/2026 is not on the history:\n${prior}`).toMatch(/09\/12\/2026/);
    },
  },
];
