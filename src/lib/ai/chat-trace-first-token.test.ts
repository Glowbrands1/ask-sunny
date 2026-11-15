import { afterEach, describe, expect, it, vi } from "vitest";

const inserted = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        inserted.rows.push(row);
        return { error: null };
      },
    }),
  }),
}));

import { finishChatTrace, openChatTrace } from "./chat-trace";
import { chatTraceDraft } from "./chat-trace-store";

afterEach(() => {
  inserted.rows = [];
});

/* Batch J10 (the J6 speed report: first_token_ms was null on every agent-loop trace): the loop's first token is written. */
describe("first_token_ms on a turn with no model-call snapshot (the agent loop)", () => {
  it("the draft's first token is the row's first_token_ms", async () => {
    const draft = openChatTrace({ originalQuery: "q", formInProgress: false });
    await finishChatTrace(draft, async () => {
      chatTraceDraft()!.firstTokenMs = 1234;
    });
    await vi.waitFor(() => expect(inserted.rows).toHaveLength(1));
    expect(inserted.rows[0]!.first_token_ms).toBe(1234);
  });

  it("a turn that set none still writes null", async () => {
    const draft = openChatTrace({ originalQuery: "q", formInProgress: false });
    await finishChatTrace(draft, async () => undefined);
    await vi.waitFor(() => expect(inserted.rows).toHaveLength(1));
    expect(inserted.rows[0]!.first_token_ms).toBeNull();
  });
});
