import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * FIND_STAFF LOOKS "TEST EMPLOYEE" UP WHOLE (the owner's scope list from QA's Ask Vicki comparison, 26 Nov 2026, item A)
 * ============================================================================
 *
 * The owner's words: "Asked for a coaching form for "Test Employee", Sunny named the employee "Employee", then named
 * them correctly on retry, and the card showed Employee "Not yet". The corrective action prompt handles the same name
 * correctly, so find what differs in the coaching path."
 *
 * #1323 (TYPED_EMPLOYEE_EVERY_CARD, on in production) keeps the typed name on propose_form. A model that looks the
 * person up first still called find_staff with "Test Employee": the lookup cut the last word as a job title, looked up
 * "Test", and answered "it does not read as a person's name … ask who the form is for". The coaching reply then asked
 * who the form was for (a coaching card is made only once a person is settled), where a Corrective Action request
 * that went straight to propose_form did not. "Test Employee" is QA's own stand-in, nobody on the directory.
 */
const FLAG = "TYPED_EMPLOYEE_EVERY_CARD_ENABLED";
const REPORT = `The owner, 26 Nov 2026 (QA's Ask Vicki comparison, item A): a coaching form for "Test Employee" named the employee "Employee"; the card showed Employee "Not yet"`;
const NAME = "Test Employee";
const ADMIN = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

/** A model that looks the person up first, as a live model does, then proposes the card for whoever find_staff gave. */
const lookUpFirst = (template: string) =>
  loopStandIn((view: LoopView): LoopDecision => {
    const staff = lastResult(view, "find_staff") as { not_on_roster?: string; note?: string } | null;
    if (!staff) return { tool: "find_staff", input: { name: NAME } };
    const card = lastResult(view, "propose_form") as { card?: { employee?: string } | null } | null;
    if (card) return { text: `Here's the form for **${card.card?.employee ?? "?"}**.` };
    // find_staff's note says it is no person: a live model asks, as QA saw.
    if (!staff.not_on_roster) return { text: "Who is this form for?" };
    return { tool: "propose_form", input: { template_key: template, employee_name: staff.not_on_roster } };
  });

const SAID: ReadonlyArray<readonly [string, string, string, unknown]> = [
  ["coaching-owner", "coaching", "can you create a coaching form for Test Employee", KEARNEY],
  ["coaching-qa", "coaching", "Draft a coaching form for a performance concern for a made-up employee named Test Employee", ADMIN],
  ["ca-owner", "dpoa", "can you create a corrective action form for Test Employee", KEARNEY],
];

function start(t: ReplayContext, scope: unknown): void {
  vi.setSystemTime(new Date("2026-11-26T18:00:00Z"));
  t.directory([...STAFF]);
  t.as(scope === ADMIN ? "admin" : "salon_director", scope);
}

export const NOV26_FIND_STAFF_TYPED_EMPLOYEE_CASES: ReplayCase[] = SAID.map(([id, template, said, scope]) => ({
  id: `nov26-find-staff-typed-employee-${id}`,
  title: `"${said}": find_staff looks up "Test Employee" whole and the card is for Test Employee, never "Who is this form for?"`,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t: ReplayContext) {
    if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
    start(t, scope);
    const standIn = lookUpFirst(template);
    t.loopModel!(standIn);
    const thread = t.thread();
    const reply = await thread.say(said);
    const staff = standIn.views.map((view) => lastResult(view, "find_staff")).find(Boolean) as { not_on_roster?: string; note?: string } | null;
    expect(staff?.note ?? "", `find_staff called the typed name no person:\n${JSON.stringify(staff)}`).not.toMatch(/does not read as a person/);
    expect(staff?.not_on_roster, `find_staff looked up part of the name:\n${JSON.stringify(staff)}`).toBe(NAME);
    expect(reply.content, `asked who the form is for:\n${reply.content}`).not.toMatch(/Who is this form for\?/);
    expect(thread.proposal?.employeeName, `the card's employee:\n${reply.content}`).toBe(NAME);
  },
}));
