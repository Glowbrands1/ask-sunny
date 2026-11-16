import { describe, expect, it } from "vitest";

import { caseId, NOV15_AGENT_LOOP_PHRASING_CASES, OPEN_UNTIL_PR1 } from "@/app/api/chat/replay-pack/nov15-agent-loop-phrasing-cases";

import { BEHAVIOURS, PHRASING_KINDS } from "./phrasing-table";

/**
 * ============================================================================
 * PHRASING SCAFFOLD (PR 7a, QA's audit, 15 Nov 2026)
 * ============================================================================
 *
 * The behaviours and their phrasings are in `phrasing-table.ts`. Each phrasing runs as a replay-pack case
 * (`replay-pack/nov15-agent-loop-phrasing-cases.ts`, the real chat route, production's flags with the loop on):
 * the mocked model returns the same structured tool arguments for every phrasing of a behaviour, and the case asserts
 * the same outcome on saved data and structured tool results. No assertion reads an English phrase. This file
 * checks the table is complete and the generated cases match it.
 *
 * Evidence arguments ({message_id, quote}; `evidence.ts`) replaced the word lists the tools read the manager's message
 * with (PR 1): the mocked model passes each phrasing's evidence, and the fix-name case asserts the corrected name saved
 * by `edit_form` intent "correct_name" (fix-name) and nothing else changed.
 */

const BEHAVIOUR_KEYS = ["write-account", "answer-level", "answer-payroll", "fix-name", "exit-form", "forms-on-file", "undo-level", "nothing-changed"];

describe("the phrasing table", () => {
  it("covers the eight behaviours", () => {
    expect(BEHAVIOURS.map((behaviour) => behaviour.key)).toEqual(BEHAVIOUR_KEYS);
  });

  it.each(BEHAVIOURS.map((behaviour) => [behaviour.key, behaviour] as const))("%s has six or more distinct phrasings, one of each kind", (_key, behaviour) => {
    expect(behaviour.phrasings.length).toBeGreaterThanOrEqual(6);
    expect(new Set(behaviour.phrasings.map((phrasing) => phrasing.said)).size).toBe(behaviour.phrasings.length);
    for (const kind of PHRASING_KINDS) expect(behaviour.phrasings.map((phrasing) => phrasing.kind), `${behaviour.key} has no ${kind} phrasing`).toContain(kind);
  });

  it("the kinds are what they say", () => {
    for (const behaviour of BEHAVIOURS) {
      for (const phrasing of behaviour.phrasings) {
        if (phrasing.kind === "no-punctuation") expect(phrasing.said, `${behaviour.key}: ${phrasing.said}`).not.toMatch(/[.,;:!?]/);
        if (phrasing.kind === "short") expect(phrasing.said.split(/\s+/).length).toBeLessThanOrEqual(5);
        if (phrasing.kind === "long") expect(phrasing.said.split(/\s+/).length).toBeGreaterThanOrEqual(15);
      }
    }
  });
});

describe("the generated replay cases", () => {
  it("one case per phrasing, with the table's ids", () => {
    const expected = BEHAVIOURS.flatMap((behaviour) => behaviour.phrasings.map((_phrasing, index) => caseId(behaviour, index)));
    expect(NOV15_AGENT_LOOP_PHRASING_CASES.map((entry) => entry.id)).toEqual(expected);
    expect(expected.length).toBeGreaterThanOrEqual(48);
  });

  it("every phrasing still open names a real case and says what it is waiting for", () => {
    const ids = NOV15_AGENT_LOOP_PHRASING_CASES.map((entry) => entry.id);
    for (const [id, why] of Object.entries(OPEN_UNTIL_PR1)) {
      expect(ids, `${id} is not a phrasing case`).toContain(id);
      // Changed on purpose (PR 1c): the evidence-argument phrasings are done; the one left open is an amount said in words,
      // which is the amount check's, not PR 1's.
      expect(why).toMatch(/TODO\((?:PR1|amount-words)\)/);
    }
  });
});
