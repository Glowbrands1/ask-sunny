import { describe, expect, it } from "vitest";

import { meetingContentFromHub } from "./ai-read.server";
import type { HubAnswer } from "./partner/client.server";

/*
 * Pau, 28 Nov 2026 ("depends on the access of the user ok? admin gets all"): the AI's meeting reader makes the meeting
 * pages' own partner API calls, signed for the asker's email, so the Leadership Hub decides exactly as for the pages.
 */
function hub(answers: Record<string, HubAnswer>) {
  const calls: { op: string; email: string; args: Record<string, unknown> }[] = [];
  const call = async (op: string, email: string, args: Record<string, unknown> = {}) => {
    calls.push({ op, email, args });
    return answers[op] ?? { status: 500, body: {} };
  };
  return { call: call as never, calls };
}

describe("meetingContentFromHub", () => {
  it("now: the document, then its recaps, both asked as this person", async () => {
    const { call, calls } = hub({
      load: { status: 200, body: { loaded: { version: 7, updatedAt: "2026-11-26T15:00:00Z", doc: { todos: [] } } } },
      recaps: { status: 200, body: { recaps: [{ id: "r1" }] } },
    });
    const read = await meetingContentFromHub("invented.dm@example.com", "stc-dm", "now", null, call);
    expect(read).toEqual({ state: "ok", part: "now", version: 7, updatedAt: "2026-11-26T15:00:00Z", doc: { todos: [] }, recaps: [{ id: "r1" }] });
    expect(calls.map((c) => [c.op, c.email, c.args])).toEqual([
      ["load", "invented.dm@example.com", { key: "stc-dm" }],
      ["recaps", "invented.dm@example.com", { key: "stc-dm" }],
    ]);
  });

  it("the Hub's 404 (not an attendee, not an admin) is forbidden, and nothing more is asked", async () => {
    const { call, calls } = hub({ load: { status: 404, body: {} } });
    expect(await meetingContentFromHub("invented.dm@example.com", "leadership", "now", null, call)).toEqual({ state: "forbidden" });
    expect(calls.map((c) => c.op)).toEqual(["load"]);
  });

  it("not configured is off; any other failure is failed, never an empty meeting", async () => {
    expect(await meetingContentFromHub("a@example.com", "stc-dm", "now", null, hub({ load: { status: 0, body: { error: "not_configured" } } }).call)).toEqual({ state: "off" });
    expect(await meetingContentFromHub("a@example.com", "stc-dm", "now", null, hub({ load: { status: 500, body: {} } }).call)).toEqual({ state: "failed" });
    const recapsDown = hub({ load: { status: 200, body: { loaded: { version: 1, updatedAt: null, doc: {} } } }, recaps: { status: 0, body: { error: "unavailable" } } });
    expect(await meetingContentFromHub("a@example.com", "stc-dm", "now", null, recapsDown.call)).toEqual({ state: "failed" });
  });

  it("an unknown meeting key is never sent to the Hub", async () => {
    const { call, calls } = hub({});
    expect(await meetingContentFromHub("a@example.com", "not-a-meeting", "now", null, call)).toEqual({ state: "forbidden" });
    expect(calls).toEqual([]);
  });

  it("history lists the saved versions; version reads one", async () => {
    const rows = hub({ "history-list": { status: 200, body: { rows: [{ version: 3, savedAt: "2026-11-20T15:00:00Z", savedByName: "Pat Sample", isCurrent: true, isImport: false, bytes: 10 }, { bad: true }] } } });
    expect(await meetingContentFromHub("a@example.com", "stc-dm", "history", null, rows.call)).toEqual({ state: "ok", part: "history", rows: [{ version: 3, savedAt: "2026-11-20T15:00:00Z", savedByName: "Pat Sample", isCurrent: true, isImport: false }] });
    expect(rows.calls[0]!.args).toEqual({ key: "stc-dm", limit: 15 });
    const one = hub({ "history-get": { status: 200, body: { doc: { todos: [] } } } });
    expect(await meetingContentFromHub("a@example.com", "stc-dm", "version", 3, one.call)).toEqual({ state: "ok", part: "version", version: 3, doc: { todos: [] } });
    expect(one.calls[0]!.args).toEqual({ key: "stc-dm", version: 3 });
  });
});
