import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE SAME INCIDENT ALREADY ON FILE IS SAID, AND CREATE WAITS (port of Ask Bubbles #1123; Pau's review, 23 Nov 2026)
 * ============================================================================
 *
 * Pau's review (via QA): an employee had two FINALIZED Corrective Actions for one incident date (a no-show on 11/18) and a
 * third draft, and the AI never mentioned that one already existed. Ask Sunny's agent loop had no such check (Bubbles'
 * parity entry, port pending). The owner (24 Nov 2026) asked for it here. A Corrective Action or Coaching card for a person
 * and incident date that already has that form on file (draft or finalized) is not made: the reply says
 * so and asks "Do you want to open that one, or is this a separate incident?". (The manager's own form waiting for HR is
 * opened or named first by #1306's ownFormsWithHr, before this check; another manager's is never seen.) The manager's words that it is a separate
 * incident build the card; another date gets no question; Create is the last gate. Sunny's salon; the person invented.
 * (Bubbles' dateless-copy case is not ported: Sunny's read_form keeps no record of the form a copy was read from.)
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Pau's review (23 Nov 2026, via QA; port of Ask Bubbles #1123): an employee had two finalized Corrective Actions for the same incident date (a no-show on 11/18) and a third draft; the AI never mentioned one already existed";
const ODESSA: DirectoryRow = { id: "e-odessa-fernwick", firstName: "Odessa", lastName: "Fernwick", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const ON_1118 = "create a corrective action for Odessa Fernwick, she was a no call no show on 11/18";
const ON_1120 = "create a corrective action for Odessa Fernwick, she was a no call no show on 11/20";
const SEPARATE = "this is a separate incident, she no-showed her second shift that day too";

type OnFile = "finalized" | "draft";

/** Odessa's Corrective Action on file for one date: finalized 11/19, or a draft. */
function onFile(t: ReplayContext, state: OnFile, id = "ca-odessa-1118", formDate = "2026-11-18"): void {
  (t.forms() as Record<string, unknown>[]).push({
    id, ...t.templateIds!("dpoa"), variant_key: null, employee_role: null, location_id: KEARNEY.primaryAreaId, location_name: "NE Kearney",
    created_by: "another-manager", created_by_role: "salon_director", source: "ask_sunny", status: state,
    follow_up_date: null, archived_at: null, revises_instance_id: null, template_key: "dpoa", template_name: "Corrective Action Form",
    employee_name: "Odessa Fernwick", form_date: formDate, created_at: `${formDate}T22:00:00Z`, updated_at: "2026-11-19T16:00:00Z",
    ...(state === "finalized" ? { finalized_at: "2026-11-19T16:00:00Z" } : {}),
  });
  t.typeOnForm(id, { observation: `Odessa was a no call no show for her shift on ${formDate.slice(5, 7)}/${formDate.slice(8)}/26.` });
}

const users = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && !turn.text.includes("[app check]"));
type Result = { card?: unknown; reason_code?: string; ask_exactly?: string } | null;

/** The model proposes the CA for the date in the manager's first message; told it is on file, it asks; told it is separate, it proposes again with those words. */
const model = (date: string) =>
  loopStandIn((view): LoopDecision => {
    const result = lastResult(view, "propose_form") as Result;
    if (result?.card) return { text: "Here's the Corrective Action Form for **Odessa**." };
    if (result) return { text: result.ask_exactly ?? `refused: ${result.reason_code}` };
    const said = users(view).at(-1)?.text ?? "";
    /* evidenceFrom's last argument counts manager messages back from the latest: the request's first message is 1 back after SEPARATE. */
    const first = said === SEPARATE ? 1 : 0;
    return {
      tool: "propose_form",
      input: {
        template_key: "dpoa", employee_id: ODESSA.id, incident_date: date,
        what_happened: `Odessa was a no call no show for her shift on ${date.slice(5, 7)}/${date.slice(8)}/26.`,
        policy: headingWith(view, /attendance/i),
        person_evidence: evidenceFrom(view, "Odessa Fernwick", first),
        attendance: "absence", attendance_evidence: evidenceFrom(view, "no call no show", first),
        ...(said === SEPARATE ? { separate_incident_evidence: evidenceFrom(view, "this is a separate incident", 0) } : {}),
      },
    };
  });

async function chat(t: ReplayContext, first: string, date: string, state: OnFile = "finalized") {
  vi.setSystemTime(new Date("2026-11-23T18:00:00Z"));
  t.directory([...STAFF, ODESSA]);
  t.as("salon_director", KEARNEY);
  onFile(t, state);
  t.loopModel!(model(date));
  const thread = t.thread();
  const reply = await thread.say(first);
  return { thread, reply };
}

/** The loop is what this check lives in: off (the flags-off run) or live, there is nothing to replay. */
const skip = (t: ReplayContext) => !t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1";

export const NOV24_AGENT_LOOP_SAME_INCIDENT_ON_FILE_CASES: ReplayCase[] = [
  {
    id: "nov24-same-incident-finalized-ca-on-file-is-said",
    title: "\"create a corrective action for Odessa Fernwick, she was a no call no show on 11/18\" with a CA for 11/18 finalized 11/19 on file: no card yet; the reply says \"Odessa already has a Corrective Action for 11/18 (finalized 11/19). Do you want to open that one, or is this a separate incident?\"",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (skip(t)) return;
      const { thread, reply } = await chat(t, ON_1118, "2026-11-18");
      expect(thread.proposal ?? null, `a second CA for 11/18 was put up with no word of the one on file:\n${reply.content}`).toBeNull();
      expect(reply.content).toContain("already has a Corrective Action for 11/18 (finalized 11/19). Do you want to open that one, or is this a separate incident?");
    },
  },
  {
    id: "nov24-same-incident-draft-on-file-is-said",
    title: "The same with a DRAFT CA for 11/18 on file: the reply says Odessa already has one for 11/18 (a draft) and asks; no card yet",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (skip(t)) return;
      const { thread, reply } = await chat(t, ON_1118, "2026-11-18", "draft");
      expect(thread.proposal ?? null, reply.content).toBeNull();
      expect(reply.content).toContain("already has a Corrective Action for 11/18 (a draft)");
    },
  },
  {
    id: "nov24-same-incident-separate-answer-builds-card",
    title: "After the question, \"this is a separate incident, she no-showed her second shift that day too\": the card is made for 11/18 (a genuinely separate incident is never blocked)",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (skip(t)) return;
      const { thread } = await chat(t, ON_1118, "2026-11-18");
      const reply = await thread.say(SEPARATE);
      expect(thread.proposal?.templateKey, reply.content).toBe("dpoa");
      expect(thread.proposal?.formDate).toBe("2026-11-18");
    },
  },
  {
    id: "nov24-same-incident-other-date-no-warning",
    title: "Control: a no call no show on 11/20 with the 11/18 CA on file: the card is made and the reply never says one already exists",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (skip(t)) return;
      const { thread, reply } = await chat(t, ON_1120, "2026-11-20");
      expect(thread.proposal?.templateKey, reply.content).toBe("dpoa");
      expect(reply.content).not.toMatch(/already has|separate incident/);
    },
  },
  {
    id: "nov24-same-incident-create-is-held-at-the-last-gate",
    title: "Create, the last gate: Odessa's CA card for 11/20 was made with nothing on file that day; another manager then starts a CA for her 11/20; Create is held with the same question, and no second form is saved",
    report: "Ask Bubbles' QA's live check of #1123 (24 Nov 2026): the same check at Create, when the form date is known, catches every path",
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (skip(t)) return;
      const { thread } = await chat(t, ON_1120, "2026-11-20");
      expect(thread.proposal?.templateKey, "no 11/20 card (the case proves nothing)").toBe("dpoa");
      onFile(t, "draft", "ca-odessa-1120", "2026-11-20");
      const before = (t.forms() as Record<string, unknown>[]).length;
      await expect(thread.create(), "Create saved a second CA for 11/20").rejects.toThrow(/already has a Corrective Action for 11\/20 \(a draft\)\. Do you want to open that one, or is this a separate incident\?/);
      expect((t.forms() as Record<string, unknown>[]).length, "a form was saved").toBe(before);
    },
  },
  {
    id: "nov24-same-incident-create-after-separate-answer-saves",
    title: "Control: after \"this is a separate incident …\" the 11/18 card's Create saves (the loop cleared that date; the last gate never asks again)",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (skip(t)) return;
      const { thread } = await chat(t, ON_1118, "2026-11-18");
      await thread.say(SEPARATE);
      expect(thread.proposal?.templateKey).toBe("dpoa");
      const id = await thread.create();
      expect(id).toBeTruthy();
    },
  },
];
