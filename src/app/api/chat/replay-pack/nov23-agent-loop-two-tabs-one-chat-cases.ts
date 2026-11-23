import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * ONE TAB NEVER GETS ANOTHER TAB'S CARD (port of Ask Bubbles #1079; its QA, 23 Nov 2026: the duplicate-tab finding)
 * ============================================================================
 *
 * Found in Ask Bubbles, the same code in Sunny. The open chat's id is in the address (`?c=<id>`), and a tab opened on
 * that address (Duplicate tab, a copied address) joins the same conversation id. The loop's records (the card, the name
 * question, the which-form question) are read by conversation id, so the second tab's turn took the first tab's card as
 * the chat's card. A record counts for this turn only when it is this request's own: its message is in this tab's
 * history (by id, or by its question key), or it is older than this history's window. A fresh tab's first turn has none.
 * The person is invented (Remy Calder, the pack's own STAFF).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA (23 Nov 2026, found in Ask Bubbles): a manager's two tabs on one conversation id (a duplicated tab) — tab B's turn took tab A's card";
const offline = process.env.AGENT_LOOP_LIVE !== "1";
const REMY = STAFF.find((row) => row.id === "e-2")!;

export const NOV23_AGENT_LOOP_TWO_TABS_ONE_CHAT_CASES: ReplayCase[] = [
  {
    id: "nov23-two-tabs-one-conversation-no-crossed-card",
    title: "Two tabs on one conversation id: tab A makes Remy Calder's Corrective Action card; tab B, a fresh thread on the same id, says \"make it a written warning\" and never gets tab A's card",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      /* The stand-in proposes the card in tab A; in tab B it answers with no card call. Hand-backs it is given are kept. */
      const handedBack: string[] = [];
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const check = view.turns.filter((turn) => turn.role === "user").map((turn) => turn.text).find((text) => text.includes("[app check]"));
        if (check) handedBack.push(check);
        const result = lastResult(view, "propose_form") as { card?: { employee?: string }; ask_exactly?: string } | null;
        if (result) return { text: result.card ? `Here's the Corrective Action Form for **${result.card.employee}**.` : (result.ask_exactly ?? "Who is this for?") };
        const said = view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
        if (/remy/i.test(said)) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: REMY.id, person_evidence: evidenceFrom(view, "Remy Calder"), what_happened: "Remy was late on 11/12.", incident_date: "2026-11-12", policy: headingWith(view, /attendance/i) } };
        /* Tab B: a reply with no card call, about "her" (the person tab B's manager has in mind; no card in tab B). */
        return { text: "**Type of Warning:** Written Warning, as you said. She will get a written warning." };
      }));
      const tabA = t.thread({ idPrefix: "a" });
      await tabA.say("ca for Remy Calder, she was late on 11/12");
      expect(tabA.proposal?.employeeName, "tab A has no card (the case proves nothing)").toBe("Remy Calder");
      handedBack.length = 0; // tab A's own hand-backs are not this case's
      const tabB = t.thread({ conversationId: tabA.conversationId, idPrefix: "b" });
      const reply = await tabB.say("make it a written warning");
      expect(tabB.proposal?.employeeName ?? null, `tab B got tab A's card:\n${reply.content}`).not.toBe("Remy Calder");
      expect(reply.content, "tab B's reply names tab A's person").not.toMatch(/Remy/);
      /* Tab B has no card, so its reply is never checked against tab A's card ("No card was proposed this turn, so the card on the manager's screen …"). */
      expect(handedBack.join("\n---\n"), "tab B's reply was handed back against tab A's card").toBe("");
      expect(reply.content, "tab B's reply was checked against tab A's card").not.toMatch(/isn't on the card yet|on the card on screen/i);
    },
  },
];
