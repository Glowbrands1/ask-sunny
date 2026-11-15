import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * PR 2 OF THE LOOP REBUILD: THE SERVER-SIDE CARD RECORD (QA's design, 15 Nov 2026)
 * ============================================================================
 *
 * Whose earlier card it was is read from the server's record of the cards this chat made (chat_traces), compared by
 * roster id, never from the reply's text. The old reader needed the earlier reply to name someone in bold, so a card
 * reply that named its person plainly, or not at all, never kept the earlier card. People are STAFF's invented ones.
 */
const REPORT = "QA, 15 Nov 2026: the rebuild plan's PR 2, the card record replaces CARD_REPLY and the bold-name match";
const FLAG = "AGENT_LOOP_ENABLED";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-11T16:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

const proposed = (views: readonly LoopView[]) =>
  views.flatMap((view) => view.results).filter((result) => result.tool === "propose_form").at(-1)?.output as
    | { card?: Record<string, unknown>; facts?: Record<string, unknown> }
    | undefined;

const cardFor = (employee: string, account: string) =>
  ({ tool: "propose_form", input: { template_key: "dpoa", employee_id: employee, policy: "Attendance", what_happened: account, warning_level: "verbal" } }) as const;

export const NOV15_AGENT_LOOP_PR2_CARD_RECORD_CASES: ReplayCase[] = [
  {
    id: "nov15-pr2-earlier-card-kept-by-record",
    title: "a card for another person keeps the earlier card, by the server's record, though no reply named anyone in bold",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      // Replies that name nobody in bold: the old reader (`namesSomeone`) never saw whose card the earlier one was.
      t.loopModel!(loopStandIn((view) => (lastResult(view, "propose_form") ? { text: "Here is the card." } : cardFor("e-2", "Late on 11/9/26."))));
      await thread.say("verbal ca for remy calder, she was 20 minutes late on 11/9/26");
      const second = loopStandIn((view) => (lastResult(view, "propose_form") ? { text: "Here is the second card." } : cardFor("e-3", "Late on 11/10/26.")));
      t.loopModel!(second);
      await thread.say("the same for juno paxton, she was late on 11/10/26");
      const result = proposed(second.views);
      expect(result?.facts?.earlier_card, "the earlier card was not said to stay").toMatchObject({ kept: true, employee: "Remy Calder" });
      expect((thread.proposal as { earlierCardKept?: boolean } | undefined)?.earlierCardKept, "the earlier card is not kept creatable").toBe(true);
    },
  },
  {
    id: "nov15-pr2-same-person-card-never-keeps-earlier",
    title: "a later card for the same person never says the earlier card stays, whatever the earlier reply named",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      // The earlier reply names someone else in bold; the old reader took that as another person's card.
      t.loopModel!(loopStandIn((view) => (lastResult(view, "propose_form") ? { text: "Here is the card. **Juno Paxton** can sign as witness." } : cardFor("e-2", "Late on 11/9/26."))));
      await thread.say("verbal ca for remy calder, she was 20 minutes late on 11/9/26");
      const again = loopStandIn((view) => (lastResult(view, "propose_form") ? { text: "Here is the card, now written." } : cardFor("e-2", "Late on 11/9/26.")));
      t.loopModel!(again);
      const reply = await thread.say("make it a written");
      expect(proposed(again.views)?.facts?.earlier_card, "the same person's card was said to keep an earlier one").toBeUndefined();
      expect(reply.content).not.toContain("The earlier card or form stays as it is.");
    },
  },
];
