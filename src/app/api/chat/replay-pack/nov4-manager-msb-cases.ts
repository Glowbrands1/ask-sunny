import { expect, vi } from "vitest";

import { KEARNEY, type ReplayCase, type ReplayContext } from "./cases";
import { MANAGER_MESSAGES, MANAGER_ROSTER, managerCriteria, type LiveOutcome, type ManagerMessage } from "./nov4-live-regressions-scenarios";

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

/**
 * `modelObservation` is the Observation the stand-in draft model writes; blank
 * (nov4-mgr-4) lets the route write it from the manager's words, the path a
 * request-shaped Observation would come from.
 */
async function runOutcome(t: T, message: ManagerMessage, modelObservation?: string): Promise<LiveOutcome> {
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
      { observation: modelObservation ?? `Observed:\n${message.person.firstName} ${message.person.lastName} did not meet the expected performance standards.` },
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
  return run;
}

async function runMessage(t: T, message: ManagerMessage): Promise<void> {
  await runOutcome(t, message);
}

/** MSB read as an unknown word: looked up as a person, or asked about. */
const MSB_UNKNOWN = /couldn'?t find \*\*msb\*\*|\bmsb (?:gaps?|language)\b|what (?:is|does|do you mean by) msb/i;

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
    // Open again with QA's live finding (4 Nov 2026, 13:23 UTC), asserted below: with production's flags the card's Observation is the whole request.
    status: { open: "the card's Observation of Offense is the whole request (\"MSB CA for <name> for underperformance in the month of October\") with production's flags" },
    // CHAT_GLOSSARY_ENABLED is on in production since 4 Nov 2026 (13:07 UTC); the case holds with both, as in the sibling app.
    fixFlags: ["CA_SALES_POLICY_ENABLED", "CHAT_GLOSSARY_ENABLED"],
    /*
     * QA, 4 Nov 2026 (13:23 UTC), live with CHAT_GLOSSARY_ENABLED on: this app's
     * Observation was the whole request ("MSB CA for <name> for underperformance
     * in the month of October"); the sibling app asked about "MSB gaps" / "MSB
     * language" as if MSB were unknown. Neither, with the flags on.
     */
    async run(t) {
      const message = byId("mgr-4-msb-october");
      const run = await runOutcome(t, message, "");
      const observation = run.saved.observation ?? "";
      expect(observation, "the Observation is empty").not.toBe("");
      expect(observation, `the Observation holds the request words:\n${observation}`).not.toMatch(/\bMSB\s+CA\b|\bCA\s+for\b/i);
      expect(observation, `the Observation does not hold the account (underperformance in October):\n${observation}`).toMatch(/underperform/i);
      const cardObservation = run.reply.split("\n").find((line) => /Observation of Offense/i.test(line)) ?? "";
      expect(cardObservation, `the card's Observation holds the request words:\n${run.reply}`).not.toMatch(/\bMSB\s+CA\b|\bCA\s+for\b/i);
      expect(run.reply, `MSB is treated as unknown:\n${run.reply}`).not.toMatch(MSB_UNKNOWN);
    },
  },
  {
    id: "nov4-mgr-5-msb-soc",
    title: `"${byId("mgr-5-msb-soc").text}" — a card, MSB never a name, cites the Standards of Conduct`,
    report: `${REPORT}, #5`,
    // Run 4 Nov 2026 (production flags): fails as below.
    status: { open: "no card at all: the statement with no form named is answered as a policy question (the pack's stand-in answer), with production's flags and with CHAT_GLOSSARY_ENABLED and CA_SALES_POLICY_ENABLED on; neither flag makes it hold, so no fixFlags" },
    // No fixFlags: with either flag or both on it still gets no card.
    run: (t) => runMessage(t, byId("mgr-5-msb-soc")),
  },
];
