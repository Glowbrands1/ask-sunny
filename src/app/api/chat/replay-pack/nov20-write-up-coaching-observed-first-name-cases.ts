import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * A COACHING OBSERVED LINE: THE FIRST NAME, AND WHAT WAS SEEN, NOT THE TOPIC (QA's live test of #1144, 20 Nov 2026)
 * ============================================================================
 *
 * Main 263fc0e9, draft 8a22b0dd (chat conv_mwpdb4ty23uks9p). The manager typed "coaching for Test Testy on greeting
 * guests, she didn't greet 3 guests today"; the saved coaching_details read "Observed:\nGreeting guests, she didn't greet
 * 3 guests.\n\nExpectation:\nTest is expected to greet all guests…". Observed called the employee "she" (an AI-written
 * saved field; item 15) and opened with the coaching topic as a prefix. Expected: "Test didn't greet 3 guests today."
 * On the real Create path; the tester's invented "Test Testy" is STAFF's invented Remy Calder here.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's live test of #1144 (20 Nov 2026): the coaching Observed said \"she\" and opened with the topic";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

const SAID = "coaching for Remy Calder on greeting guests, she didn't greet 3 guests today";

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || !offline) return;
    vi.setSystemTime(new Date("2026-11-20T18:00:00Z"));
    t.directory([...STAFF]);
    t.as("salon_director", KEARNEY);
    await run(t);
  },
});

async function created(t: ReplayContext, account: string, drafted: string) {
  t.loopModel!(loopStandIn((view): LoopDecision => lastResult(view, "propose_form")
    ? { text: "Here's the Coaching Form for **Remy**." }
    : {
        tool: "propose_form",
        input: {
          template_key: "coaching",
          employee_name: "Remy Calder",
          person_evidence: evidenceFrom(view, "Remy Calder"),
          what_happened: account,
          topic: "greeting guests",
          topic_evidence: evidenceFrom(view, "greeting guests"),
          incident_date: "2026-11-20",
        },
      }));
  t.draftWrites({ coaching_details: drafted });
  const thread = t.thread();
  await thread.say(SAID);
  const id = await thread.create();
  return t.values(id).coaching_details ?? "";
}

const observedOf = (details: string) => /Observed:\s*\n?([\s\S]*?)(?=\n\s*(?:Expectation|Going Forward):|$)/i.exec(details)?.[1]?.trim() ?? "";

function expectSeenWithName(details: string) {
  const observed = observedOf(details);
  expect(observed, `no Observed was saved (the case proves nothing):\n${details}`).toMatch(/greet 3 guests/);
  expect(observed, `Observed calls the employee "she":\n${details}`).not.toMatch(/\b(?:she|her|he|him|his)\b/i);
  expect(observed, `Observed opens with the coaching topic:\n${details}`).not.toMatch(/^greeting guests\b/i);
  expect(observed, `Observed is not what was seen, by name:\n${details}`).toMatch(/^Remy didn't greet 3 guests\b/);
}

export const NOV20_WRITE_UP_COACHING_OBSERVED_FIRST_NAME_CASES: ReplayCase[] = [
  fixed("nov20-coaching-observed-first-name-no-topic-prefix", `QA's live test of #1144: "${SAID}", the drafter writes Observed as saved ("Greeting guests, she didn't greet 3 guests."): Observed reads "Remy didn't greet 3 guests …"`, async (t) => {
    expectSeenWithName(await created(t, "Greeting guests, she didn't greet 3 guests today.", "Observed:\nGreeting guests, she didn't greet 3 guests.\n\nExpectation:\nRemy is expected to greet all guests as they arrive."));
  }),
  fixed("nov20-coaching-observed-from-card-account-no-topic-prefix", `QA's live test of #1144: "${SAID}", Observed written as a coaching record and so rebuilt from the card's account ("Greeting guests, she didn't greet 3 guests today."): it reads "Remy didn't greet 3 guests today."`, async (t) => {
    const details = await created(t, "Greeting guests, she didn't greet 3 guests today.", "Observed:\nCoaching was provided to Remy on greeting guests.\n\nExpectation:\nRemy is expected to greet all guests as they arrive.");
    expectSeenWithName(details);
    expect(observedOf(details)).toBe("Remy didn't greet 3 guests today.");
  }),
];
