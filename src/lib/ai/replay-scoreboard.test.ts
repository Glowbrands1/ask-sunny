import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  REPLAY_LATENCY_GATE_MS,
  casesWhereOldPromptScoresBetter,
  judgeReplayCard,
  judgeFixRound,
  judgeRulebookRun,
  judgeRulebookRuns,
  latencyOverGate,
  latencyRegressed,
  renderRulebookScoreboard,
  renderScoreboard,
  rulebookVerdict,
  twoSentencePlan,
  type ReplayCardCriteria,
  type ReplayRound,
  type RulebookRun,
  type RulebookSpec,
} from "./replay-scoreboard";

const CRITERIA: ReplayCardCriteria = {
  employee: "Jane Do",
  salon: "loc-0314",
  date: "2026-10-23",
  policy: "Attendance p.14",
  noBlockingQuestion: true,
  noLeakedInternalText: true,
};

const ROUND: ReplayRound = {
  title: "Round 2 — under-card note",
  replaySetHash: "abc",
  promptHash: "def",
  commit: "1696015691acb5b6d220c20b1c506d5d0e89c144",
  model: "claude-opus-5",
  flags: ["CODE_SLOTS_ENABLED", "TYPED_NAME_PROCEEDS_ENABLED"],
  runs: 3,
  latencyGateMs: REPLAY_LATENCY_GATE_MS,
  criteria: [{ id: "n2", criteria: CRITERIA }],
  flagsOff: [{ id: "n2", pass: true, ms: 40 }],
  flagsOn: [{ id: "n2", pass: true, ms: 120 }],
  harnessEvents: [
    { caseId: "s4", event: "resend-first-message" },
    { caseId: "s4", event: "resend-first-message" },
  ],
};

describe("replay card criteria", () => {
  it("passes the written card fields", () => {
    expect(
      judgeReplayCard({
        criteria: CRITERIA,
        employeeName: "Jane Do",
        locationId: "loc-0314",
        formDate: "2026-10-23",
        content: "Here is the card.\n\nWoven has Jane Doe",
        policySatisfied: true,
      }),
    ).toEqual([]);
  });

  it("fails a Did you mean question, a roster refusal, and a slow case", () => {
    expect(
      judgeReplayCard({
        criteria: CRITERIA,
        employeeName: "Jane Doe",
        locationId: "loc-0314",
        formDate: "2026-10-23",
        content: "Did you mean **Jane Doe**?",
        policySatisfied: true,
      }).join(" "),
    ).toMatch(/employee|blocking question/);
    expect(
      judgeReplayCard({
        criteria: CRITERIA,
        employeeName: "Jane Do",
        locationId: "loc-0314",
        formDate: "2026-10-23",
        content: "I cannot repair this form.",
        policySatisfied: false,
      }),
    ).toEqual(expect.arrayContaining(["policy Attendance p.14 is not on the card", "leaked internal text"]));
    expect(latencyOverGate(REPLAY_LATENCY_GATE_MS)).toBe(false);
    expect(latencyOverGate(REPLAY_LATENCY_GATE_MS + 1)).toBe(true);
  });

  it("keeps flags-off and flags-on in separate columns", () => {
    const board = renderScoreboard([ROUND]);
    expect(board).toContain("replay_set.json sha256: `abc`");
    expect(board).toContain("prompts.ts sha256: `def`");
    expect(board).toContain("commit: `1696015691acb5b6d220c20b1c506d5d0e89c144`");
    expect(board).toContain("model: `claude-opus-5`");
    expect(board).toContain("CODE_SLOTS_ENABLED, TYPED_NAME_PROCEEDS_ENABLED");
    expect(board).toContain("| Case | Card criteria | Flags off | Flags on |");
    expect(board).toContain("| n2 | Jane Do · loc-0314 · 2026-10-23 · Attendance p.14 | PASS 40ms | PASS 120ms |");
    expect(board).toContain("s4: resend-first-message × 2");
    expect(board).toContain("not a case failure");
  });

  it("records the current replay set, with both columns passing", () => {
    const board = readFileSync("docs/scoreboard.md", "utf8");
    const replaySetHash = createHash("sha256").update(readFileSync("src/lib/ai/__fixtures__/replay_set.json")).digest("hex");
    expect(board).toContain(replaySetHash);
    expect(board).toContain("68f86ab2aad33782047d57ada4b04836c1888e6e8a2d2a2487d9a00c25786dc6");
    expect(board).toContain("| Case | Card criteria | Flags off | Flags on |");
    expect(board).not.toContain("FAIL");
    if (board.includes("## Round 3 — prompt A/B")) {
      const promptHash = createHash("sha256").update(readFileSync("src/lib/ai/prompts.ts")).digest("hex");
      expect(board).toContain(promptHash);
      expect(board).toContain("| Case | Card criteria | Flags off | Current prompt | Last-known-good prompt |");
      expect(board).toContain("417e80c12d7275681411606f87af851fb080b348");
      expect(board).toContain("prompt revert: none");
    }
    if (board.includes("## Rulebook — old behaviour against guide v3")) {
      expect(board).toContain("b9ae362fd80e1fc492c4326f80834cf105ef19b8");
      expect(board).toContain("Totals:");
      expect(board).toMatch(/worse 0\./);
    }
    expect(board).toContain("| CHAT_DATA_TOOLS_ENABLED | 28/28 | 11/28 | — |");
    expect(board).toContain("| s22 | miss | miss |");
    expect(board).toContain("| s23 | miss | pass |");
    if (board.includes("## Prompt cache")) {
      expect(board).toContain("---DYNAMIC---");
      expect(board).toContain("usage.cache_creation_input_tokens:");
      expect(board).toContain("usage.cache_read_input_tokens > 0:");
      expect(board).toContain("first-token latency OLD:");
      expect(board).toContain("first-token latency NEW:");
      expect(board).toContain("replay pass/fail: unchanged");
    }
    if (board.includes("## Round 1 — structural name, slot, and salon")) {
      const round1 = board.slice(board.indexOf("## Round 1 — structural name, slot, and salon"));
      expect(round1).toContain("SELF_CHECK_ENABLED=false");
      expect(round1).toContain("SELF_CHECK: off");
      expect(round1).toContain("harness: local");
      expect(round1).toContain("- accepted: yes");
      expect(round1).toContain("broken 0, latency 0, leaked 0");
      expect(round1).not.toMatch(/SELF_CHECK_ENABLED=(1|true|on|yes)/);
    }
  });

  it("names a case only when the old prompt passes and the current prompt fails", () => {
    const current = [
      { id: "s4", pass: false, ms: 10, failure: "blocking question" },
      { id: "s9", pass: true, ms: 10 },
      { id: "n2", pass: false, ms: 10, failure: "employee" },
    ];
    const oldPrompt = [
      { id: "s4", pass: true, ms: 10 },
      { id: "s9", pass: true, ms: 10 },
      { id: "n2", pass: false, ms: 10, failure: "employee" },
    ];
    expect(casesWhereOldPromptScoresBetter(current, oldPrompt)).toEqual(["s4"]);
    expect(casesWhereOldPromptScoresBetter(oldPrompt, oldPrompt)).toEqual([]);
  });

  it("adds the last-known-good column beside the current prompt", () => {
    const board = renderScoreboard([
      {
        ...ROUND,
        title: "Round 3 — prompt A/B",
        promptAb: {
          lastKnownGoodCommit: "417e80c12d7275681411606f87af851fb080b348",
          lastKnownGoodFileHash: "0c6b9f2e",
          currentBuiltHash: "aaa",
          lastKnownGoodBuiltHash: "aaa",
          promptsDiffer: false,
          revert: "none",
          lastKnownGood: [{ id: "n2", pass: true, ms: 90 }],
        },
      },
    ]);
    expect(board).toContain("| Case | Card criteria | Flags off | Current prompt | Last-known-good prompt |");
    expect(board).toContain("| n2 | Jane Do · loc-0314 · 2026-10-23 · Attendance p.14 | PASS 40ms | PASS 120ms | PASS 90ms |");
    expect(board).toContain("prompt text differs: no");
    expect(board).toContain("prompt revert: none");
    expect(board).toContain("417e80c12d7275681411606f87af851fb080b348");
  });
});

const PLAN =
  "Management will review the Late Opening policy with Test. Future policy violations may result in additional corrective action up to and including termination of employment.";

const SPEC: RulebookSpec = {
  employee: "Colene Shildt",
  salon: null,
  cardExpected: true,
  date: "2026-09-29",
  policy: "Attendance p.14",
  expectPlan: true,
  amount: { expect: "$25" },
};

function run(overrides: Partial<RulebookRun> = {}): RulebookRun {
  return {
    employeeName: "Colene Shildt",
    locationId: null,
    formDate: "2026-09-29",
    hasCard: true,
    speech: "The draft is ready.",
    cardText: PLAN,
    policySatisfied: true,
    payrollDeductAmount: "$25.00",
    ...overrides,
  };
}

describe("rulebook old against new", () => {
  it("keeps a typed name, an unknown salon, the manager's amount, and a two-sentence plan", () => {
    expect(twoSentencePlan(PLAN)).toBe(true);
    expect(
      twoSentencePlan(
        "Management will review the Late Opening policy with Test. A payroll deduction of $25 applies. Future policy violations may result in additional corrective action up to and including termination of employment.",
      ),
    ).toBe(false);
    expect(judgeRulebookRun(SPEC, run())).toEqual([]);
    expect(judgeRulebookRun(SPEC, run({ employeeName: "Colene Schildt", hasCard: false, payrollDeductAmount: null }))).toEqual([
      "employee",
      "typed",
      "salon",
      "amount",
    ]);
  });

  it("calls a column worse only when it misses a rule the other passed", () => {
    expect(rulebookVerdict(["amount", "plan"], ["plan"])).toBe("better");
    expect(rulebookVerdict(["plan"], ["plan"])).toBe("same");
    expect(rulebookVerdict(["plan"], ["plan", "employee"])).toBe("worse");
    expect(judgeRulebookRuns(SPEC, [run(), run({ formDate: null }), run()], 30)).toEqual(["date"]);
    expect(judgeRulebookRuns(SPEC, [run(), run(), run()], REPLAY_LATENCY_GATE_MS + 1)).toEqual(["latency"]);
  });

  it("writes the per-case table without a failing mark", () => {
    const board = renderRulebookScoreboard({
      oldCommit: "b9ae362fd80e1fc492c4326f80834cf105ef19b8",
      newCommit: "ac804b960940ac642edca27629df9de0f4e51d88",
      runs: 3,
      rows: [
        { id: "n2", oldMisses: ["amount"], newMisses: [], verdict: "better" },
        { id: "s20", oldMisses: [], newMisses: [], verdict: "same" },
      ],
    });
    expect(board).toContain("Each case runs 3 times.");
    expect(board).toContain("20000 ms for the 3 runs together");
    expect(board).toContain("| n2 | amount | pass | better |");
    expect(board).toContain("| s20 | pass | pass | same |");
    const once = renderRulebookScoreboard({
      oldCommit: "b9ae362fd80e1fc492c4326f80834cf105ef19b8",
      newCommit: "ac804b960940ac642edca27629df9de0f4e51d88",
      runs: 1,
      rows: [{ id: "s20", oldMisses: [], newMisses: [], verdict: "same" }],
    });
    expect(once).toContain("Each case runs 1 time.");
    expect(once).toContain("- runs: 1");
    expect(once).toContain("20000 ms for the run");
    expect(board).toContain("Totals: better 1, same 1, worse 0.");
    expect(board).not.toContain("FAIL");
    expect(board).toContain("salon does not gate the card");
  });
});

describe("fix round gate", () => {
  it("accepts a round that fixes a case, breaks none, stays inside 25%, and does not leak", () => {
    expect(latencyRegressed(100, 125)).toBe(false);
    expect(latencyRegressed(100, 126)).toBe(true);
    expect(latencyRegressed(100, 200, 1.25, 250)).toBe(false);
    expect(latencyRegressed(400, 900, 1.25, 250)).toBe(true);
    const decision = judgeFixRound([
      { id: "s11", beforePass: false, afterPass: true, beforeMs: 452, afterMs: 400, beforeMisses: ["employee"], afterMisses: [], leaked: false },
      { id: "s21", beforePass: true, afterPass: true, beforeMs: 398, afterMs: 490, beforeMisses: [], afterMisses: [], leaked: false },
    ]);
    expect(decision.accepted).toBe(true);
    expect(decision.fixed).toEqual(["s11"]);
    expect(decision.broken).toEqual([]);
  });

  it("rejects a break, a slow case, a leak, or a round that fixes nothing", () => {
    const row = { beforeMs: 100, afterMs: 100, beforeMisses: [] as string[], afterMisses: [] as string[], leaked: false };
    expect(judgeFixRound([{ ...row, id: "s21", beforePass: true, afterPass: false, afterMisses: ["salon"] }]).accepted).toBe(false);
    expect(judgeFixRound([{ ...row, id: "s4", beforePass: false, afterPass: true, beforeMs: 400, afterMs: 900 }]).latency).toEqual(["s4"]);
    expect(judgeFixRound([{ ...row, id: "s8", beforePass: false, afterPass: true, leaked: true }]).accepted).toBe(false);
    expect(judgeFixRound([{ ...row, id: "s20", beforePass: true, afterPass: true }]).accepted).toBe(false);
  });
});
