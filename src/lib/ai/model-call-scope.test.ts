import { describe, expect, it } from "vitest";

import { countModelCalls, countedClient, inModelCallScope, noteModelCall } from "./model-call-scope";

/** Agent loop PR 6 item 3: the model calls a loop tool makes itself (the reviser's) are counted; nothing outside a tool. */
describe("model-call-scope", () => {
  it("counts the calls made inside the scope, nested awaits included, and only those", async () => {
    noteModelCall(); // outside any scope: nothing to count, no error
    const { value, calls } = await countModelCalls(async () => {
      noteModelCall();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
      noteModelCall();
      return "done";
    });
    expect(value).toBe("done");
    expect(calls).toBe(2);
  });

  it("two scopes running at once count apart", async () => {
    const one = countModelCalls(async () => {
      noteModelCall();
      await new Promise((resolve) => setTimeout(resolve, 2));
      noteModelCall();
    });
    const two = countModelCalls(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      noteModelCall();
    });
    expect((await one).calls).toBe(2);
    expect((await two).calls).toBe(1);
  });

  it("countedClient notes messages.create and messages.stream and returns exactly what the client returns", async () => {
    const sent: unknown[] = [];
    const client = {
      other: 7,
      messages: {
        create: (params: unknown) => {
          sent.push(params);
          return { id: "msg-1" };
        },
        stream: (params: unknown) => {
          sent.push(params);
          return { on: () => undefined };
        },
      },
    };
    const counted = countedClient(client as never) as typeof client;
    const { value, calls } = await countModelCalls(async () => [counted.messages.create({ a: 1 }), counted.messages.stream({ b: 2 })]);
    expect(calls).toBe(2);
    expect(value[0]).toEqual({ id: "msg-1" });
    expect(sent).toEqual([{ a: 1 }, { b: 2 }]);
    expect(counted.other).toBe(7);
    // Outside a scope the client works as before.
    expect(counted.messages.create({ c: 3 })).toEqual({ id: "msg-1" });
  });

  it("inModelCallScope is true only inside countModelCalls", async () => {
    expect(inModelCallScope()).toBe(false);
    const { value } = await countModelCalls(async () => inModelCallScope());
    expect(value).toBe(true);
    expect(inModelCallScope()).toBe(false);
  });

  it("getAnthropicClient: the same client object outside a loop tool; counted inside one", async () => {
    const { __setAnthropicClient, getAnthropicClient } = await import("./anthropic");
    const client = { messages: { create: async () => ({ id: "msg-1" }) } };
    __setAnthropicClient(client as never);
    try {
      expect(getAnthropicClient(), "today's path got a different client").toBe(client);
      const { calls } = await countModelCalls(async () => getAnthropicClient().messages.create({} as never));
      expect(calls).toBe(1);
    } finally {
      __setAnthropicClient(null);
    }
  });
});
