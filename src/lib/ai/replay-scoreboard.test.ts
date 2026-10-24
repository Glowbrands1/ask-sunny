import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  REPLAY_LATENCY_GATE_MS,
  judgeReplayCard,
  latencyOverGate,
  renderScoreboard,
  type ReplayCardCriteria,
  type ReplayRound,
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
    const promptHash = createHash("sha256").update(readFileSync("src/lib/ai/prompts.ts")).digest("hex");
    expect(board).toContain(replaySetHash);
    expect(board).toContain(promptHash);
    expect(board).toContain("| Case | Card criteria | Flags off | Flags on |");
    expect(board).not.toContain("FAIL");
  });
});
