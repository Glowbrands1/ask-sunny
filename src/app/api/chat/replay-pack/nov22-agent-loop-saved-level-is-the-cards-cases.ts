import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * THE SAVED FORM HAS THE CARD'S WARNING LEVEL (QA's round 2, 22 Nov 2026, U09; port of Ask Bubbles #1016)
 * ============================================================================
 *
 * Found in Ask Bubbles, the same code in Sunny. The manager's turns (the person invented, the pack's roster): T1 "create a written CA for <P6>." T2 "JBA Policy Manual 1-1-2026, Verbal CA
 * 11-1-2026. On 11-1-26 <P6> violated care and cleaning of facilities policy". The card said Written; the saved draft had
 * no warning level: Create re-read the conversation and found "Verbal CA" (a prior step). A loop card's level is locked
 * on the manager's evidence at card time and recorded server-side; Create saves the level that record holds.
 */

const REPORT = "QA's round 2 (22 Nov 2026, U09; found in Ask Bubbles): the card said Written, the saved draft had no warning_type";
const T1 = "create a written CA for Remy Calder.";
const T2 = "JBA Policy Manual 1-1-2026, Verbal CA 11-1-2026. On 11-1-26 Remy Calder violated care and cleaning of facilities policy";

export const NOV22_AGENT_LOOP_SAVED_LEVEL_IS_THE_CARDS_CASES: ReplayCase[] = [
  {
    id: "nov22-r2-u09-saved-level-is-the-cards",
    title: "U09: T1 \"create a written CA for <P6>.\", T2 \"JBA Policy Manual 1-1-2026, Verbal CA 11-1-2026. On 11-1-26 …\": the card says Written and Create saves Written (never the prior step's Verbal, never none)",
    report: REPORT,
    status: "fixed",
    fixFlags: ["AGENT_LOOP_ENABLED"],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (lastResult(view, "propose_form")) return { text: "Here's the Corrective Action Form for **Remy**." };
        const said = view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0).at(-1)?.text ?? "";
        const second = said.startsWith("JBA");
        return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", warning_level: "written", level_evidence: evidenceFrom(view, "written", second ? 1 : 0), ...(second ? { what_happened: "On 11/1/26 Remy violated the care and cleaning of facilities policy.", incident_date: "2026-11-01", policy: headingWith(view, /care and cleaning/i) } : {}), person_evidence: evidenceFrom(view, "Remy Calder") } };
      }));
      const thread = t.thread();
      await thread.say(T1);
      await thread.say(T2);
      expect(thread.proposal?.warningLevel, "the card is not Written (the case proves nothing)").toBe("written");
      const id = await thread.create();
      expect(t.checked(id).warning_type ?? [], "the saved form lost the card's level").toEqual(["written"]);
    },
  },
];
