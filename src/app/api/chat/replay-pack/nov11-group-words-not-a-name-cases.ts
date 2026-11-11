import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * "MULTIPLE EMPLOYEES" IS NEVER A PERSON'S NAME (Problem 19, this app's production, 10 Nov 2026)
 * ============================================================================
 *
 * "create a coaching form about accountability" → "Who is this form for?" → "I want the same form for multiple
 * employees" → the card read "I have **multiple employees**. What is **multiple
 * employees**'s position (job title)?" and "Everything I need is here". The manager's words; the person they named
 * afterwards is not needed here. GROUP_WORDS_NOT_A_NAME_ENABLED.
 */
const FLAG = "GROUP_WORDS_NOT_A_NAME_ENABLED";
const REPORT = "Problem 19, the sibling app's production (10 Nov 2026), checked here, via QA";
const T1 = "create a coaching form about accountability";
const T3 = "I want the same form for multiple employees";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-10T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV11_GROUP_WORDS_NOT_A_NAME_CASES: ReplayCase[] = ([
  ["as-typed", T3],
  ["lower", T3.toLowerCase()],
] as const).map(([casing, said]) => ({
  id: `nov11-p19-group-words-not-a-name-${casing}`,
  title: `"${T1}", then "${said}": "multiple employees" is never the employee, and the bot asks who they are`,
  report: `${REPORT}; ${casing}`,
  status: { open: "\"multiple employees\" is read as the employee's name and the card says everything it needs is here" },
  fixFlags: [FLAG],
  async run(t: ReplayContext) {
    const thread = start(t);
    await thread.say(T1);
    const reply = await thread.say(said);
    const card = reply.formProposal ?? (thread.proposal as { employeeName?: string | null; templateKey?: string } | null);
    expect(card?.employeeName ?? "", `the employee is "multiple employees":\n${reply.content}`).not.toMatch(/multiple employees/i);
    expect(reply.content, `"multiple employees" read as a person:\n${reply.content}`).not.toMatch(/\*\*multiple employees\*\*/i);
    expect(reply.content, `says everything it needs is here:\n${reply.content}`).not.toMatch(/Everything I need is here/i);
    expect(reply.content, `does not ask which employees:\n${reply.content}`).toMatch(/Which employees\? Tell me their full names/);
    expect(reply.content, `the coaching topic is dropped:\n${reply.content}`).toMatch(/Coaching Form\*\* about accountability/i);
    expect(card?.templateKey ?? "", `the form is not kept:\n${reply.content}`).toMatch(/coaching/i);
  },
}));
