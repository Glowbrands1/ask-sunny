import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE PRIOR ACTIONS THE MANAGER STATES ARE THE CARD'S (port of Ask Bubbles #1045: its QA's live round-2 re-run, 22 Nov 2026, U09)
 * ============================================================================
 *
 * Found in Ask Bubbles, the same code in Sunny. A global login. T1 "create a written CA for <P>." T2 "JBA Policy Manual
 * 1-1-2026, Verbal CA 11-1-2026. On 11-1-26 <P> violated care and cleaning of facilities policy". Live: the stated prior
 * actions were NOT listed (Prior actions kept the forms-on-file list: the Verbal CA's own date is the incident's, so it was
 * refused), and "(JBA Policy Manual 1/1/2026)" landed in the Observation. <P> (invented) has Corrective Actions on file.
 * With AGENT_LOOP_LIVE=1 the real model plays both turns.
 */

const REPORT = "Ask Bubbles' live round-2 re-run (22 Nov 2026, U09; port of #1045): the stated prior actions were not listed (the forms-on-file list stayed) and \"(JBA Policy Manual 1/1/2026)\" was put in the Observation";
const YSOLDE: DirectoryRow = { id: "e-ysolde-brannick", firstName: "Ysolde", lastName: "Brannick", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const T1 = "create a written CA for Ysolde Brannick.";
const T2 = "JBA Policy Manual 1-1-2026, Verbal CA 11-1-2026. On 11-1-26 Ysolde violated care and cleaning of facilities policy";
const ADMIN = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

/** Ysolde's Corrective Actions on file (an earlier Written Warning, and a Verbal Warning before it), as saved. */
function onFile(t: ReplayContext): void {
  const ids = t.templateIds!("dpoa");
  const row = (id: string, formDate: string) => ({
    id, ...ids, variant_key: null, employee_role: null, location_id: KEARNEY.primaryAreaId, location_name: "NE Kearney",
    created_by: "another-manager", created_by_role: "salon_director", source: "ask_sunny", status: "finalized", follow_up_date: null, archived_at: null,
    revises_instance_id: null, template_key: "dpoa", template_name: "Corrective Action Form", employee_name: "Ysolde Brannick", form_date: formDate,
    created_at: `${formDate}T15:00:00Z`, updated_at: `${formDate}T15:00:00Z`,
  });
  (t.forms() as Record<string, unknown>[]).push(row("ca-ysolde-oct", "2026-10-02"), row("ca-ysolde-sep", "2026-09-12"));
  t.typeOnForm("ca-ysolde-oct", { observation: "Ysolde was 25 minutes late to open on 10/2/26." });
  t.checkOnForm!("ca-ysolde-oct", { warning_type: ["written"] });
  t.typeOnForm("ca-ysolde-sep", { observation: "Ysolde left the front desk drawer unlocked on 9/12/26." });
  t.checkOnForm!("ca-ysolde-sep", { warning_type: ["verbal"] });
}

const users = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").length;
type Card = { card?: { prior_actions?: string | null; observation?: string | null } | null } | null;

/** The tester's chat, then Create: the card, the reply, and the saved form. */
async function play(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
  t.directory([...STAFF, YSOLDE]);
  t.as("admin", ADMIN);
  onFile(t);
  t.loopModel!(loopStandIn((view): LoopDecision => {
    const result = lastResult(view, "propose_form") as Card;
    if (result?.card) return { text: `Here's the Corrective Action Form for **Ysolde**.\n\n**Prior actions:** ${result.card.prior_actions ?? ""}\n**Observation of Offense:** ${result.card.observation ?? ""}` };
    if (result) return { text: "Noted." };
    const base = { template_key: "dpoa", employee_name: "Ysolde Brannick", person_evidence: evidenceFrom(view, "Ysolde Brannick", users(view) - 1), warning_level: "written", level_evidence: evidenceFrom(view, "written", users(view) - 1) };
    if (users(view) === 1) return { tool: "propose_form", input: base };
    return { tool: "propose_form", input: { ...base, /* As the tester's live model wrote it: the manual step in the account, in parentheses. */ what_happened: "On 11/1/26 Ysolde violated care and cleaning of facilities policy (JBA Policy Manual 1/1/2026).", incident_date: "2026-11-01", policy: headingWith(view, /care and cleaning/i), prior_actions: "Signed JBA Policy Manual 1/1/2026; Verbal Warning 11/1/2026", prior_actions_evidence: evidenceFrom(view, "JBA Policy Manual 1-1-2026, Verbal CA 11-1-2026") } };
  }));
  const thread = t.thread();
  await thread.say(T1);
  const reply = await thread.say(T2);
  const card = (thread.proposal ?? {}) as { priorActions?: string | null; issue?: string | null; formDate?: string | null };
  t.draftWrites({ observation: "Observed:\nOn November 1, 2026, Ysolde did not follow the care and cleaning of facilities policy.\n\nExpectation:\nYsolde is expected to follow the care and cleaning of facilities policy." });
  const id = await thread.create();
  return { reply, card, id, saved: t.values(id) };
}

export const NOV22_AGENT_LOOP_U09_STATED_PRIOR_CASES: ReplayCase[] = [
  {
    id: "nov22-u09-stated-prior-actions-on-the-card",
    title: `U09 verbatim: "${T1}" then "${T2}" (admin; Ysolde has CAs on file): Prior actions are the two the manager stated (the manual signed 1/1/2026, the Verbal CA 11/1/2026), and the Observation never holds the manual line, on the card and on the saved form after Create`,
    report: REPORT,
    status: "fixed",
    fixFlags: ["AGENT_LOOP_ENABLED"],
    async run(t) {
      if (!t.loopOn?.()) return;
      const { reply, card, saved } = await play(t);
      const prior = String(card.priorActions ?? "");
      expect(prior, `the stated prior actions are not on the card:\n${reply.content}`).toMatch(/Policy Manual[^;]*\b0?1[-/]0?1[-/](?:20)?26\b|\b0?1[-/]0?1[-/](?:20)?26\b[^;]*Policy Manual/i);
      expect(prior, `the stated Verbal CA is not on the card:\n${reply.content}`).toMatch(/Verbal[^;]*\b11[-/]0?1[-/](?:20)?26\b|\b11[-/]0?1[-/](?:20)?26\b[^;]*Verbal/i);
      expect(String(card.issue ?? ""), `the manual line is in the Observation:\n${reply.content}`).not.toMatch(/Policy Manual/i);
      /* Live, the SAVED form's prior_actions also held only the forms-on-file list: both stated steps reach it, and the manual date never the saved Observation. */
      expect(saved.prior_actions ?? "", JSON.stringify(saved)).toMatch(/Policy Manual[^;]*\b0?1[-/]0?1[-/](?:20)?26\b/i);
      expect(saved.prior_actions ?? "", JSON.stringify(saved)).toMatch(/Verbal[^;]*\b11[-/]0?1[-/](?:20)?26\b/i);
      expect(saved.observation ?? "", JSON.stringify(saved)).not.toMatch(/Policy Manual/i);
    },
  },
  {
    /*
     * QA (22 Nov 2026): Ask Bubbles' saved form_date showed today instead of the incident date after its night's merges.
     * The same chat on Sunny: the card keeps no date (formDate null, though the model sent incident_date 2026-11-01), so
     * Create dates the form today (`instances.ts`, `input.formDate ?? recordToday()`). Main 9de3675 does the same; this
     * port neither causes nor fixes it. OPEN until the dating fix lands; the day it passes, the pack says so.
     */
    id: "nov22-u09-saved-form-dated-the-incident",
    title: `U09 verbatim, Create: the saved form is dated the incident the manager gave ("On 11-1-26"), never today`,
    report: "QA (22 Nov 2026): Ask Bubbles' saved form_date showed today instead of the incident date; the same chat on Sunny main dates the form today",
    status: { open: "the card keeps no date when the manager dates a prior step on the incident's day, so Create dates the form today" },
    fixFlags: ["AGENT_LOOP_ENABLED"],
    fixStatus: { open: "the same with the loop on" },
    async run(t) {
      if (!t.loopOn?.()) return;
      const { card, id } = await play(t);
      const row = (t.forms() as { id: string; form_date?: string | null }[]).find((form) => form.id === id);
      expect(row?.form_date, `the saved form is not dated the incident's day (card formDate ${JSON.stringify(card.formDate)}):\n${JSON.stringify(row)}`).toBe("2026-11-01");
    },
  },
];
