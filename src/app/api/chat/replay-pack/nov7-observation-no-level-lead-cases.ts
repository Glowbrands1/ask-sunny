import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayAnswer, type ReplayCase, type ReplayContext } from "./cases";

/**
 * The flip-3 tester's D shape, checked here (QA's list, 6–7 Nov 2026): "create a CA for <name>, verbal, she was
 * late on 10-20-26" made a card whose Observation of Offense opened with the warning level: "verbal, she was late
 * on 10-20-26". The level is the Type of Warning (the card says so on its own line), not the account. The
 * manager's words; the person is the pack's invented Remy Calder.
 */
const FIX = ["OBSERVATION_NO_LEVEL_LEAD_ENABLED"];
const REPORT = "QA, 6–7 Nov 2026 (the flip-3 tester's D, in this app): the Observation opens with \"verbal,\"";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-06T15:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

function observationLine(reply: ReplayAnswer): string {
  return reply.content.split("\n").find((line) => /\*\*Observation of Offense:?\*\*/i.test(line)) ?? "";
}

export const NOV7_OBSERVATION_NO_LEVEL_LEAD_CASES: ReplayCase[] = [
  ...(
    [
      ["lower", "create a CA for remy calder, verbal, she was late on 10-20-26"],
      ["written", "create a CA for Remy Calder, written warning, she was late on 10-20-26"],
    ] as const
  ).map(
    ([key, said]): ReplayCase => ({
      id: `nov7-observation-no-level-lead-${key}`,
      title: `"${said}": the Observation is the account, never led by the warning level`,
      report: REPORT,
      status: { open: "the card's Observation of Offense opens with the level (\"verbal, she was late on 10-20-26\")" },
      fixFlags: FIX,
      async run(t) {
        const thread = start(t);
        const reply = await thread.say(said);
        const line = observationLine(reply);
        expect(line, `no Observation:\n${reply.content}`).toMatch(/late on 10-20-26/);
        expect(line, `the level leads the Observation:\n${line}`).not.toMatch(/Observation of Offense:\*\*\s*(?:verbal|written|final)\b/i);
      },
    }),
  ),
  {
    id: "nov7-observation-no-level-lead-negative",
    title: "negative: \"create a CA for <A>, she was late on 10-20-26 after a verbal warning\" keeps its whole account",
    report: `${REPORT} (the condition)`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      const reply = await thread.say("create a CA for Remy Calder, she was late on 10-20-26 after a verbal warning");
      expect(observationLine(reply), `the account lost words:\n${reply.content}`).toMatch(/late on 10-20-26/);
    },
  },
];
