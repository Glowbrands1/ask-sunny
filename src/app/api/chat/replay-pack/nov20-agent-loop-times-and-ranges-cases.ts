import { expect, vi } from "vitest";

import type { ChatFormProposal } from "@/types";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * TIMES REACH THE SAVED ACCOUNT; A MINUTES RANGE IS NEVER A DATE (QA, 20 Nov 2026)
 * ============================================================================
 *
 * c198 (Runner 2's 17 Nov saved-form run on 33863575): the loop card's account held 9:15PM, 9:01 and 8:11 PM; the draft
 * writer saved only 8:11 PM. Times the manager typed must reach the account and the write-up: Create sends the card's
 * account, and a time the drafted account lost brings back the card's sentence that holds it. QA's code audit on d7960a5f:
 * "10-15 minutes late" was read as the date 10/15, so an account with another date counted two dates and asked which.
 * Invented names only (Remy Calder).
 */

const FLAG = "AGENT_LOOP_ENABLED";

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
  vi.setSystemTime(new Date("2026-11-20T11:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const managerTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);
const quoted = (view: LoopView, quote: string) => ({ message_id: managerTurns(view).at(-1)?.messageIds?.at(-1) ?? "current", quote });
const card = (reply: { formProposal?: unknown }) => (reply.formProposal as ChatFormProposal | undefined) ?? null;

const C198 = "Write a CA for Remy Calder she is TC works at NE Kearney and on 11/3/26 she was scheduled until 9:15PM and clocked out at 9:01. She also took down the spray booths down at 8:11 PM before the Salon was closed.";
const C198_ACCOUNT = "On 11/3/26 she was scheduled until 9:15PM and clocked out at 9:01. She also took down the spray booths down at 8:11 PM before the Salon was closed.";

export const NOV20_AGENT_LOOP_TIMES_AND_RANGES_CASES: ReplayCase[] = [
  {
    id: "nov20-card-times-reach-the-saved-account-c198",
    title: `c198: "${C198.slice(0, 70)}…" (the card holds 9:15PM, 9:01 and 8:11 PM; the draft writer keeps only 8:11 PM): the saved observation holds all three times`,
    report: "Runner 2's c198 (17 Nov saved-form run on 33863575; QA, 20 Nov 2026): the saved observation kept only 8:11 PM; 9:15PM and 9:01 were dropped by the draft writer",
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (view.results.some((entry) => entry.tool === "propose_form")) return { text: "Here's the Corrective Action Form for **Remy Calder**." };
        return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Remy Calder", person_evidence: quoted(view, "Remy Calder"), what_happened: C198_ACCOUNT, incident_date: "2026-11-03", policy: "Attendance" } };
      }));
      t.draftWrites({ observation: "Observed:\nThe employee took down the spray booths at 8:11 p.m., before the salon closed." });
      const thread = t.thread();
      const reply = await thread.say(C198);
      expect(card(reply)?.issue ?? "", "the card does not hold the times (the case proves nothing)").toContain("9:15PM");
      const id = await thread.create();
      const saved = t.values(id).observation ?? "";
      for (const time of ["9:15", "9:01", "8:11"]) expect(saved, `the saved observation lost ${time}: ${saved}`).toContain(time);
    },
  },
  {
    id: "nov20-minutes-range-is-not-a-date",
    title: "QA's code audit: \"ca for Remy Calder she was 10-15 minutes late to her shift on 11/18\" has one incident date, 11/18: the card is dated 11/18 and never asks which date",
    report: "QA's code audit on d7960a5f (20 Nov 2026): \"10-15 minutes late\" was read as the date 10/15 (dates.ts pattern 1)",
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const results: Record<string, unknown>[] = [];
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const done = view.results.find((entry) => entry.tool === "propose_form")?.output;
        if (done) {
          results.push(done);
          return { text: typeof done.ask_exactly === "string" ? done.ask_exactly : "Here's the Corrective Action Form for **Remy Calder**." };
        }
        return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Remy Calder", person_evidence: quoted(view, "Remy Calder"), what_happened: "Was 10-15 minutes late to her shift on 11/18.", policy: "Attendance" } };
      }));
      const reply = await t.thread().say("ca for Remy Calder she was 10-15 minutes late to her shift on 11/18");
      const facts = (results.at(-1)?.facts ?? {}) as { dates_given?: unknown };
      expect(facts.dates_given ?? null, `a minutes range was read as a date: ${JSON.stringify(results.at(-1))}`).not.toEqual(expect.arrayContaining(["10/15"]));
      expect(card(reply)?.formDate, reply.content).toBe("2026-11-18");
      expect(reply.content).not.toMatch(/which (?:date|day)/i);
    },
  },
  ...([["model-date", "2026-11-03"], ["fallback", null]] as const).map(([key, modelDate]): ReplayCase => ({
    id: `nov20-prior-action-date-is-not-the-form-date-${key}`,
    title: `QA's production audit: "I need a verbal CA wrote up for Remy Calder. I need the JBA policy for dress code enclosed. can you also site the coaching that was done on 11/3" (${modelDate ? "the model sends 11/3 as the incident date" : "the model sends no incident date"}), then "Remy was out of dress code today when she came into work. Please word that appropriatly": 11/3 stays on the prior coaching and is never the form date; T2 dates the card today`,
    report: "QA's production audit (20 Nov 2026): the prior coaching's date (11/3) became the card's form date",
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      t.manualAlsoHas?.([DRESS_CODE_CHUNK]);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (view.results.some((entry) => entry.tool === "propose_form")) return { text: "Here's the Corrective Action Form for **Remy Calder**." };
        const base = { template_key: "dpoa", employee_name: "Remy Calder", person_evidence: { ...quoted(view, "Remy Calder"), message_id: managerTurns(view)[0]?.messageIds?.at(-1) ?? "current" }, policy: "All Locations Dress Code", warning_level: "verbal", level_evidence: { message_id: managerTurns(view)[0]?.messageIds?.at(-1) ?? "current", quote: "I need a verbal CA" }, prior_actions: "Coaching — 11/3/2026" };
        if (managerTurns(view).length === 1) return { tool: "propose_form", input: { ...base, ...(modelDate ? { incident_date: modelDate } : {}) } };
        return { tool: "propose_form", input: { ...base, what_happened: "Was out of dress code when she came into work today.", incident_date: "2026-11-20" } };
      }));
      const thread = t.thread();
      const first = await thread.say("I need a verbal CA wrote up for Remy Calder. I need the JBA policy for dress code enclosed. can you also site the coaching that was done on 11/3");
      expect(card(first)?.employeeName, first.content).toBe("Remy Calder");
      expect(card(first)?.formDate ?? null, "the prior coaching's date became the form date").not.toBe("2026-11-03");
      const second = await thread.say("Remy was out of dress code today when she came into work. Please word that appropriatly");
      expect(card(second)?.formDate, second.content).toBe("2026-11-20");
      expect(card(second)?.priorActions ?? "").toMatch(/11\/3/);
    },
  })),
];
