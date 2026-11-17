import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * THE COACHING CARD'S POLICY REACHES THE SAVED FORM (QA's live check, 17 Nov 2026; Pau: "coaching should always have policy and page")
 * ============================================================================
 *
 * The tester's coaching draft (3b1279b1) saved other_topic "Greeting guests at the door" and coaching_details with
 * Observed / Expectation / Going Forward, and no policy anywhere: the card had none. The Coaching Form has no policy field;
 * #1090's cardPolicyLine writes the card's whole policy line as the Details' last line ("Policy reference: <line>"). These
 * cases run the real Create path: the model leaves the policy out, propose_form says policy_not_given, the model proposes
 * again with a heading, and the saved coaching_details ends with that line and its page (or "Other — <topic>"). The
 * drafting model is a stand-in that writes the Details with no policy line. Invented name (Remy Calder) for the tester's.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's live check (17 Nov 2026): the tester's coaching draft 3b1279b1 saved with no policy anywhere; Pau: coaching should always have policy and page";
const offline = process.env.AGENT_LOOP_LIVE !== "1";
const SAID = "Coaching for remy calder on greeting guests at the door";
const DETAILS = "Observed:\nRemy is not greeting guests at the door.\n\nExpectation:\nGreet every guest at the door.\n\nGoing Forward:\nRemy will greet every guest at the door.";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-17T05:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

/** The model proposes with no policy, then (told policy_not_given) with `policy`; Create; the saved Details. */
async function savedDetails(t: ReplayContext, policy: string) {
  let toldNoPolicy = false;
  t.loopModel!(loopStandIn((view): LoopDecision => {
    const done = view.results.filter((result) => result.tool === "propose_form").map((result) => result.output);
    const base = { template_key: "coaching", employee_name: "Remy Calder", person_evidence: evidenceFrom(view, "remy calder"), what_happened: "Remy is not greeting guests at the door." };
    if (done.length === 0) return { tool: "propose_form", input: base };
    if (done.length === 1 && (done[0]!.facts as { policy_not_given?: unknown } | undefined)?.policy_not_given) {
      toldNoPolicy = true;
      return { tool: "propose_form", input: { ...base, policy } };
    }
    return { text: "Here's the Coaching Form for **Remy Calder**." };
  }));
  t.draftWrites({ coaching_details: DETAILS, other_topic: "Greeting guests at the door" }, { coaching_topics: ["other"] });
  const thread = t.thread();
  await thread.say(SAID);
  const card = (thread.proposal as { policyLine?: string | null } | null)?.policyLine ?? null;
  const id = await thread.create();
  return { toldNoPolicy, card, details: t.values(id).coaching_details ?? "" };
}

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || !offline) return;
    start(t);
    await run(t);
  },
});

export const NOV17_COACHING_POLICY_REACHES_SAVED_FORM_CASES: ReplayCase[] = [
  fixed("nov17-coaching-policy-on-saved-details-heading", `"${SAID}": the card first has no policy (policy_not_given), then cites Standards of Conduct with its page; Create saves coaching_details ending "Policy reference: Standards of Conduct Policy, JBA Policy Manual p.<n>"`, async (t) => {
    const saved = await savedDetails(t, "Standards of Conduct");
    expect(saved.toldNoPolicy, "propose_form did not say policy_not_given for a coaching card with no policy").toBe(true);
    expect(saved.card ?? "").toMatch(/^Standards of Conduct Policy, JBA Policy Manual p\.\d+$/);
    expect(saved.details, "the saved Coaching Form has no policy and page").toMatch(/\n\nPolicy reference: Standards of Conduct Policy, JBA Policy Manual p\.\d+$/);
    expect(saved.details, "the drafted Details were not kept").toContain("Going Forward:\nRemy will greet every guest at the door.");
  }),
  fixed("nov17-coaching-policy-on-saved-details-other", `"${SAID}": no section fits and the card cites "Other — Greeting guests at the door"; Create saves coaching_details ending "Policy reference: Other — Greeting guests at the door"`, async (t) => {
    const saved = await savedDetails(t, "Other — Greeting guests at the door");
    expect(saved.toldNoPolicy).toBe(true);
    expect(saved.details, "the saved Coaching Form has no policy").toMatch(/\n\nPolicy reference: Other — Greeting guests at the door$/);
  }),
];
