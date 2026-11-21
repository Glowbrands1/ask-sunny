import { expect, vi } from "vitest";

import { TESTY } from "@/lib/ai/agent-loop/phrasing-table";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE PERSON TOLD IS NAMED ACROSS TWO TURNS (QA's live retest of #1147, 20 Nov 2026; f059)
 * ============================================================================
 *
 * Production dpl_G64G5js2 (main d1c3b1a1, with #1147), conv_mwp5inao2y4s849, masked:
 *  T1 "Test Testy's shift lead, <L>, told her to clock out early and she refused" → "This sounds like an account of an
 *     incident, not a request yet — Test Testy's shift lead, <L>, told her to clock out early and she refused. …"
 *  T2 "a corrective action" → "…Observation of Offense: Test's shift lead, <L>, told her to clock out early and she
 *     refused."; the card's issue "Her shift lead, <L>, told her to clock out early and she refused."
 * #1147's case said everything in one turn, so <L> was a name in this message. Live, <L> was named in T1 and is not on
 * the roster: on T2 no other name was known, and the guard read "Test's shift lead" as Test telling. General rule: the
 * teller is the subject before the verb, known or not, and a possessive never tells; the card's own account is named
 * the same way (QA's second live sample, conv_mwp6vj6m2fmzxg9: the card's issue "She was late on 11/19.").
 * <L> is invented (Dana Fairweather, nobody on the roster). Test Testy is the app's test employee.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's live retest of #1147 (20 Nov 2026, conv_mwp5inao2y4s849): T2's Observation and the card kept \"told her … she refused\"";
const offline = process.env.AGENT_LOOP_LIVE !== "1";
const T1 = "Test Testy's shift lead, Dana Fairweather, told her to clock out early and she refused";
const T2 = "a corrective action";
const TEST_TESTY: DirectoryRow = { id: TESTY.id, firstName: TESTY.firstName, lastName: TESTY.lastName, preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const users = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").length;

/** The live model's two turns: T1 a restatement and one question, T2 the card with the live account. */
const live = () =>
  loopStandIn((view): LoopDecision => {
    if (users(view) === 1) return { text: "This is an account of Test refusing to clock out early. Do you want a Corrective Action or a Coaching Form for Test?" };
    if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: TESTY.id, what_happened: "Her shift lead, Dana Fairweather, told her to clock out early and she refused.", incident_date: "2026-11-20" } };
    return { text: "Here's the Corrective Action Form for **Test**.\n\n**Observation of Offense:** Test's shift lead, Dana Fairweather, told her to clock out early and she refused." };
  });

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || !offline) return;
    vi.setSystemTime(new Date("2026-11-20T15:00:00Z"));
    t.directory([...STAFF, TEST_TESTY]);
    t.as("salon_director", KEARNEY);
    await run(t);
  },
});

export const NOV20_AGENT_LOOP_PERSON_TOLD_TWO_TURNS_CASES: ReplayCase[] = [
  fixed("nov20-person-told-two-turns-reply", "T1 \"Test Testy's shift lead, Dana Fairweather, told her to clock out early and she refused\", T2 \"a corrective action\": the reply's Observation line names Test (\"told Test to clock out early and Test refused\")", async (t) => {
    t.loopModel!(live());
    const thread = t.thread();
    await thread.say(T1);
    const reply = await thread.say(T2);
    expect(reply.content, `the reply kept a pronoun for the card's person:\n${reply.content}`).toContain("told Test to clock out early and Test refused");
    expect(reply.content).not.toMatch(/\btold her\b|\bshe refused\b/);
  }),
  fixed("nov20-person-told-two-turns-card", "The same two turns: the card's own account names Test (\"The shift lead, Dana Fairweather, told Test to clock out early and Test refused.\"), never her/she", async (t) => {
    t.loopModel!(live());
    const thread = t.thread();
    await thread.say(T1);
    await thread.say(T2);
    const issue = thread.proposal?.issue ?? "";
    // Changed on purpose (QA2, 21 Nov 2026, live R3, #1168's case): the opening "Her" is the plain "The" when the told listener is named later in the sentence.
    expect(issue, `the card's account kept a pronoun:\n${issue}`).toBe("The shift lead, Dana Fairweather, told Test to clock out early and Test refused.");
  }),
  fixed("nov20-person-told-two-turns-t1-rule", "T1 (a story with no ask): the rules book says the one line is in Sunny's own words with the person's first name, never the manager's text typed back or a pronoun", async (t) => {
    const model = live();
    t.loopModel!(model);
    await t.thread().say(T1);
    expect(model.views[0]!.system).toMatch(/never the manager's text typed back and never a pronoun for the person/);
  }),
  fixed("nov20-card-issue-names-person-late", "QA's live sample (conv_mwp6vj6m2fmzxg9) \"my manager wants a CA for Test Testy, late on 11/19\": the card's own account reads \"Test was late on 11/19.\", never \"She was late on 11/19.\"", async (t) => {
    const model = loopStandIn((view): LoopDecision =>
      lastResult(view, "propose_form")
        ? { text: "Here's the Corrective Action Form for **Test**.\n\n**Observation of Offense:** Test was late on 11/19." }
        : { tool: "propose_form", input: { template_key: "dpoa", employee_id: TESTY.id, what_happened: "She was late on 11/19.", incident_date: "2026-11-19" } },
    );
    t.loopModel!(model);
    const thread = t.thread();
    await thread.say("my manager wants a CA for Test Testy, late on 11/19");
    expect(thread.proposal?.issue ?? "", "the card's account kept a pronoun").toBe("Test was late on 11/19.");
  }),
];
