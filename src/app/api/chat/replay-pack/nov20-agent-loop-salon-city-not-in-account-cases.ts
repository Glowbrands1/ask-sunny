import { expect, vi } from "vitest";

import type { ChatFormProposal } from "@/types";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE SALON THE MANAGER NAMED IS THE CARD'S SALON, NOT PART OF THE ACCOUNT (QA item 20; Runner 2's c075, 20 Nov 2026)
 * ============================================================================
 *
 * c075: "coaching form for <P> at kearney about bed cleaning" made a card whose account read "At Kearney, coaching about
 * bed cleaning." The salon was already set from "at kearney". General rule: when the card's salon is one the manager named
 * in this request, a whole "at / in <that salon>" phrase in the account (the place's words, and only them, up to a comma
 * or the sentence's end) leaves the account. A place that is not the card's salon, a longer proper noun ("at lincoln
 * high") and a work area ("at the front desk") stay word for word. Invented names only (Remy Calder).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Runner 2's c075 (QA item 20, 20 Nov 2026): the salon city stayed in the account (\"At Kearney, coaching about bed cleaning.\")";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-17T08:30:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const card = (reply: { formProposal?: unknown }) => (reply.formProposal as ChatFormProposal | undefined) ?? null;
const managerTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);
const quoted = (view: LoopView, quote: string) => ({ message_id: [...managerTurns(view)].reverse().find((turn) => turn.text.toLowerCase().includes(quote.toLowerCase()))?.messageIds?.at(-1) ?? "current", quote });

/** The live model: the card with the given account, as written, place words and all. */
function withAccount(template: string, account: string) {
  return loopStandIn((view): LoopDecision => (lastResult(view, "propose_form")
    ? { text: "Here's the card for **Remy Calder**." }
    : { tool: "propose_form", input: { template_key: template, employee_name: "Remy Calder", person_evidence: quoted(view, "Remy Calder"), what_happened: account, ...(template === "coaching" ? { policy: "Other — Bed cleaning" } : {}) } }));
}

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || !offline) return;
    start(t);
    await run(t);
  },
});

export const NOV20_AGENT_LOOP_SALON_CITY_NOT_IN_ACCOUNT_CASES: ReplayCase[] = [
  fixed("nov20-salon-city-not-in-account-c075", "c075: \"coaching form for Remy Calder at kearney about bed cleaning\" and the model's account \"At Kearney, coaching about bed cleaning.\": the card's salon is NE Kearney and the account is \"Coaching about bed cleaning.\"", async (t) => {
    t.loopModel!(withAccount("coaching", "At Kearney, coaching about bed cleaning."));
    const reply = await t.thread().say("coaching form for Remy Calder at kearney about bed cleaning");
    expect(card(reply)?.locationId ?? null, JSON.stringify({ locationId: card(reply)?.locationId, locationName: card(reply)?.locationName })).toBe("loc-0309");
    expect(card(reply)?.issue, "the salon the manager named stayed in the account").toBe("Coaching about bed cleaning.");
  }),
  fixed("nov20-salon-city-not-in-account-sentence-end", "The salon at a sentence's end: \"ca for Remy Calder at kearney, she left the beds wet\" and the account \"She left the beds wet at Kearney.\": the account is \"She left the beds wet.\"", async (t) => {
    t.loopModel!(withAccount("dpoa", "She left the beds wet at Kearney."));
    const reply = await t.thread().say("ca for Remy Calder at kearney, she left the beds wet");
    expect(card(reply)?.issue, "the salon the manager named stayed in the account").toBe("She left the beds wet.");
  }),
  fixed("nov20-salon-city-control-other-places-kept", "Control: a longer proper noun and a work area stay word for word (\"She was at lincoln high during her shift, then at the front desk.\")", async (t) => {
    t.loopModel!(withAccount("dpoa", "She was at lincoln high during her shift, then at the front desk."));
    const reply = await t.thread().say("ca for Remy Calder at kearney, she was at lincoln high during her shift, then at the front desk");
    expect(card(reply)?.issue).toBe("She was at lincoln high during her shift, then at the front desk.");
  }),
  fixed("nov20-salon-city-control-not-named-by-manager", "Control: the manager named no place; the model's \"At Kearney, she left the beds wet.\" keeps its words (nothing the manager said set the salon from them)", async (t) => {
    t.loopModel!(withAccount("dpoa", "At Kearney, she left the beds wet."));
    const reply = await t.thread().say("ca for Remy Calder, she left the beds wet");
    expect(card(reply)?.issue).toBe("At Kearney, she left the beds wet.");
  }),
];
