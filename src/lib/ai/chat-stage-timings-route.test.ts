import { afterEach, describe, expect, it, vi } from "vitest";

import { markStage } from "./chat-stage-timings";
import { openChatTrace } from "./chat-trace";
import { pendingRouteStages, runChatTrace, runWithRequestClock } from "./chat-trace-store";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("CHAT_STAGE_TIMINGS_ENABLED: the route's steps before the trace opens (QA, 10 Nov 2026: 1.7 s before trace_open)", () => {
  it("marks made before the trace opens are held for the request, and the trace takes them over at its first mark", async () => {
    vi.stubEnv("CHAT_STAGE_TIMINGS_ENABLED", "true");
    vi.useFakeTimers({ now: 1_000 });
    const draft = openChatTrace({ originalQuery: "q", formInProgress: false });
    await runWithRequestClock(async () => {
      vi.setSystemTime(1_010);
      markStage("route_auth");
      vi.setSystemTime(1_300);
      markStage("route_intake");
      vi.setSystemTime(2_700);
      await runChatTrace(draft, async () => {
        markStage("trace_open");
        vi.setSystemTime(2_900);
        markStage("answer_model");
      });
      expect(pendingRouteStages(), "held marks are handed over, not kept twice").toEqual([]);
    }, 1_000);
    expect(draft.stages).toEqual([
      { name: "route_auth", startMs: 10, ms: 290 },
      { name: "route_intake", startMs: 300, ms: 1_400 },
      { name: "trace_open", startMs: 1_700, ms: 200 },
      { name: "answer_model", startMs: 1_900, ms: -1 },
    ]);
  });

  it("off: nothing is held, nothing is recorded", async () => {
    const draft = openChatTrace({ originalQuery: "q", formInProgress: false });
    await runWithRequestClock(async () => {
      markStage("route_auth");
      expect(pendingRouteStages()).toEqual([]);
      await runChatTrace(draft, async () => markStage("trace_open"));
    });
    expect(draft.stages).toBeUndefined();
  });

  it("two requests at once each keep their own route marks", async () => {
    vi.stubEnv("CHAT_STAGE_TIMINGS_ENABLED", "true");
    const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
    const names: string[][] = [];
    await Promise.all(
      ["first", "second"].map((who) =>
        runWithRequestClock(async () => {
          markStage(`${who}_auth`);
          await tick();
          markStage(`${who}_intake`);
          names.push((pendingRouteStages() ?? []).map((stage) => stage.name));
        }),
      ),
    );
    expect(names.sort()).toEqual([["first_auth", "first_intake"], ["second_auth", "second_intake"]]);
  });

  it("with no request and no trace, a mark does nothing and never throws", () => {
    vi.stubEnv("CHAT_STAGE_TIMINGS_ENABLED", "true");
    expect(() => markStage("route_auth")).not.toThrow();
    expect(pendingRouteStages()).toBeUndefined();
  });
});
