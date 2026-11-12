import { expect, vi } from "vitest";

import { KEARNEY, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A SPECIFIC ITEM'S DRESS-CODE QUESTION READS THE POLICY MANUAL (QA, 12 Nov 2026; the sibling app's 17g "policy
 * specific to uggs?" finding, checked here)
 * ============================================================================
 *
 * With FULL_MANUAL_CONTEXT on, the gate (`isPolicyAnswerQuestion`) loads the JBA Policy Manual for "is there a policy
 * specific to uggs?" whatever the normalizer's intent — guarded below. "can employees wear uggs at work?" loads it only
 * when the normalizer reads "policy"; read as "other" it is answered from retrieval alone, without the manual that
 * names the item. QA (12 Nov 2026): no wide-gate port for now; this OPEN case documents the gap, to be fixed if a
 * manager hits it. See `docs/parity-log/2026-11-12-uggs-manual-gate.md`.
 */
const REPORT = "QA, 12 Nov 2026: a dress-code question about one item is not answered from the policy manual when its intent reads \"other\"";
const MANUAL = "JBA Policy Manual";

function start(t: ReplayContext, intent: string) {
  vi.setSystemTime(new Date("2026-11-12T03:00:00Z"));
  t.as("salon_director", KEARNEY);
  t.fullManualLoads!();
  t.normalizerReads!(intent);
  return t.thread();
}

export const NOV12_UGGS_MANUAL_GATE_CASES: ReplayCase[] = [
  {
    id: "nov12-uggs-policy-specific-reads-manual",
    title: "Guard: \"is there a policy specific to uggs?\" (intent read as \"other\") is answered with the policy manual",
    report: REPORT,
    status: "fixed",
    async run(t) {
      const reply = await start(t, "other").say("is there a policy specific to uggs?");
      expect(t.lastGrounding!(), `the policy manual never reached the answer:\n${reply.content}`).toContain(MANUAL);
    },
  },
  {
    id: "nov12-uggs-can-employees-wear-reads-manual",
    title: "\"can employees wear uggs at work?\" (intent read as \"other\") is answered with the policy manual",
    report: REPORT,
    status: { open: "read as \"other\", the question is answered from retrieval alone; the policy manual is not in the prompt" },
    async run(t) {
      const reply = await start(t, "other").say("can employees wear uggs at work?");
      expect(t.lastGrounding!(), `the policy manual never reached the answer:\n${reply.content}`).toContain(MANUAL);
    },
  },
];
