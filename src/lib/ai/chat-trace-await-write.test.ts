import { afterEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], release: null as null | (() => void) }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      // The insert waits until the test lets it finish: the row is only "in the table" after release().
      insert: (row: Record<string, unknown>) =>
        new Promise<{ error: null }>((resolve) => {
          store.release = () => {
            store.rows.push(row);
            resolve({ error: null });
          };
        }),
    }),
  }),
}));

import { finishChatTrace, openChatTrace } from "./chat-trace";

afterEach(() => {
  store.rows = [];
  store.release = null;
});

/*
 * QA (16 Nov 2026, keep-as-typed on production): the agent loop's next turn reads this turn's records from its trace row,
 * so with awaitWrite the reply returns only after the row is written (a quick next message never misses it).
 */
describe("finishChatTrace awaitWrite", () => {
  it("returns only after the trace row is written", async () => {
    const draft = openChatTrace({ originalQuery: "q", formInProgress: false });
    let returned = false;
    const done = finishChatTrace(draft, async () => "reply", { awaitWrite: true }).then((value) => {
      returned = true;
      return value;
    });
    await vi.waitFor(() => expect(store.release).not.toBeNull());
    expect(returned, "the reply returned before its trace row was written").toBe(false);
    store.release!();
    await expect(done).resolves.toBe("reply");
    expect(store.rows).toHaveLength(1);
  });

  it("without it, the reply does not wait (today's other paths)", async () => {
    const draft = openChatTrace({ originalQuery: "q", formInProgress: false });
    await expect(finishChatTrace(draft, async () => "reply")).resolves.toBe("reply");
    expect(store.rows).toHaveLength(0);
    store.release?.();
  });
});
