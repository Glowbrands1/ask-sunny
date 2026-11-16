import { expect, vi } from "vitest";

import type { ChatFormProposal } from "@/types";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A NAME TAKEN AS TYPED IS SHOWN IN TITLE CASE (QA, 16 Nov 2026, train 5)
 * ============================================================================
 *
 * "coaching for test testy on greeting guests" (a name not on the staff list, typed in lowercase) came back "Here's the
 * Coaching Form for **test**" and "Observation of Offense: test left the register unattended": the lowercase typed form
 * was shown, as no roster spelling exists. The rule: a name taken as typed with no capital letter is shown in title case
 * everywhere (the card's name, reply_name, the pronoun pass); a name typed with any capital ("DeShawn") stays as typed;
 * a roster match keeps the roster's spelling. Invented names only (Lena Vossberg, DeShawn McKay: not on the pack's staff
 * list; Remy Calder: on it).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA (16 Nov 2026, train 5): \"coaching for test testy on greeting guests\" showed the off-roster name in lowercase (\"Here's the Coaching Form for **test**\")";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-16T19:10:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

type Output = { reply_name?: string; card?: { employee?: string }; reason_code?: string };
const proposed = (view: LoopView) => view.results.find((result) => result.tool === "propose_form")?.output as Output | undefined;

/** One coaching card for the name as typed; the reply uses the card's reply_name and a pronoun on the details line. */
function coachingFor(typedName: string, quote: string) {
  return loopStandIn((view): LoopDecision => {
    const done = proposed(view);
    if (!done) return { tool: "propose_form", input: { template_key: "coaching", employee_name: typedName, person_evidence: evidenceFrom(view, quote), what_happened: "Did not greet guests at the front desk." } };
    return { text: `Here's the Coaching Form for **${done.reply_name ?? typedName}**.\n**Coaching Details:** She did not greet guests at the front desk.` };
  });
}

export const NOV16_AGENT_LOOP_TYPED_NAME_TITLE_CASE_CASES: ReplayCase[] = [
  {
    id: "nov16-typed-name-title-case-lowercase-off-roster",
    title: "QA (train 5): \"coaching for lena vossberg on greeting guests\" (not on the staff list, typed lowercase): the card says Lena Vossberg, the reply \"for **Lena**\", and the pronoun pass writes \"Lena did not greet guests\", never \"lena\"",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      t.loopModel!(coachingFor("lena vossberg", "lena vossberg"));
      const reply = await t.thread().say("coaching for lena vossberg on greeting guests");
      const card = reply.formProposal as ChatFormProposal | undefined;
      expect(card?.employeeName, reply.content).toBe("Lena Vossberg");
      expect(reply.content).toContain("Here's the Coaching Form for **Lena**.");
      expect(reply.content).toContain("Lena did not greet guests");
      expect(reply.content, "the lowercase typed name is shown").not.toMatch(/\blena\b/);
    },
  },
  {
    id: "nov16-typed-name-title-case-controls",
    title: "Controls: a name typed with capitals (\"coaching for DeShawn mcKay on greeting guests\") is kept exactly as typed; a roster person typed lowercase (\"coaching for remy calder …\") keeps the roster's spelling",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      t.loopModel!(coachingFor("DeShawn mcKay", "DeShawn mcKay"));
      const mixed = await t.thread().say("coaching for DeShawn mcKay on greeting guests");
      expect((mixed.formProposal as ChatFormProposal | undefined)?.employeeName, mixed.content).toBe("DeShawn mcKay");
      t.loopModel!(coachingFor("remy calder", "remy calder"));
      const roster = await t.thread().say("coaching for remy calder on greeting guests");
      expect((roster.formProposal as ChatFormProposal | undefined)?.employeeName, roster.content).toBe("Remy Calder");
    },
  },
];
