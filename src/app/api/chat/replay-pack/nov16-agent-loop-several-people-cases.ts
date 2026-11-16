import { expect, vi } from "vitest";

import type { ChatFormProposal } from "@/types";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * SEVERAL PEOPLE IN ONE MESSAGE: ONE CARD ON SCREEN, THE NEXT ONE OFFERED (QA's live re-test on 269ac0d9, 16 Nov 2026, item B)
 * ============================================================================
 *
 * "write CAs for <A> and <B>, both late on 11/14": the live model called propose_form twice in ONE step. The calls ran
 * together, both passed the one_card check (no card yet), and the second replaced the first; the reply said "Here's the
 * Corrective Action Form for <A>. … Here's the Corrective Action Form for <B>. … Both cards are ready - press Create on
 * each", the stored message carried one card (r1: <A>, r2: <B>), and the "yes" after it was answered as a payroll or level
 * question ('"Yes" alone doesn't tell me whether that's for payroll deduct, warning level, or both').
 * The rule (rules book line "Several people in one request", now checked where the card is set): the first card stays on
 * screen, another person's card this turn is refused (one_card) with the offer to ask, and the reply describes only the
 * card on screen and ends with that offer. "yes" builds the next card and is never its payroll or level answer.
 * Invented names only (Remy Calder, Rowan Kestrel).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's live re-test on 269ac0d9 (16 Nov 2026), item B: \"write CAs for <A> and <B>, both late on 11/14\" showed one card while the reply described two, and \"yes\" was read as a payroll/level answer";
const PEOPLE: Record<string, { id: string; first: string }> = {
  remy: { id: "e-2", first: "Remy" },
  rowan: { id: "e-4", first: "Rowan" },
};

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-16T15:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const ca = (who: { id: string; first: string }) => ({ template_key: "dpoa", employee_id: who.id, what_happened: `${who.first} was late on 11/14.`, incident_date: "2026-11-14", policy: "Attendance" });

/** The reply a model writes from the turn's propose_form results, as the live one did; an offer it was given ends it. */
function replyFrom(view: LoopView): string {
  const results = view.results.filter((result) => result.tool === "propose_form").map((result) => result.output as { facts?: { reply_name?: string }; reason_code?: string; ask_exactly?: string });
  const made = results.filter((result) => !result.reason_code);
  const offer = results.find((result) => result.reason_code && result.ask_exactly)?.ask_exactly;
  const lines = made.map((result) => `Here's the Corrective Action Form for **${result.facts?.reply_name ?? "them"}**. **Observation of Offense:** Late on 11/14.`);
  if (made.length > 1) lines.push("Both cards are ready - press Create on each.");
  if (offer) lines.push(offer);
  return lines.join("\n\n");
}

export const NOV16_AGENT_LOOP_SEVERAL_PEOPLE_CASES: ReplayCase[] = [
  {
    id: "nov16-several-people-one-card-then-yes",
    title: "QA's live re-test item B: \"write CAs for remy calder and rowan kestrel, both late on 11/14\" (two propose_form calls in one step) shows ONE card, the reply describes only it and ends offering the other person's form; \"yes\" then builds that person's card, with no payroll or level taken from the \"yes\"",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (view.results.length === 0) return { tools: [{ tool: "propose_form", input: ca(PEOPLE.remy!) }, { tool: "propose_form", input: ca(PEOPLE.rowan!) }] };
        return { text: replyFrom(view) };
      }));
      const thread = t.thread();
      const first = await thread.say("write CAs for remy calder and rowan kestrel, both late on 11/14");
      const shown = (first.formProposal as ChatFormProposal | undefined)?.employeeName ?? "";
      expect(["Remy Calder", "Rowan Kestrel"], `no card shown: ${first.content}`).toContain(shown);
      const other = shown === "Remy Calder" ? PEOPLE.rowan! : PEOPLE.remy!;
      expect(first.content, "the reply describes a card that is not on screen").not.toMatch(/both cards/i);
      expect(first.content, "the reply does not offer the other person's form").toMatch(new RegExp(`Want me to make the Corrective Action Form for ${other.first} next\\?\\s*$`));
      expect(first.content.match(/Here's the Corrective Action Form/g) ?? []).toHaveLength(1);

      // "yes": the model builds the offered card; it also tries the live mistake of taking "yes" as the payroll answer.
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (view.results.length === 0) return { tool: "propose_form", input: { ...ca(other), payroll_deduct: "yes", payroll_evidence: evidenceFrom(view, "yes") } };
        return { text: replyFrom(view) };
      }));
      const second = await thread.say("yes");
      const card = second.formProposal as ChatFormProposal | undefined;
      expect(card?.employeeName, `the "yes" did not build the offered card: ${second.content}`).toBe(other.first === "Remy" ? "Remy Calder" : "Rowan Kestrel");
      expect(card?.payrollDeduct ?? null, "the \"yes\" to the offer was taken as the payroll answer").toBeNull();
      expect(card?.warningLevel ?? null, "the \"yes\" to the offer was taken as the level").toBeNull();
      expect(second.content).not.toMatch(/"yes" alone/i);
    },
  },
];
