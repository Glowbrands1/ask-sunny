import { expect, vi } from "vitest";

import { KEARNEY, type ReplayCase, type ReplayContext } from "./cases";
import { correctiveActionOffers, MANAGER_MESSAGES, MANAGER_ROSTER, managerCriteria, policyLine, type LiveOutcome, type ManagerMessage } from "./nov4-live-regressions-scenarios";

/**
 * ============================================================================
 * PAU, VIA QA (4 Nov 2026, 11:30 UTC): FIVE EXACT MANAGER MESSAGES ABOUT MSB
 * AND SALES CORRECTIVE ACTIONS
 * ============================================================================
 *
 * Ported from Ask Bubbles (the mechanism; the same five messages, which QA
 * sent for both apps). The managers' own words, kept word for word (metric names and "salon
 * metrics" included: quoted manager text), each name swapped for an invented
 * one on this case's roster only. The messages, the people and the four
 * criteria live in `nov4-live-regressions-scenarios.ts`, shared with the live
 * script (LIVE_SCENARIOS=managers):
 *
 *   card       a card is made for the person (#2: it asks ONCE which employee);
 *   no-ask     it never asks what happened when the metrics or reason are given;
 *   msb-name   MSB is never saved or shown as a name;
 *   cites-soc  the card or the draft cites the Standards of Conduct with the
 *              manual heading and page (a card message is created).
 *
 * `status` is per production's flags today; `fixFlags` where the glossary
 * (CHAT_GLOSSARY_ENABLED) and/or the sales policy (CA_SALES_POLICY_ENABLED)
 * make it hold.
 */

type T = ReplayContext;

const REPORT = "Pau via QA, 4 Nov 2026 (11:30 UTC), real manager messages";

async function runMessage(t: T, message: ManagerMessage): Promise<void> {
  vi.setSystemTime(new Date("2026-11-04T15:30:00Z"));
  t.directory(MANAGER_ROSTER);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  const reply = await thread.say(message.text);
  const card = thread.proposal ? { templateKey: thread.proposal.templateKey ?? null, employeeName: thread.proposal.employeeName ?? null } : null;
  let saved: Record<string, string> = {};
  let checked: Record<string, string[]> = {};
  if (message.person && card?.employeeName) {
    t.draftWrites(
      { observation: `Observed:\n${message.person.firstName} ${message.person.lastName} did not meet the expected performance standards.` },
      { offense_type: ["under_performance"] },
    );
    const id = await thread.create();
    saved = t.values(id);
    checked = t.checked(id);
  }
  const run: LiveOutcome = { card, reply: reply.content, replies: [reply.content], saved, checked, error: null };
  const failed = managerCriteria(message)
    .map((criterion) => ({ name: criterion.name, why: criterion.check(run) }))
    .filter((entry) => entry.why);
  expect(failed, `"${message.text}" fails ${failed.map((entry) => `${entry.name} (${entry.why})`).join("; ")}\n${reply.content}`).toEqual([]);
}

/*
 * #5, PAU'S "ASKS ONCE, CARD AFTER YES" (4 Nov 2026, with the session that
 * owns the Corrective Action work): the statement names no form, so turn 1
 * makes no card and asks exactly once "Do you want a Corrective Action for
 * <Name>?", mentioning the Standards of Conduct; turn 2, "yes", makes the
 * Corrective Action card, and the card or its draft cites the Standards of
 * Conduct with heading and page. MSB is never a name.
 */
async function runAsksOnceThenYes(t: T, message: ManagerMessage): Promise<void> {
  const person = message.person!;
  const name = `${person.firstName} ${person.lastName}`;
  vi.setSystemTime(new Date("2026-11-04T15:30:00Z"));
  t.directory(MANAGER_ROSTER);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  const first = await thread.say(message.text);
  expect(thread.proposal ?? null, `turn 1 made a card:\n${first.content}`).toBeNull();
  const offers = correctiveActionOffers(first.content, person);
  expect(offers.length, `not exactly one "Do you want a Corrective Action for ${name}?":\n${first.content}`).toBe(1);
  expect(offers[0], "the offer does not mention the Standards of Conduct").toMatch(/standards of conduct/i);
  const second = await thread.say("yes");
  expect(thread.proposal, `"yes" made no Corrective Action card for ${name}:\n${second.content}`).toMatchObject({ templateKey: "dpoa", employeeName: name });
  expect(thread.proposal?.employeeName ?? "", "MSB is the name").not.toMatch(/msb|must see/i);
  const onCard = /standards of conduct/i.test(policyLine(second.content)) && /\bp(?:age|\.)\s*\d+/i.test(policyLine(second.content));
  t.draftWrites({ observation: `Observed:\n${name} did not follow the Must See Behaviors.` }, { offense_type: ["under_performance"] });
  const values = t.values(await thread.create());
  const onDraft = /standards of conduct/i.test(values.policy_language ?? "") && /\bp(?:age|\.)\s*\d+/i.test(values.policy_language ?? "");
  expect(onCard || onDraft, `no Standards of Conduct with heading and page (card: "${policyLine(second.content)}", draft: "${values.policy_language ?? ""}")`).toBe(true);
  expect(values.employee_name ?? "", "MSB is saved as the name").not.toMatch(/msb|must see/i);
}

const byId = (id: string): ManagerMessage => MANAGER_MESSAGES.find((message) => message.id === id)!;

export const NOV4_MANAGER_MSB_CASES: ReplayCase[] = [
  {
    id: "nov4-mgr-1-verbal-metrics",
    title: `"${byId("mgr-1-verbal-metrics").text}" — a CA card, no "what happened", cites the Standards of Conduct`,
    report: `${REPORT}, #1`,
    // Run 4 Nov 2026 (production flags): fails as below.
    status: { open: "no card at all: the metrics are answered with the progression (\"I won't open formal corrective action off a metric\"), so no Standards of Conduct citation" },
    fixFlags: ["CA_SALES_POLICY_ENABLED"],
    run: (t) => runMessage(t, byId("mgr-1-verbal-metrics")),
  },
  {
    id: "nov4-mgr-2-msb-no-name",
    title: `"${byId("mgr-2-msb-no-name").text}" — asks once which employee; MSB is never a name`,
    report: `${REPORT}, #2`,
    // Run 4 Nov 2026 (production flags): failed as below.
    // Before CHAT_GLOSSARY_ENABLED was on in production (4 Nov 2026): OPEN, "msb" is the employee: "I can create a **Corrective Action Form** for **msb**" (the card names "Msb"), and it says "You haven't told me what happened yet" instead of asking once which employee
    // Fixed by CHAT_GLOSSARY_ENABLED, on in production from 4 Nov 2026 (QA's flip; MSB meaning confirmed by Pau).
    status: "fixed",
    run: (t) => runMessage(t, byId("mgr-2-msb-no-name")),
  },
  {
    id: "nov4-mgr-3-salon-metrics",
    title: `"${byId("mgr-3-salon-metrics").text}" — a CA card, no "what happened", cites the Standards of Conduct`,
    report: `${REPORT}, #3`,
    // Run 4 Nov 2026 on main before #512: OPEN, the card says "Under Performance, as you said. The policy manual has no single section to quote for it": no Standards of Conduct citation, on the card or the draft.
    // Holds with production's flags since Corrective Action revision 8 (#512): the form replaces Under Performance with the Standards of Conduct, so the card and the draft cite it.
    status: "fixed",
    fixFlags: ["CA_SALES_POLICY_ENABLED"],
    run: (t) => runMessage(t, byId("mgr-3-salon-metrics")),
  },
  {
    id: "nov4-mgr-4-msb-october",
    title: `"${byId("mgr-4-msb-october").text}" — a CA card, MSB never a name, cites the Standards of Conduct`,
    report: `${REPORT}, #4`,
    // Run 4 Nov 2026 on main before #512: OPEN, a card for the person, but no Standards of Conduct citation on the card or the draft.
    // Holds with production's flags since Corrective Action revision 8 (#512): the draft's Under Performance tick is the Standards of Conduct box, so the draft cites it.
    status: "fixed",
    fixFlags: ["CA_SALES_POLICY_ENABLED"],
    run: (t) => runMessage(t, byId("mgr-4-msb-october")),
  },
  {
    id: "nov4-mgr-5-msb-soc",
    title: `"${byId("mgr-5-msb-soc").text}" — asks once "Do you want a Corrective Action for …?" (Standards of Conduct); "yes" makes the card, citing the Standards of Conduct`,
    report: `${REPORT}, #5 (Pau: asks once, card after yes)`,
    // Run 4 Nov 2026 (production flags): fails as below.
    status: { open: "turn 1 is answered as a policy question (the pack's stand-in answer): no offer \"Do you want a Corrective Action for …?\", so \"yes\" makes no card" },
    // No fixFlags yet: the CA session's pull request (claude/ca-sales-msb-cases) adds the offer behind CA_SALES_POLICY_ENABLED and adds the fixFlags when it merges.
    run: (t) => runAsksOnceThenYes(t, byId("mgr-5-msb-soc")),
  },
];
