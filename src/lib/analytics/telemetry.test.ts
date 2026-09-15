import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { logTurnEvent } from "./telemetry";

/**
 * TURN TELEMETRY — one structured line, and never a question in it.
 *
 * The privacy guarantee here is the same one `activity_events` makes and is
 * made the same way: there is no field for text. These tests pin that the shape
 * stays machine-readable and that the failures are findable at the default log
 * level, because a telemetry event nobody can filter on is a comment.
 */

afterEach(() => vi.restoreAllMocks());

/**
 * A console spy, cleared on every call.
 *
 * `vi.spyOn` on an already-spied method hands back the SAME mock with its
 * calls still on it, so a spy taken inside a loop counts every previous
 * iteration too — which reads as "emitted twice" and is really "asserted
 * twice". Clearing makes each assertion about its own event.
 */
function captured(level: "info" | "warn") {
  const spy = vi.spyOn(console, level).mockImplementation(() => {});
  spy.mockClear();
  return spy;
}

describe("every event is one parseable line", () => {
  it("emits JSON carrying the event name", () => {
    const info = captured("info");
    logTurnEvent("turn.open.succeeded", { turnId: "t-1", surface: "bed_usage", durationMs: 42 });

    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0][0]);
    expect(line.includes("\n")).toBe(false);
    expect(JSON.parse(line)).toMatchObject({
      event: "turn.open.succeeded",
      turnId: "t-1",
      surface: "bed_usage",
      durationMs: 42,
    });
  });

  it("warns on the failures so they surface at the default level", () => {
    /*
     * The whole point of the split: the successes are traffic and the failures
     * are the reason this exists. A missing turn on a successful answer is the
     * defect itself and must never be an info line.
     */
    for (const event of [
      "turn.open.timeout",
      "turn.open.error",
      "turn.close.failed",
      "turn.answer.missing_turn",
      "feedback.host.unrateable",
    ] as const) {
      const warn = captured("warn");
      logTurnEvent(event);
      expect(warn, event).toHaveBeenCalledTimes(1);
    }
  });

  it("keeps the ordinary lifecycle out of the warning stream", () => {
    for (const event of [
      "turn.open.started",
      "turn.open.succeeded",
      "turn.close.succeeded",
      "feedback.host.rateable",
    ] as const) {
      const warn = captured("warn");
      const info = captured("info");
      logTurnEvent(event);
      expect(warn, event).not.toHaveBeenCalled();
      expect(info, event).toHaveBeenCalledTimes(1);
    }
  });
});

describe("it cannot carry a question or an answer", () => {
  it("bounds a driver reason rather than pasting a stack trace", () => {
    const warn = captured("warn");
    logTurnEvent("turn.open.error", { reason: "x".repeat(5000) });

    const parsed = JSON.parse(String(warn.mock.calls[0][0])) as { reason: string };
    expect(parsed.reason.length).toBeLessThanOrEqual(200);
  });

  it("writes only the fields it was given", () => {
    /*
     * A STRUCTURAL CHECK, not a filter. `TurnTelemetry` has no field for text,
     * so the way a question would reach a log line is somebody adding one —
     * and this fails the moment an unexpected key appears.
     */
    const info = captured("info");
    logTurnEvent("turn.open.started", { surface: "main_chat", where: "api/chat" });

    const parsed = JSON.parse(String(info.mock.calls[0][0])) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["event", "surface", "where"]);
  });

  it("declares no field a prompt or an answer could be put in", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/analytics/telemetry.ts"),
      "utf8",
    );
    const contract = source.split("export interface TurnTelemetry")[1]?.split("}")[0] ?? "";
    const code = contract.replace(/\/\*[\s\S]*?\*\//g, " ");

    expect(contract.length).toBeGreaterThan(0);
    for (const forbidden of ["question", "prompt", "answer", "content", "comment"]) {
      expect(code, `TurnTelemetry declares ${forbidden}`).not.toMatch(
        new RegExp(`\\b${forbidden}\\b`),
      );
    }
  });
});
