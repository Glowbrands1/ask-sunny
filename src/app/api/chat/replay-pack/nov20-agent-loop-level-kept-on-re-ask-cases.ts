import { expect, vi } from "vitest";

import type { ChatFormProposal } from "@/types";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE LEVEL STAYS WHEN THE MANAGER ASKS AGAIN FOR THE SAME CA (Runner 2's c263, 17 Nov saved-form run on 33863575; QA, 20 Nov 2026)
 * ============================================================================
 *
 * c263: T1 "Please create a CA written warning for <A> for being out of dresscode on 11/13 …" set Written, with evidence.
 * T2 "Write me a CA form for <A> having a black crewneck on during her shift, not a zip up jacket on 11/13 and 11/6" asked
 * for the same CA again with more detail; the model passed no level (several_dates_not_chosen), the card's level went back
 * to unset and never returned, and the saved form had no warning box ticked. Invented names only (Remy Calder).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Runner 2's c263 (17 Nov saved-form run on 33863575; QA, 20 Nov 2026): Written set at T1 was dropped when T2 asked again for the same CA with more detail";
const T1 = "Please create a CA written warning for Remy Calder for being out of dresscode on 11/13. Remy wore her coat during Marnies shift after previosly being asked to take it off multiple times.";
const T2 = "Write me a CA form for Remy Calder having a black crewneck on during her shift, not a zip up jacket on 11/13 and 11/6";

/** The manual's dress-code sections as the production manual prints them (page 15), as the pack's dress-code cases add them; the wording invented. */
const DRESS_CODE_CHUNK = {
  chunkIndex: 60,
  chunkId: "jba-60",
  locator: "Page 15 — Dress Code for The Company",
  page: 16,
  content: "Dress Code for The Company\nEmployees keep a neat, professional appearance.\n\nAll Locations Dress Code:\nName tags are worn at all times while working.",
  section: "Dress Code for The Company",
  printedPage: 15,
  sections: [
    { heading: "Dress Code for The Company", page: 15 },
    { heading: "All Locations Dress Code", page: 15 },
  ],
};

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-20T10:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  t.manualAlsoHas?.([DRESS_CODE_CHUNK]);
}

const managerTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);
const quoted = (view: LoopView, quote: string) => ({ message_id: [...managerTurns(view)].reverse().find((turn) => turn.text.includes(quote))?.messageIds?.at(-1) ?? "current", quote });
const card = (reply: { formProposal?: unknown }) => (reply.formProposal as ChatFormProposal | undefined) ?? null;

/** c263 as the trace shows it: T1 with the level and its evidence; T2 (the model's new request) with more detail, no level fields, no date chosen. */
function c263Model(t2: string = T2, t2Account = "Had a black crewneck on during her shift, not a zip up jacket, on 11/13 and 11/6.", t2Ask = "Write me a CA form for Remy Calder") {
  return loopStandIn((view): LoopDecision => {
    const result = [...view.results].reverse().find((entry) => entry.tool === "propose_form")?.output;
    if (result) return { text: result.reason_code ? `REFUSED ${String(result.reason_code)} ${String(result.error ?? "")}`.slice(0, 300) : "Here's the Corrective Action Form for **Remy Calder**." };
    if (managerTurns(view).length === 1) return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Remy Calder", person_evidence: quoted(view, "Remy Calder"), what_happened: "Was out of dress code on 11/13: wore her coat during the shift after previously being asked to take it off multiple times.", incident_date: "2026-11-13", policy: "All Locations Dress Code", warning_level: "written", level_evidence: quoted(view, "Please create a CA written warning for Remy Calder") } };
    return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Remy Calder", person_evidence: quoted(view, t2Ask), new_form_evidence: quoted(view, t2Ask), what_happened: t2Account, policy: "All Locations Dress Code" } };
  });
}

export const NOV20_AGENT_LOOP_LEVEL_KEPT_ON_RE_ASK_CASES: ReplayCase[] = [
  {
    id: "nov20-level-kept-when-the-same-ca-is-asked-again-c263",
    title: `c263: "${T1.slice(0, 60)}…" (Written), then "${T2}" (the same CA asked again with more detail, no level from the model): the card keeps Written`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      t.loopModel!(c263Model());
      const thread = t.thread();
      const first = await thread.say(T1);
      expect(card(first)?.warningLevel, `T1 did not set Written (the case proves nothing): ${first.content}`).toBe("written");
      const second = await thread.say(T2);
      expect(card(second)?.employeeName).toBe("Remy Calder");
      expect(card(second)?.warningLevel ?? null, "the level the manager stated for this CA was dropped when they asked for it again").toBe("written");
    },
  },
  {
    id: "nov20-level-not-carried-to-another-incident",
    title: "Control: the Written card for the 11/13 dress code, then \"another CA for Remy Calder, she was out of dresscode again on 11/19\" (a new request about another date, no level said): the new card starts with no level",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const other = "another CA for Remy Calder, she was out of dresscode again on 11/19";
      t.loopModel!(c263Model(other, "Was out of dress code again on 11/19.", "another CA for Remy Calder"));
      const thread = t.thread();
      const first = await thread.say(T1);
      expect(card(first)?.warningLevel).toBe("written");
      const second = await thread.say(other);
      expect(card(second)?.employeeName).toBe("Remy Calder");
      expect(card(second)?.warningLevel ?? null, "another incident's card took the earlier card's level").toBeNull();
    },
  },
  {
    id: "nov20-written-up-is-not-the-level",
    title: "QA's code audit: \"she got written up again for no-call, I need a CA for Remy Calder\" (the model passes Written, quoting \"she got written up again\"): the card has no level; \"written up\" is discipline already given",
    report: "QA's code audit on d7960a5f (20 Nov 2026): levelOptionIsTheLevel accepted \"written up\" because \"up\" is a short word",
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (view.results.some((entry) => entry.tool === "propose_form")) return { text: "Here's the Corrective Action Form for **Remy Calder**." };
        return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Remy Calder", person_evidence: quoted(view, "Remy Calder"), what_happened: "No-call for her shift.", policy: "Attendance", warning_level: "written", level_evidence: quoted(view, "she got written up again") } };
      }));
      const reply = await t.thread().say("she got written up again for no-call, I need a CA for Remy Calder");
      expect(card(reply)?.employeeName).toBe("Remy Calder");
      expect(card(reply)?.warningLevel ?? null, "\"written up\" (discipline already given) was taken as this form's level").toBeNull();
    },
  },
];
