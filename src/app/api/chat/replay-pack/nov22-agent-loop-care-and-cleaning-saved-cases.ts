import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A LOOP CARD CITING "CARE AND CLEANING … p.21" SAVES IT (port from Ask Bubbles fee69631: its QA's round 2, 22 Nov 2026;
 * U06/U09/U15/U17)
 * ============================================================================
 *
 * The manager's turns, word for word (the person Sunny's invented Remy Calder): T1 "corrective action", T2 "<P>", T3
 * "This is what happened: She has recieved coaching on 9/22 for cleaning tasks not being completed. What was observed
 * this weekend is that trash liners were not put into the trash cans after collecting trash, laundry was not done". The
 * card cited "Care and Cleaning of Equipment and Facilities, JBA Policy Manual p.21"; the saved form had no Policy
 * Violated and no Direct policy: Create read the card's heading through `namedPolicies`, whose NOT_A_NAME rule takes "of"
 * as a sentence about a policy. Sunny's pinned manual has the same section, and sixteen more headings with "of", "to",
 * "with" or "by" (Standards of Conduct, Return of Property, Proper Use of General Operating Equipment, …).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Port from Ask Bubbles (fee69631; its QA's round 2, U06/U09/U15/U17): a card citing Care and Cleaning of Equipment and Facilities p.21 saved no Policy Violated or Direct policy";
const T1 = "corrective action";
const T2 = "Remy Calder";
const T3 =
  "This is what happened: She has recieved coaching on 9/22 for cleaning tasks not being completed. What was observed this weekend is that trash liners were not put into the trash cans after collecting trash, laundry was not done";
const ACCOUNT = "Remy did not put trash liners into the trash cans after collecting trash this weekend, and laundry was not done.";
const HEADING = "Care and Cleaning of Equipment and Facilities";
const CARE = {
  chunkIndex: 21.5,
  chunkId: "jba-21-5",
  locator: `Page 21 — ${HEADING}`,
  page: 22,
  content: `${HEADING}\nEmployees keep the salon, its beds and its equipment clean and sanitized as directed.`,
  section: HEADING,
  printedPage: 21,
  sections: [],
};

function start(t: ReplayContext, chunk: Record<string, unknown> = CARE) {
  vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  t.manualAlsoHas?.([chunk]);
}

const said = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0).at(-1)?.text ?? "";

const live = () =>
  loopStandIn((view): LoopDecision => {
    if (lastResult(view, "propose_form")) return { text: "Here's the Corrective Action Form." };
    if (said(view) === T1) return { text: "This Corrective Action Form needs a person. Who is it for?" };
    return {
      tool: "propose_form",
      input: { template_key: "dpoa", employee_id: "e-2", policy: headingWith(view, /care and cleaning/i), person_evidence: evidenceFrom(view, "Remy Calder", said(view) === T2 ? 0 : 1), ...(said(view) === T3 ? { what_happened: ACCOUNT, incident_date: "2026-11-16" } : {}) },
    };
  });

async function createdForm(t: ReplayContext) {
  const thread = t.thread();
  t.loopModel!(live());
  for (const turn of [T1, T2, T3]) await thread.say(turn);
  const line = (thread.proposal as { policyLine?: string | null } | null)?.policyLine ?? "";
  expect(line, "the case proves nothing: the card does not cite Care and Cleaning").toMatch(/Care and Cleaning of Equipment and Facilities(?: Policy)?, JBA Policy Manual p\.21/);
  const id = await thread.create();
  return t.values(id);
}

function expectSaved(values: Record<string, string>) {
  const saved = JSON.stringify(values);
  expect(values.policy_violated ?? "", `Policy Violated does not name the card's section:\n${saved}`).toContain(HEADING);
  expect(values.policy_language ?? "", `Direct policy does not quote the card's section:\n${saved}`).toMatch(/Care and Cleaning of Equipment and Facilities, p\. ?21/);
  expect(values.policy_language ?? "", `the previous section's tail was quoted:\n${values.policy_language}`).not.toMatch(/approved messages/);
}

const fixed = (id: string, title: string, chunk?: Record<string, unknown>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.()) return;
    start(t, chunk);
    expectSaved(await createdForm(t));
  },
});

export const NOV22_AGENT_LOOP_CARE_AND_CLEANING_SAVED_CASES: ReplayCase[] = [
  fixed("nov22-care-and-cleaning-card-saved", "U06/U09/U15/U17 (ported): a card citing \"Care and Cleaning of Equipment and Facilities, JBA Policy Manual p.21\": Create saves Policy Violated and Direct policy (p. 21) for it"),
  fixed(
    "nov22-care-and-cleaning-card-saved-production-chunk",
    "The same, with the chunk as production holds it: the heading 105 characters in, after the previous section's tail",
    { ...CARE, content: `${"the salon phone is for business calls only, and only for sending company-approved messages.".padStart(105, " ")}\n${CARE.content}` },
  ),
];
