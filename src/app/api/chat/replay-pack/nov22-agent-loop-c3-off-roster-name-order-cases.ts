import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * AN OFF-ROSTER "<LAST>, <FIRST>" STILL GETS ITS CARD, AS "<FIRST> <LAST>" (port of Ask Bubbles #1054: its QA's live
 * round 3, 22 Nov 2026, C3 regression)
 * ============================================================================
 *
 * Found in Ask Bubbles, the same code in Sunny. The manager's turn, word for word (the person invented, nobody on the
 * staff list; the sibling's place word is Sunny's salon here): "create a CA form for <Last>, <First> at <salon>. she was
 * late on 10-16". Live, the reply said "<First> <Last> isn't on your … staff list, and the form wasn't built" and there
 * was no card: the model passed the name in first-last order, which the manager never typed in that order, so every
 * as-typed check missed it, while find_staff's code said "propose it as typed" — the model went round 3–6 times and gave
 * up. Now the name is read in the manager's own order (`asManagerCommaWrote`), and a name find_staff takes as typed is
 * taken as typed by propose_form on the same call (`lookUpForCard`'s asTyped).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's Bubbles live round 3 (22 Nov 2026, C3 regression; port of Ask Bubbles #1054): an off-roster \"<Last>, <First>\" got no card, \"isn't on your … staff list, and the form wasn't built\"";
const T1 = "create a CA form for Pellwood, Vashti at kearney. she was late on 10-16";
const ADMIN = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

const proposal = (view: Parameters<Parameters<typeof loopStandIn>[0]>[0]) => ({
  tool: "propose_form" as const,
  input: { template_key: "dpoa", employee_name: "Vashti Pellwood", what_happened: "Vashti was late on 10/16.", incident_date: "2026-10-16", policy: headingWith(view, /^attendance/i), salon: "kearney", person_evidence: evidenceFrom(view, "Pellwood, Vashti") },
});

/* The sibling's tester used an all-salon admin; the live reply said "your … staff list", so a salon login too. */
const LOGINS = [
  { id: "nov22-c3-off-roster-last-comma-first-gets-card", role: "admin", scope: ADMIN, who: "an all-salon admin" },
  { id: "nov22-c3-off-roster-last-comma-first-gets-card-salon-login", role: "salon_director", scope: KEARNEY, who: "a salon director" },
] as const;

export const NOV22_AGENT_LOOP_C3_OFF_ROSTER_NAME_ORDER_CASES: ReplayCase[] = LOGINS.map((login): ReplayCase => ({
  id: login.id,
  title: `C3 regression (${login.who}): "create a CA form for <Last>, <First> at kearney. she was late on 10-16" (nobody on the staff list) gets a card for "<First> <Last>" with the off-roster note, even when the model passes the name in first-last order`,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
    vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
    t.directory([...STAFF]);
    t.as(login.role, login.scope);
    /* The stand-in: as live, the model passes the name in first-last order ("Vashti Pellwood"), quoting the manager's words. */
    t.loopModel!(loopStandIn((view): LoopDecision => {
      const result = lastResult(view, "propose_form") as { card?: { employee?: string }; ask_exactly?: string; error?: string } | null;
      if (result) return { text: result.card ? `Here's the Corrective Action Form for **${result.card.employee}**.` : (result.ask_exactly ?? result.error ?? "no card") };
      return proposal(view);
    }));
    const thread = t.thread();
    const reply = await thread.say(T1);
    expect(thread.proposal?.employeeName, `no card for the typed name:\n${reply.content}`).toBe("Vashti Pellwood");
    expect(reply.content, "the reply says the form was not built").not.toMatch(/wasn't built|wasn.t able to create/i);
  },
})).concat([
  {
    id: "nov22-c3-same-request-twice-never-loops",
    title: "C3 (find_staff and propose_form agree): the same off-roster \"<Last>, <First>\" request sent twice in a row gets a card each time, and propose_form never refuses the name find_staff takes as typed",
    report: `${REPORT}; find_staff said "propose it as typed" and propose_form refused that name, 3–6 times`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("admin", ADMIN);
      const refusals: string[] = [];
      /* The stand-in as the looping model: it proposes "<First> <Last>" and, refused, proposes that same name again. */
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const result = lastResult(view, "propose_form") as { card?: { employee?: string } } | null;
        if (result && !result.card) refusals.push(JSON.stringify(result).slice(0, 300));
        if (result?.card || view.step >= 6) return { text: result?.card ? `Here's the Corrective Action Form for **${result.card.employee}**.` : "no card" };
        return proposal(view);
      }));
      const thread = t.thread();
      for (const turn of [1, 2]) {
        const reply = await thread.say(T1);
        expect(thread.proposal?.employeeName, `turn ${turn}: no card:\n${reply.content}`).toBe("Vashti Pellwood");
        expect(refusals, `turn ${turn}: propose_form refused the name find_staff takes as typed`).toEqual([]);
      }
    },
  },
]);
