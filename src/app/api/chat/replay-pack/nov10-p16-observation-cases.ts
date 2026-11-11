import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { failureToOpenPeople } from "./nov10-failure-to-open-cases";

/**
 * ============================================================================
 * P16'S CARD CARRIES THE ACCOUNT (QA's live round 17b, 10 Nov 2026; ported from Ask Bubbles)
 * ============================================================================
 *
 * In the sibling app, live: "Can you make a CA for <name> for failure to open on time?" cited Late Opening with an empty
 * Issue. Here, with FAILURE_TO_OPEN_IS_LATE_OPENING on, the card had no Observation of Offense at all: the whole turn
 * was dropped as a question to the app, then as an instruction. REQUEST_ISSUE_KEPT_ENABLED (same flag in both apps).
 */
const P16 = "Can you make a CA for Corisande Pell for failure to open on time?";
const observation = (content: string) => /\*\*Observation of Offense:\*\*\s*([^\n]*)/.exec(content)?.[1]?.trim() ?? null;

export const NOV10_P16_OBSERVATION_CASES: ReplayCase[] = ([
  ["as-typed", P16],
  ["lower", P16.toLowerCase()],
] as const).map(([casing, said]) => ({
  id: `nov10-r17b-p16-observation-${casing}`,
  title: `"${said}": the card's Observation of Offense carries the account`,
  report: `QA's live round 17b (10 Nov 2026), gap 1 (P16); ${casing}`,
  status: { open: "\"You haven't told me what happened yet\"; with the P16 flag, no Observation of Offense" },
  fixFlags: ["FAILURE_TO_OPEN_IS_LATE_OPENING_ENABLED", "REQUEST_ISSUE_KEPT_ENABLED"],
  async run(t: ReplayContext) {
    vi.setSystemTime(new Date("2026-11-10T22:30:00Z"));
    t.directory([...STAFF, ...failureToOpenPeople()]);
    t.as("salon_director", KEARNEY);
    const thread = t.thread();
    const reply = await thread.say(said);
    expect(reply.content, "the card does not cite Late Opening").toMatch(/Late Opening/);
    expect(observation(reply.content), `no account on the card:\n${reply.content}`).toMatch(/^failure to open on time$/i);
  },
}));
