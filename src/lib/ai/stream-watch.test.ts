import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isAiTimeLimitError, withStreamTimeLimit, type StreamWatch } from "./time-limit";

/*
 * QA's code audit on main d7960a5f (items 14a and 14b, 20 Nov 2026): the stream watch covers each MODEL call, never a
 * tool's work or the code's checks between calls. A tool that runs past the 30 s gap (the form's reviser chain, a batch
 * of drafts) is not a timeout, and a second model call (a hand-back, the token-limit retry) gets its own 45 s for its
 * first token. Only the total limit holds over the whole turn.
 */
const LIMITS = { firstTokenMs: 45_000, gapMs: 30_000, totalMs: 100_000 };
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs `script` under the watch with fake timers; what it settled to: "done", or the limit that ran out. */
async function run(script: (watch: StreamWatch) => Promise<void>): Promise<string> {
  const settled = withStreamTimeLimit("test", LIMITS, async (_options, watch) => {
    await script(watch);
    return "done";
  }).catch((error: unknown) => (isAiTimeLimitError(error) ? `timeout:${error.kind}` : `error:${String(error)}`));
  await vi.runAllTimersAsync();
  return settled;
}

describe("the stream watch covers each model call, not the turn (QA audit 14a/14b)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("14b: a tool that runs 40 s after its tool call (past the 30 s gap) is not a timeout", async () => {
    const result = await run(async (watch) => {
      watch.firstToken();
      watch.toolStarted();
      await wait(40_000);
      watch.toolFinished();
      // The next step's first token, well inside its own 45 s.
      await wait(10_000);
      watch.firstToken();
    });
    expect(result).toBe("done");
  });

  it("14b: a stream chunk while the tool runs does not re-arm the gap over the tool", async () => {
    const result = await run(async (watch) => {
      watch.toolStarted();
      watch.firstToken();
      watch.chunk();
      await wait(40_000);
      watch.toolFinished();
      watch.firstToken();
    });
    expect(result).toBe("done");
  });

  it("14b: after the tool, the next model call still has a first-token limit", async () => {
    const result = await run(async (watch) => {
      watch.firstToken();
      watch.toolStarted();
      await wait(40_000);
      watch.toolFinished();
      await wait(50_000);
    });
    expect(result).toBe("timeout:first_token");
  });

  it("14a: a hand-back after the first reply gets its own 45 s; the checks between calls are not counted", async () => {
    const result = await run(async (watch) => {
      watch.firstToken();
      // The first reply's step finished; the code checks the reply (idle), then hands back.
      watch.attempt();
      watch.idle();
      await wait(20_000);
      watch.attempt();
      await wait(30_000);
      watch.firstToken();
      // The hand-back's own tool call, then its reply step.
      watch.attempt();
      await wait(30_000);
      watch.firstToken();
    });
    expect(result).toBe("done");
  });

  it("the total limit still holds over a tool that never finishes", async () => {
    const result = await run(async (watch) => {
      watch.toolStarted();
      await wait(200_000);
    });
    expect(result).toBe("timeout:total");
  });
});

describe("a tool that finishes after the call settled arms nothing", () => {
  it("leaves no timer behind", async () => {
    vi.useFakeTimers();
    let late: StreamWatch | null = null;
    await withStreamTimeLimit("test", LIMITS, async (_options, watch) => {
      late = watch;
      watch.toolStarted();
      return "done";
    });
    // Compared with the count before, so a timer anything else left behind never decides this.
    const before = vi.getTimerCount();
    late!.toolFinished();
    expect(vi.getTimerCount()).toBe(before);
    vi.useRealTimers();
  });
});
