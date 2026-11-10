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

import { markStage } from "./chat-stage-timings";
import { finishChatTrace, openChatTrace } from "./chat-trace";

afterEach(() => {
  vi.unstubAllEnvs();
  inserted.rows = [];
});

async function traceOneTurn(): Promise<Record<string, unknown> | null> {
  const draft = openChatTrace({ originalQuery: "q", formInProgress: false });
  await finishChatTrace(draft, async () => {
    markStage("intent_extraction");
    markStage("answer_model");
  });
  await vi.waitFor(() => expect(inserted.rows).toHaveLength(1));
  return (inserted.rows[0]!.slots as Record<string, unknown> | null) ?? null;
}

describe("CHAT_STAGE_TIMINGS_ENABLED on the written trace row (coding 2's condition)", () => {
  it("off: the row's slots carry no stages", async () => {
    expect((await traceOneTurn())?.stages).toBeUndefined();
  });

  it("on: slots.stages lists each step's name, start and length, every length closed", async () => {
    vi.stubEnv("CHAT_STAGE_TIMINGS_ENABLED", "true");
    const stages = (await traceOneTurn())?.stages as { name: string; startMs: number; ms: number }[];
    expect(stages.map((stage) => stage.name)).toEqual(["intent_extraction", "answer_model"]);
    for (const stage of stages) {
      expect(Object.keys(stage).sort()).toEqual(["ms", "name", "startMs"]);
      expect(stage.ms).toBeGreaterThanOrEqual(0);
    }
  });
});
