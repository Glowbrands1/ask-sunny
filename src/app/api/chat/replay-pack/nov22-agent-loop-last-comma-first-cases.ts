import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * "<LAST>, <FIRST>" IS THE STAFF LIST'S <FIRST> <LAST> (QA's re-run, 22 Nov 2026, C3; port of Ask Bubbles #1012)
 * ============================================================================
 *
 * Found in Ask Bubbles, the same code in Sunny. The manager's turn, word for word (the person invented, not on the
 * directory; the sibling's place word is Sunny's salon here): "create a CA form for <Last>, <First> at <salon>. she was
 * late on 10-16". Live: the card's name stayed "<Last>, <First>"; the reply's bold broke ("**<Last>,**." and "**<Last>,
 * **<Last>, <First>** isn't on the staff list…"); the saved Observation said it twice; the Expectation used the
 * surname as the first name. A name written with one comma is read by its own shape against the staff list: the two
 * parts swapped name exactly one person there.
 */

const REPORT = "QA's re-run (22 Nov 2026, C3; found in Ask Bubbles): \"<Last>, <First>\" stayed on the card as typed, off the staff list";
const T1 = "create a CA form for larkspur, vesna at kearney. she was late on 10-16";

export const NOV22_AGENT_LOOP_LAST_COMMA_FIRST_CASES: ReplayCase[] = [
  {
    id: "nov22-c3-last-comma-first-is-the-staff-person",
    title: "C3: \"create a CA form for <Last>, <First> at kearney. she was late on 10-16\": the card is the staff list's <First> <Last>, the reply never shows \"<Last>, <First>\", and the saved Observation says the lateness once",
    report: REPORT,
    status: "fixed",
    fixFlags: ["AGENT_LOOP_ENABLED"],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      let lastFound: unknown = null;
      t.loopModel!(loopStandIn((view): LoopDecision => {
        lastFound = lastResult(view, "find_staff") ?? lastFound;
        const found = lastResult(view, "find_staff") as { matches?: { employee_id?: string }[]; employee_id?: string } | null;
        if (!found) return { tool: "find_staff", input: { name: "larkspur, vesna", person_evidence: evidenceFrom(view, "larkspur, vesna") } };
        const result = lastResult(view, "propose_form") as { card?: { employee?: string }; not_on_roster?: string } | null;
        const proposals = view.results.filter((entry) => entry.tool === "propose_form").length;
        // As live: the first propose_form says the name is not on the staff list; the model proposes again with it as typed.
        if (result && !result.card && result.not_on_roster && proposals === 1) {
          return { tool: "propose_form", input: { template_key: "dpoa", employee_name: result.not_on_roster, what_happened: "larkspur, vesna was late on 10/16.", incident_date: "2026-10-16", policy: headingWith(view, /^attendance/i), salon: "kearney", person_evidence: evidenceFrom(view, "larkspur, vesna") } };
        }
        if (result) return { text: result.card ? `Here's the Corrective Action Form for **${result.card.employee}**.` : JSON.stringify(result).slice(0, 400) };
        return { tool: "propose_form", input: { template_key: "dpoa", ...(JSON.stringify(found).match(/"employee_id":"([^"]+)"/) ? { employee_id: JSON.stringify(found).match(/"employee_id":"([^"]+)"/)![1] } : { employee_name: "larkspur, vesna" }), what_happened: "larkspur, vesna was late on 10/16.", incident_date: "2026-10-16", policy: headingWith(view, /^attendance/i), salon: "kearney", person_evidence: evidenceFrom(view, "larkspur, vesna") } };
      }));
      const thread = t.thread();
      const reply = await thread.say(T1);
      expect(thread.proposal?.employeeName, `${reply.content}\nFIND ${JSON.stringify(lastFound).slice(0, 600)}`).toBe("Vesna Larkspur");
      expect(reply.content, "the reply shows the name as typed").not.toMatch(/Larkspur,/);
      const id = await thread.create();
      const observation = Object.entries(t.values(id)).filter(([key]) => /observ|issue|details|offense/i.test(key)).map(([, value]) => String(value)).join("\n");
      expect((observation.match(/late/gi) ?? []).length, `the Observation states the lateness more than once:\n${observation}`).toBeLessThanOrEqual(1);
    },
  },
];
