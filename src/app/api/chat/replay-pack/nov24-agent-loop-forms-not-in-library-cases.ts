import { expect, vi } from "vitest";

import { STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A FORM THE LIBRARY DOES NOT HAVE: THE REPLY NAMES THE FORMS IT HAS (QA, live, 24 Nov 2026)
 * ============================================================================
 *
 * QA, Standard mode (the agent loop), admin with global scope: "Draft a vacation request form" was answered honestly
 * ("There's no \"Vacation Request Form\" in the forms library — PTO requests … run through … directly, not a form Ask
 * Sunny creates. Here's how that actually works: …") but never named the forms that exist. #1282's list came only from
 * propose_form with a quote holding the word "form". Now the manager's own words are read (`form-not-in-library.ts`):
 * with no card this turn, the reply ends with "The forms you can create are …", with or without the word "form", with or
 * without a tool call. Controls: a library form asked for, and a letter the model writes, get no list.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA, live on the agent loop (24 Nov 2026): \"Draft a vacation request form\" said there's no such form but never listed the forms that exist";
const LIST = /The forms you can create are [^\n]*Coaching Form[^\n]*\./;

type Out = { reason_code?: string; ask_exactly?: string } | null;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-24T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("admin", { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] });
}

const loopCase = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id, title, report: REPORT, status: "fixed", fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
    await run(t);
  },
});

const textOnly = (text: string) => loopStandIn((): LoopDecision => ({ text }));

export const NOV24_AGENT_LOOP_FORMS_NOT_IN_LIBRARY_CASES: ReplayCase[] = [
  loopCase("nov24-loop-not-in-library-text-reply", "\"Draft a vacation request form\", answered in text with no tool call: the reply names the forms you can create", async (t) => {
    start(t);
    t.loopModel!(textOnly("There's no \"Vacation Request Form\" in the forms library — PTO requests run through the staff app directly, not a form I create."));
    const reply = await t.thread().say("Draft a vacation request form");
    expect(reply.content, reply.content).toMatch(LIST);
    expect(reply.content.match(/There's no/g)?.length, `the "no such form" line is said twice:\n${reply.content}`).toBe(1);
    expect(reply.formProposal ?? null).toBeNull();
  }),
  loopCase("nov24-loop-not-in-library-no-form-word", "\"draft a PTO request\" (no word \"form\"), answered in text: the reply says there's no such form and names the forms", async (t) => {
    start(t);
    t.loopModel!(textOnly("PTO requests go through the staff app."));
    const reply = await t.thread().say("draft a PTO request");
    expect(reply.content, reply.content).toMatch(/There's no PTO request form in the forms library\./);
    expect(reply.content, reply.content).toMatch(LIST);
  }),
  loopCase("nov24-loop-not-in-library-tool-no-form-word", "\"Draft a vacation request\", the model calling propose_form for the Coaching Form with form_asked_evidence \"vacation request\": no card, the forms are named", async (t) => {
    start(t);
    t.loopModel!(loopStandIn((view: LoopView): LoopDecision => {
      const result = lastResult(view, "propose_form") as Out;
      if (result) return { text: result.ask_exactly ?? "Who is this Coaching Form for?" };
      return { tool: "propose_form", input: { template_key: "coaching", form_asked_evidence: evidenceFrom(view, "vacation request") } };
    }));
    const reply = await t.thread().say("Draft a vacation request");
    expect(reply.formProposal ?? null).toBeNull();
    expect(reply.content, reply.content).not.toMatch(/who is this/i);
    expect(reply.content, reply.content).toMatch(/There's no vacation request form in the forms library\./);
    expect(reply.content, reply.content).toMatch(LIST);
  }),
  loopCase("nov24-loop-not-in-library-control-library-form", "Control: \"Create a coaching form.\" asks who it is for, with no list of forms", async (t) => {
    start(t);
    t.loopModel!(loopStandIn((view: LoopView): LoopDecision => {
      const result = lastResult(view, "propose_form") as Out;
      if (result) return { text: result.ask_exactly ?? "Here's the card." };
      return { tool: "propose_form", input: { template_key: "coaching" } };
    }));
    const reply = await t.thread().say("Create a coaching form.");
    expect(reply.content, reply.content).toMatch(/who is this Coaching Form for\?/i);
    expect(reply.content, reply.content).not.toMatch(/The forms you can create are/);
  }),
  loopCase("nov24-loop-not-in-library-control-letter", "Control: \"write a thank you letter for my team\", answered with the letter: no list of forms", async (t) => {
    start(t);
    t.loopModel!(textOnly("Team, thank you for a great month. Your care for every guest shows."));
    const reply = await t.thread().say("write a thank you letter for my team");
    expect(reply.content, reply.content).not.toMatch(/The forms you can create are/);
  }),
];
