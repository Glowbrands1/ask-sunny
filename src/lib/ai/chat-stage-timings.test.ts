import { afterEach, describe, expect, it, vi } from "vitest";

import { closeStages, markStage } from "./chat-stage-timings";
import { openChatTrace } from "./chat-trace";
import { runChatTrace, runWithRequestClock } from "./chat-trace-store";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("CHAT_STAGE_TIMINGS_ENABLED (QA, 9 Nov 2026): each awaited step's name and length, nothing else", () => {
  it("marks each step from the request's receipt; a step lasts until the next mark", async () => {
    vi.stubEnv("CHAT_STAGE_TIMINGS_ENABLED", "true");
    vi.useFakeTimers({ now: 1_000 });
    const draft = openChatTrace({ originalQuery: "q", formInProgress: false });
    await runWithRequestClock(
      () =>
        runChatTrace(draft, async () => {
          vi.setSystemTime(1_400);
          markStage("intent_extraction");
          vi.setSystemTime(3_400);
          markStage("query_rewrite");
          vi.setSystemTime(4_900);
          markStage("answer_model");
        }),
      1_000,
    );
    expect(draft.stages).toEqual([
      { name: "intent_extraction", startMs: 400, ms: 2_000 },
      { name: "query_rewrite", startMs: 2_400, ms: 1_500 },
      { name: "answer_model", startMs: 3_900, ms: -1 },
    ]);
    vi.setSystemTime(15_000);
    expect(closeStages(draft.stages, draft.stagesFrom!)?.at(-1)).toEqual({ name: "answer_model", startMs: 3_900, ms: 10_100 });
  });

  it("off: nothing is recorded", async () => {
    const draft = openChatTrace({ originalQuery: "q", formInProgress: false });
    await runChatTrace(draft, async () => markStage("intent_extraction"));
    expect(draft.stages).toBeUndefined();
  });

  it("with no trace open, a mark does nothing and never throws", () => {
    vi.stubEnv("CHAT_STAGE_TIMINGS_ENABLED", "true");
    expect(() => markStage("intent_extraction")).not.toThrow();
  });
});

describe("CHAT_STAGE_TIMINGS_ENABLED: two turns at once on one instance (coding 2's condition)", () => {
  it("each turn's marks go on its own trace", async () => {
    vi.stubEnv("CHAT_STAGE_TIMINGS_ENABLED", "true");
    const first = openChatTrace({ originalQuery: "first", formInProgress: false });
    const second = openChatTrace({ originalQuery: "second", formInProgress: false });
    const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
    await Promise.all([
      runChatTrace(first, async () => {
        markStage("intent_extraction");
        await tick();
        markStage("query_rewrite");
        await tick();
        markStage("answer_model");
      }),
      runChatTrace(second, async () => {
        markStage("form_proposal");
        await tick();
        markStage("form_understand");
      }),
    ]);
    expect(first.stages?.map((stage) => stage.name)).toEqual(["intent_extraction", "query_rewrite", "answer_model"]);
    expect(second.stages?.map((stage) => stage.name)).toEqual(["form_proposal", "form_understand"]);
  });
});
