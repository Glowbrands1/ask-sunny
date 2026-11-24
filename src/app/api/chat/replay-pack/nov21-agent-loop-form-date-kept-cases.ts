import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * ONCE SET, THE FORM DATE STAYS UNTIL THE MANAGER CHANGES IT (port from the sibling app: its QA's live re-test, 21 Nov
 * 2026; and QA2's Sunny live R3, 21 Nov 2026)
 * ============================================================================
 *
 * The sibling's conversation (the person invented: the pack's Remy Calder): T1 "… She was late on 10/5 and 10/15" put
 * 2026-10-15 on the card; a later turn rebuilt it with no date (the live model left incident_date out) and Create saved
 * today (2026-11-21). Expected: the last offense date the manager gave stays unless they change it.
 *
 * QA2's Sunny live R3: the reply asked "Which date goes on the form?" (the card had lost its date, and two dates were
 * stated) and Create went through unanswered: the saved form_date was today. The same fix: the card keeps the date it
 * already had, so there is nothing to ask and Create saves that date. Invented person: Tavish Orcutt (on no fixture).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Port from the sibling app (its QA's live re-test, 21 Nov 2026, agent loop on): the card's 2026-10-15 was dropped on a later turn and the saved form_date became today";
const REPORT_R3 = "QA2's Sunny live R3 (21 Nov 2026): the reply asked \"Which date goes on the form?\", Create went through unanswered, and the saved form_date was today";
const users = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").length;
const T1 = "My employee Remy Calder was 10 minutes late on her last two shifts. On the first shift I verbally coached her on our policy and expectations. Then she was late again. Please create a CA form so I can document. She was late on 10/5 and 10/15";
const T2 = "Create the coaching form with the information given";
const T3 = "she is at the Kearney salon";
const ACCOUNT = "Remy was 10 minutes late on her last two shifts. On the first shift she was verbally coached on policy and expectations. Then she was late again on 10/15.";
const TODAY = "2026-11-21";

const formDate = (proposal: unknown) => (proposal as { formDate?: string | null } | null)?.formDate ?? null;
const cardDate = (view: LoopView) => ((lastResult(view, "propose_form") as { card?: { form_date?: string | null } } | null)?.card?.form_date ?? null);

/** T1 the CA card dated 10/15; T2 the Coaching card dated 10/15; T3 the card again with no incident_date (or `t3Date`), as live. */
const live = (t3Date?: string) =>
  loopStandIn((view): LoopDecision => {
    const turn = users(view);
    if (lastResult(view, "propose_form")) return { text: cardDate(view) ? "Here is the card." : "Here is the card. Which date goes on the form: 10/5 or 10/15?" };
    if (turn <= 1) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: ACCOUNT, incident_date: "2026-10-15", person_evidence: evidenceFrom(view, "Remy Calder") } };
    return { tool: "propose_form", input: { template_key: "coaching", employee_id: "e-2", what_happened: ACCOUNT, ...(turn === 2 ? { incident_date: "2026-10-15", form_change_evidence: evidenceFrom(view, "Create the coaching form") } : t3Date ? { incident_date: t3Date } : {}), person_evidence: evidenceFrom(view, "Remy Calder", turn - 1) } };
  });

function start(t: ReplayContext, people: readonly DirectoryRow[] = []) {
  vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
  t.directory([...STAFF, ...people]);
  t.as("salon_director", KEARNEY);
}

const fixed = (id: string, title: string, t3Date: string | undefined, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.()) return;
    start(t);
    t.loopModel!(live(t3Date));
    await run(t);
  },
});

/** QA2's R3 person, invented. */
const TAVISH: DirectoryRow = { id: "e-tavish-orcutt", firstName: "Tavish", lastName: "Orcutt", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const R3_T1 = "ca for Tavish Orcutt, he was late on the last two shifts, 11/17 and 11/18";
const R3_T2 = "he works at Kearney";
const R3_ACCOUNT = "Tavish was late on the last two shifts, 11/17 and 11/18.";

export const NOV21_AGENT_LOOP_FORM_DATE_KEPT_CASES: ReplayCase[] = [
  fixed("nov21-agent-loop-form-date-kept-later-turn", `T1 "… She was late on 10/5 and 10/15" … T3 "${T3}" (no date from the model): the card keeps 2026-10-15, and Create saves form_date 2026-10-15, never today`, undefined, async (t) => {
    const thread = t.thread();
    for (const said of [T1, T2]) await thread.say(said);
    expect(formDate(thread.proposal), "T2's card lost the date").toBe("2026-10-15");
    await thread.say(T3);
    expect(formDate(thread.proposal), "T3's card lost the date").toBe("2026-10-15");
    const id = await thread.create();
    expect(t.values(id).form_date, "Create saved another date").toBe("2026-10-15");
  }),
  fixed("nov21-agent-loop-form-date-manager-changes-it", "The same chat, T3 \"it was 10/5, not 10/15\": the date the manager gives now replaces the kept one", "2026-10-05", async (t) => {
    const thread = t.thread();
    for (const said of [T1, T2]) await thread.say(said);
    await thread.say("it was 10/5, not 10/15");
    expect(formDate(thread.proposal)).toBe("2026-10-05");
  }),
  {
    id: "nov21-sunny-r3-form-date-not-silently-today",
    title: `QA2's Sunny R3: "${R3_T1}" (card dated 11/18), then "${R3_T2}" with no date from the model: the reply never asks "Which date goes on the form?", and Create (pressed with no date answer) saves 2026-11-18, never today`,
    report: REPORT_R3,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t, [TAVISH]);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const turn = users(view);
        if (lastResult(view, "propose_form")) return { text: cardDate(view) ? "Here's the Corrective Action Form for **Tavish**." : "Here's the Corrective Action Form for **Tavish**. Which date goes on the form?" };
        return { tool: "propose_form", input: { template_key: "dpoa", employee_id: TAVISH.id, what_happened: R3_ACCOUNT, ...(turn === 1 ? { incident_date: "2026-11-18" } : {}), person_evidence: evidenceFrom(view, "Tavish Orcutt", turn - 1) } };
      }));
      const thread = t.thread();
      await thread.say(R3_T1);
      expect(formDate(thread.proposal), "T1's card has no date (the case proves nothing)").toBe("2026-11-18");
      const reply = await thread.say(R3_T2);
      expect(reply.content, `the reply asked for a date the card already had:\n${reply.content}`).not.toMatch(/Which date goes on the form/i);
      expect(formDate(thread.proposal), "T2's card lost the date").toBe("2026-11-18");
      const id = await thread.create();
      expect(t.values(id).form_date, "Create saved today's date, silently").not.toBe(TODAY);
      expect(t.values(id).form_date).toBe("2026-11-18");
    },
  },
];
