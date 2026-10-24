import { beforeEach, describe, expect, it, vi } from "vitest";

import { historyForRemap, keepThisConversation, savedSlotsFromTrace } from "./form-remap-scope";

const tables = vi.hoisted(() => ({
  conversations: [] as { id: string; user_id: string; client_conversation_id: string }[],
  messages: [] as {
    user_id: string;
    conversation_id: string;
    client_message_id: string;
    role: string;
    content: string;
    position: number;
  }[],
  traces: [] as { user_id: string; conversation_id: string; slots: unknown }[],
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      const filters: Record<string, string> = {};
      let ids: string[] = [];
      const rows = () => {
        if (table === "chat_conversations") {
          return tables.conversations.filter(
            (row) => row.user_id === filters.user_id && row.client_conversation_id === filters.client_conversation_id,
          );
        }
        if (table === "chat_messages") {
          return tables.messages.filter((row) => {
            if (filters.user_id && row.user_id !== filters.user_id) return false;
            if (filters.conversation_id && row.conversation_id !== filters.conversation_id) return false;
            if (ids.length > 0 && !ids.includes(row.client_message_id)) return false;
            return true;
          });
        }
        return tables.traces.filter(
          (row) => row.user_id === filters.user_id && row.conversation_id === filters.conversation_id,
        );
      };
      const api = {
        select() {
          return api;
        },
        eq(column: string, value: string) {
          filters[column] = value;
          return api;
        },
        is() {
          return api;
        },
        in(_column: string, values: string[]) {
          ids = values;
          return api;
        },
        order() {
          return api;
        },
        limit() {
          return api;
        },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then(resolve: (value: unknown) => void) {
          resolve({ data: rows(), error: null });
        },
      };
      return api;
    },
  }),
}));

beforeEach(() => {
  tables.conversations.length = 0;
  tables.messages.length = 0;
  tables.traces.length = 0;
});

describe("conversation scope", () => {
  it("drops a turn whose id belongs to another conversation", () => {
    const kept = keepThisConversation(
      [
        { id: "msg-kearney", role: "user", content: "at Kearney" },
        { id: "msg-own", role: "user", content: "10/11" },
      ],
      new Set(["msg-kearney"]),
    );
    expect(kept.map((turn) => turn.content)).toEqual(["10/11"]);
  });

  it("loads slots and turns for this conversation id only", async () => {
    tables.conversations.push({ id: "uuid-own", user_id: "user-1", client_conversation_id: "conv_mvmj8a26gtq901w" });
    tables.messages.push(
      {
        user_id: "user-1",
        conversation_id: "uuid-other",
        client_message_id: "msg-kearney",
        role: "user",
        content: "corrective action at Kearney",
        position: 0,
      },
      {
        user_id: "user-1",
        conversation_id: "uuid-other",
        client_message_id: "msg-lawrence",
        role: "user",
        content: "change salon to Lawrence",
        position: 1,
      },
      {
        user_id: "user-1",
        conversation_id: "uuid-own",
        client_message_id: "msg-own",
        role: "user",
        content: "10/11",
        position: 0,
      },
    );
    tables.traces.push({
      user_id: "user-1",
      conversation_id: "conv_mvmj8a26gtq901w",
      slots: { incidentDateIso: "2026-10-11", store: "NE Kearney" },
    });

    const scoped = await historyForRemap({
      userId: "user-1",
      conversationId: "conv_mvmj8a26gtq901w",
      history: [
        { id: "msg-kearney", role: "user", content: "corrective action at Kearney" },
        { id: "msg-lawrence", role: "user", content: "change salon to Lawrence" },
        { id: "msg-own", role: "user", content: "10/11" },
      ],
    });

    expect(scoped.history.map((turn) => turn.content)).toEqual(["10/11"]);
    expect(scoped.saved?.incidentDateIso).toBe("2026-10-11");
    expect(savedSlotsFromTrace({ incidentTime: "10-20" })?.incidentTime).toBe("10-20");
  });
});
