import { expect, vi } from "vitest";

import { STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * "TEST EMPLOYEE" STAYS "TEST EMPLOYEE" ON EVERY CARD (QA, 24 Nov 2026, live as an Admin; TYPED_EMPLOYEE_EVERY_CARD)
 * ============================================================================
 *
 * QA's turns, word for word (an Admin, a global login; "Test Employee" is QA's own stand-in, nobody on the directory):
 *   "Draft a coaching form for a performance concern for a made-up employee named Test Employee" → "**Observation of
 *   Offense:** a performance concern for a made-up employee named the employee Employee … Who is this form for?"; the
 *   answer "Test Employee" was asked again.
 *   "Draft a corrective action form for a till shortage for Test Employee" → "Here's the Corrective Action Form for
 *   **Test**. … **Observation of Offense:** Test had a till shortage."
 * The owner: managers use "Test Employee" on purpose; it is a valid name, kept whole in the header, the Observation and
 * the employee field on every form type, accepted as the answer to "Who is this form for?", with the honest "not on the
 * staff list, used as typed" note, never "the employee" or "Test".
 */
const FLAG = "TYPED_EMPLOYEE_EVERY_CARD_ENABLED";
const REPORT = `QA, 24 Nov 2026 (live, Admin): "… a made-up employee named Test Employee" became "named the employee Employee"; "for Test Employee" became "**Test**"`;
/* Fixed in production: the owner turned TYPED_EMPLOYEE_EVERY_CARD_ENABLED on in Vercel (25 Nov 2026). */
const OPEN = "fixed" as const;
const ADMIN = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const COACHING = "Draft a coaching form for a performance concern for a made-up employee named Test Employee";
const CA = "Draft a corrective action form for a till shortage for Test Employee";
const NAME = "Test Employee";

function start(t: ReplayContext): void {
  vi.setSystemTime(new Date("2026-11-24T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("admin", ADMIN);
}

/** The reply never cuts the name to its first word, nor makes it "the employee". */
function keepsWholeName(content: string): void {
  expect(content, "the name became \"the employee\"").not.toMatch(/the employee Employee|named the employee/i);
  expect(content, "the name was cut to its first word").not.toMatch(/\bTest\b(?!\s+Employee)/);
  expect(content, "the card asked who the form is for").not.toMatch(/Who is this form for\?/);
}

/** The live model on the loop: the employee_name it passes (none, "Employee", "Test", the full name). */
const model = (template: string, passed: string | null, account: string) =>
  loopStandIn((view: LoopView): LoopDecision => {
    const card = lastResult(view, "propose_form") as { card?: { employee_name?: string } | null; facts?: { reply_name?: string } } | null;
    if (card?.card) return { text: `Here's the form for **${card.facts?.reply_name ?? card.card.employee_name ?? "?"}**.` };
    if (card) return { text: String((card as { ask_exactly?: string }).ask_exactly ?? "Who is this form for?") };
    return {
      tool: "propose_form",
      input: { template_key: template, ...(passed === null ? {} : { employee_name: passed, person_evidence: { message_id: view.turns.filter((turn) => turn.role === "user").at(-1)?.messageIds?.at(-1) ?? "current", quote: NAME } }), what_happened: account },
    };
  });

const loopCase = (id: string, title: string, template: string, said: string, passed: string | null, account: string): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: OPEN,
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
    start(t);
    const standIn = model(template, passed, account);
    t.loopModel!(standIn);
    const thread = t.thread();
    const reply = await thread.say(said);
    expect(thread.proposal?.employeeName, `the card's name (the model passed ${JSON.stringify(passed)})`).toBe(NAME);
    const result = [...standIn.views].reverse().map((view) => lastResult(view, "propose_form")).find(Boolean) as { card?: { what_happened?: string }; facts?: { reply_name?: string } } | null;
    expect(result?.facts?.reply_name ?? NAME, "the reply calls the person by the first word").toBe(NAME);
    expect((thread.proposal as { issue?: string } | null)?.issue ?? "", "the card's account cut the name").not.toMatch(/\bTest\b(?!\s+Employee)/);
    expect(reply.content).not.toMatch(/\*\*Test\*\*/);
  },
});

export const NOV24_TYPED_EMPLOYEE_EVERY_CARD_CASES: ReplayCase[] = [
  {
    id: "nov24-typed-employee-coaching-named-test-employee",
    title: `"${COACHING}" (an Admin): the Coaching card is for "Test Employee", the Observation keeps the name, with the not-in-Woven line, never "named the employee Employee" or "Who is this form for?"`,
    report: REPORT,
    status: OPEN,
    fixFlags: [FLAG],
    async run(t) {
      start(t);
      const thread = t.thread();
      const reply = await thread.say(COACHING);
      expect(thread.proposal?.employeeName, reply.content).toBe(NAME);
      keepsWholeName(reply.content);
      expect(reply.content, "the Observation lost the name").toMatch(/named Test Employee/);
      expect(reply.content, "no honest not-in-Woven line").toMatch(/\*\*Test Employee\*\* isn['’]t in the Woven roster/);
    },
  },
  {
    id: "nov24-typed-employee-coaching-answer-test-employee",
    title: `"${COACHING}", then the answer "Test Employee": the card is for "Test Employee" and the Observation still says "named Test Employee"`,
    report: REPORT,
    status: OPEN,
    fixFlags: [FLAG],
    async run(t) {
      start(t);
      const thread = t.thread();
      await thread.say(COACHING);
      const reply = await thread.say(NAME);
      expect(thread.proposal?.employeeName, reply.content).toBe(NAME);
      keepsWholeName(reply.content);
      expect(reply.content, "the Observation lost the name").toMatch(/named Test Employee/);
    },
  },
  {
    id: "nov24-typed-employee-ca-till-shortage",
    title: `"${CA}" (an Admin): the Corrective Action card is for "Test Employee" in the header, the Observation and the Action Plan, never "Test"`,
    report: REPORT,
    status: OPEN,
    fixFlags: [FLAG],
    async run(t) {
      start(t);
      const thread = t.thread();
      const reply = await thread.say(CA);
      expect(thread.proposal?.employeeName, reply.content).toBe(NAME);
      keepsWholeName(reply.content);
      expect(reply.content, "no honest not-in-Woven line").toMatch(/Test Employee\*\* isn['’]t (?:in|on) the Woven/);
    },
  },
  loopCase("nov24-typed-employee-loop-coaching-model-passed-employee", `the loop, "${COACHING}": the model passed employee_name "Employee" — the card is for "Test Employee"`, "coaching", COACHING, "Employee", "A performance concern."),
  loopCase("nov24-typed-employee-loop-coaching-model-passed-none", `the loop, "${COACHING}": the model passed no employee — the card is for "Test Employee", never "Who is this form for?"`, "coaching", COACHING, null, "A performance concern."),
  loopCase("nov24-typed-employee-loop-ca-model-passed-test", `the loop, "${CA}": the model passed "Test" — the card is for "Test Employee"`, "dpoa", CA, "Test", "Test Employee had a till shortage."),
  loopCase("nov24-typed-employee-loop-ca-full-name", `the loop, "${CA}": the model passed "Test Employee" — the reply and the card's account call the person "Test Employee", never "**Test**" or "Test had a till shortage."`, "dpoa", CA, NAME, "Test Employee had a till shortage."),
];
