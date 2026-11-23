import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * PORT OF ASK BUBBLES #1113 (cbfd1847; its QA's round 2, U25): "NOTHING ELSE CHANGED" WHEN THE TOPIC WENT, AND
 * "WHAT HAPPENED:" IN THE SAVED DETAILS
 * ============================================================================
 *
 * The manager's turns, word for word from Bubbles' U25 (a salon director at Kearney here; the person invented, off the
 * roster): T1 "Which forms can I create here?", T2 "create a coaching form for <P typo>", T3 "yes", T4 "coaching for
 * undersales", T5 "create coaching form for <P>; coaching on under performance".
 *   - T5's card dropped T4's topic, and its reply said "I changed the name on the card from **<typo>** to **<P>**;
 *     nothing else changed." The name_corrected fact now lists what else changed (also_changed).
 *   - The saved Coaching Details read "Observed:\nWhat happened: <P> had under performance.": the card's own line label.
 *     The loop coaching write-up now drops it.
 */

const REPORT = "Ask Bubbles' QA round 2 (U25), ported: T5's reply said \"nothing else changed\" while the topic was dropped; the saved Details carried a literal \"What happened:\" prefix";
const FLAG = "AGENT_LOOP_ENABLED";
const T1 = "Which forms can I create here?";
const T2 = "create a coaching form for Odalys Fenwrite";
const T3 = "yes";
const T4 = "coaching for undersales";
const T5 = "create coaching form for Odalys Fenwright; coaching on under performance";

const said = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0).at(-1)?.text ?? "";
type Result = { card?: unknown; facts?: { name_corrected?: { from: string; to: string; also_changed?: string[] } } } | null;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-12T16:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

/** The model, as the tester's run: T5's card is for the corrected name, its account the manager's words, no topic. */
const model = () =>
  loopStandIn((view): LoopDecision => {
    const message = said(view);
    const result = lastResult(view, "propose_form") as Result;
    if (result) {
      const corrected = result.facts?.name_corrected;
      if (!corrected) return { text: "Here's the Coaching Form for **Odalys Fenwrite**. What happened?" };
      const also = corrected.also_changed ?? [];
      return { text: `I changed the name on the card from **${corrected.from}** to **${corrected.to}**${also.length ? `. Also changed: ${also.join("; ")}.` : "; nothing else changed."}` };
    }
    if (message === T1) return { text: "Here are the forms you can create." };
    if (message === T2) return { tool: "propose_form", input: { template_key: "coaching", employee_name: "Odalys Fenwrite", person_evidence: evidenceFrom(view, "Odalys Fenwrite") } };
    if (message === T3) return { text: "What happened? Tell me what you'd like to coach Odalys on." };
    if (message === T4) {
      return {
        tool: "propose_form",
        input: { template_key: "coaching", employee_name: "Odalys Fenwrite", person_evidence: evidenceFrom(view, "Odalys Fenwrite", 2), what_happened: "Odalys had undersales.", topic: "undersales", topic_evidence: evidenceFrom(view, "coaching for undersales") },
      };
    }
    return { tool: "propose_form", input: { template_key: "coaching", employee_name: "Odalys Fenwright", person_evidence: evidenceFrom(view, "Odalys Fenwright"), what_happened: "Odalys had under performance." } };
  });

export const NOV23_U25_NAME_CORRECTED_ALSO_CHANGED_CASES: ReplayCase[] = [
  {
    id: "nov23-u25-name-corrected-says-what-else-changed",
    title: `U25 (port): T1–T5 verbatim; T5 "${T5}" corrects the name and drops the topic — the name_corrected fact lists the topic change, so the reply never says "nothing else changed"`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t);
      const standIn = model();
      t.loopModel!(standIn);
      const thread = t.thread();
      for (const turn of [T1, T2, T3, T4]) await thread.say(turn);
      expect((thread.proposal as { coachingTopic?: string } | null)?.coachingTopic, "T4's card has no topic (the case proves nothing)").toMatch(/^undersales$/i);
      const reply = await thread.say(T5);
      expect(thread.proposal?.employeeName, "no card for the corrected name (the case proves nothing)").toBe("Odalys Fenwright");
      expect((thread.proposal as { coachingTopic?: string | null } | null)?.coachingTopic ?? null, "T5's card kept the topic (the case proves nothing)").toBeNull();
      const result = standIn.views.flatMap((view) => view.results).filter((entry) => entry.tool === "propose_form").at(-1)?.output as Result;
      expect(result?.facts?.name_corrected, "no name_corrected fact (the case proves nothing)").toBeDefined();
      expect(result?.facts?.name_corrected?.also_changed ?? [], "the name_corrected fact does not say the topic went").toContainEqual(expect.stringMatching(/coaching topic: Undersales → none/i));
      expect(reply.content, "the reply says nothing else changed while the topic was dropped").not.toMatch(/nothing else changed/i);
    },
  },
  {
    id: "nov23-u25-saved-details-no-what-happened-label",
    title: "U25 (port): Create of T5's card — the saved Coaching Details never carry the card's own \"What happened:\" label",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      start(t);
      t.loopModel!(model());
      const thread = t.thread();
      for (const turn of [T1, T2, T3, T4, T5]) await thread.say(turn);
      expect(thread.proposal?.employeeName, "no card (the case proves nothing)").toBe("Odalys Fenwright");
      // The drafting model, as in the tester's run: it echoed the card's own line into Observed.
      t.draftWrites({ coaching_details: "Observed:\nWhat happened: Odalys had under performance." });
      const id = await thread.create();
      const saved = t.values(id).coaching_details ?? "";
      expect(saved, `the saved Details carry the card's line label:\n${saved}`).not.toMatch(/What happened:/);
      expect(saved, `the account is gone from the saved Details:\n${saved}`).toMatch(/Odalys had under performance\./);
    },
  },
];
