import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * PRIOR ACTIONS TYPED WITH NO COMMA (October rebuild 4, #255, 10 Nov 2026)
 * ============================================================================
 *
 * QA, 26 Oct 2026: "prior coaching verbal 6/25 written 7/28 no deduct" (#255, never merged). QA's October triage
 * (docs/parity-log/oct-pr-triage.md, 10 Nov 2026), with production's flags: the card shows "**Prior actions:**
 * Verbal warning — 06/25/2026; Written warning — verbal 6/25 — 07/28/2026"; "prior verbal 9/1 written 9/15" gives
 * "Written warning — 9/1 — 09/15/2026". The manager's words; the employee is the pack's Rowan Kestrel.
 */
const FLAG = "PRIOR_ACTIONS_NO_COMMA_ENABLED";
const REPORT = 'QA, 26 Oct 2026 (#255; the October triage, 10 Nov 2026): "prior coaching verbal 6/25 written 7/28 no deduct"';

const priorLine = (content: string) => content.split("\n").find((line) => /\*\*Prior actions:?\*\*/i.test(line)) ?? "";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-10-26T15:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

const WORDINGS = [
  { key: "qa", text: "create a ca for rowan kestrel, she was late on 10-20-26. prior coaching verbal 6/25 written 7/28 no deduct", verbal: "06/25/2026", written: "07/28/2026" },
  { key: "triage", text: "create a ca for rowan kestrel, she was late on 10-20-26. prior verbal 9/1 written 9/15", verbal: "09/01/2026", written: "09/15/2026" },
] as const;

export const NOV10_PRIOR_ACTIONS_NO_COMMA_CASES: ReplayCase[] = WORDINGS.flatMap((wording) =>
  ([
    ["lower", wording.text],
    ["caps", wording.text.toUpperCase()],
  ] as const).map(([casing, text]) => ({
    id: `nov10-prior-actions-no-comma-${wording.key}-${casing}`,
    title: `"${text}" — Prior actions list a verbal (${wording.verbal}) and a written (${wording.written}), each with only its own words`,
    report: `${REPORT}; ${wording.key}, ${casing}`,
    status: { open: "the second prior action takes the first's words: \"Written warning — verbal 6/25 — 07/28/2026\"" },
    fixFlags: [FLAG],
    async run(t: ReplayContext) {
      const thread = start(t);
      const reply = await thread.say(text);
      const line = priorLine(reply.content);
      expect(line, `no Prior actions line:\n${reply.content}`).not.toBe("");
      expect(line, "the verbal is not listed with its date").toMatch(new RegExp(`Verbal warning — ${wording.verbal}`, "i"));
      expect(line, "the written is not listed with its own date alone").toMatch(new RegExp(`Written warning — ${wording.written}`, "i"));
      expect(line, "the written carries the verbal's words").not.toMatch(/Written warning — (?:verbal )?\d{1,2}\/\d{1,2} —/i);
    },
  })),
);
