import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const persisted = vi.hoisted(() => [] as unknown[]);
vi.mock("./chat-trace", () => ({ persistSpendRow: async (row: unknown) => void persisted.push(row) }));

const { meteredClient, noteSpendUser, takeSpend } = await import("./spend-meter");
const { withSpendMeter } = await import("./spend-meter-run");
const { __setAnthropicClient, getAnthropicClient } = await import("./anthropic");

/*
 * SPEND_GUARD_ALL_CALLS_ENABLED (Pau and QA, 28 Oct 2026): the client records
 * every call's usage into the request's meter — a finished message and a
 * streamed one alike — and the meter writes what no trace row took.
 */
const FLAG = "SPEND_GUARD_ALL_CALLS_ENABLED";

function fakeClient() {
  return {
    messages: {
      create: async (params: { model: string; stream?: boolean }) =>
        params.stream
          ? (async function* () {
              yield { type: "message_start", message: { model: params.model, usage: { input_tokens: 900, output_tokens: 1, cache_read_input_tokens: 50 } } };
              yield { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 120 } };
            })()
          : { model: params.model, content: [], usage: { input_tokens: 300, output_tokens: 30 } },
    },
  };
}

afterEach(() => {
  delete process.env[FLAG];
  persisted.length = 0;
  __setAnthropicClient(null);
});

describe("off", () => {
  it("the client is the client itself, the work runs as it was, and nothing is written", async () => {
    const client = fakeClient();
    expect(meteredClient(client)).toBe(client);
    __setAnthropicClient(client as never);
    expect(getAnthropicClient()).toBe(client);
    const value = await withSpendMeter("forms_draft", async () => {
      await client.messages.create({ model: "claude-opus-5" });
      return 7;
    });
    expect(value).toBe(7);
    expect(persisted).toEqual([]);
  });
});

describe("on", () => {
  it("a finished message and a streamed one are both recorded, with the user, as one spend row", async () => {
    process.env[FLAG] = "true";
    __setAnthropicClient(fakeClient() as never);
    await withSpendMeter("sales_totals", async () => {
      noteSpendUser("manager-7");
      const client = getAnthropicClient() as unknown as ReturnType<typeof fakeClient>;
      await client.messages.create({ model: "claude-haiku-4-5" });
      const stream = (await client.messages.create({ model: "claude-opus-5", stream: true })) as AsyncIterable<unknown>;
      for await (const event of stream) void event;
    });
    expect(persisted).toEqual([
      {
        source: "sales_totals",
        userId: "manager-7",
        calls: [
          { model: "claude-haiku-4-5", inputTokens: 300, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0 },
          { model: "claude-opus-5", inputTokens: 900, outputTokens: 120, cacheReadTokens: 50, cacheWriteTokens: 0 },
        ],
      },
    ]);
  });

  it("calls a trace row already took are not written again", async () => {
    process.env[FLAG] = "true";
    const client = meteredClient(fakeClient());
    await withSpendMeter("chat", async () => {
      await client.messages.create({ model: "claude-opus-5" });
      expect(takeSpend()).toHaveLength(1);
    });
    expect(persisted).toEqual([]);
  });

  it("a metered route called inside another (the chat redraft calls the draft route) joins the outer meter", async () => {
    process.env[FLAG] = "true";
    const client = meteredClient(fakeClient());
    await withSpendMeter("chat", async () => {
      await withSpendMeter("forms_draft", async () => {
        await client.messages.create({ model: "claude-opus-5" });
      });
      expect(persisted).toEqual([]);
    });
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ source: "chat" });
  });

  it("a failed request still writes the calls it made, and the error is unchanged", async () => {
    process.env[FLAG] = "true";
    const client = meteredClient(fakeClient());
    await expect(
      withSpendMeter("form_ingest", async () => {
        await client.messages.create({ model: "claude-opus-5" });
        throw new Error("refine failed");
      }),
    ).rejects.toThrow("refine failed");
    expect(persisted).toHaveLength(1);
  });

  it("outside any meter a call is not recorded anywhere", async () => {
    process.env[FLAG] = "true";
    const client = meteredClient(fakeClient());
    await client.messages.create({ model: "claude-opus-5" });
    expect(takeSpend()).toEqual([]);
    expect(persisted).toEqual([]);
  });
});
