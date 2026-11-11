import { describe, expect, it } from "vitest";

import { held, sameTurn, startedFor } from "./held-promise";

describe("held (CHAT_PARALLEL_LOADS / CHAT_PARALLEL_REWRITE)", () => {
  it("a rejection still reaches the later await", async () => {
    const started = held(Promise.reject(new Error("load failed")));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(started).rejects.toThrow("load failed");
  });

  it("a value comes back unchanged", async () => {
    await expect(held(Promise.resolve("block"))).resolves.toBe("block");
  });
});

describe("sameTurn (CHAT_PARALLEL_REWRITE): the early normalizer is used only for the turn it read", () => {
  const turn = { question: "q", history: [{ role: "user", content: "earlier" }] };
  it("the same question and turns", () => {
    expect(sameTurn(turn, { question: "q", history: [{ role: "user", content: "earlier" }] })).toBe(true);
  });
  it("extraction changed the question", () => {
    expect(sameTurn(turn, { ...turn, question: "The employee is …\nq" })).toBe(false);
  });
  it("extraction changed the history", () => {
    expect(sameTurn(turn, { ...turn, history: [] })).toBe(false);
  });
});

describe("startedFor (CHAT_PARALLEL_REWRITE): QA's condition, the fallback when extraction changed the turn", () => {
  const read = (calls: string[]) => async (turn: { question: string; history: { role: string; content: string }[] }) => {
    calls.push(turn.question);
    return `read:${turn.question}:${turn.history.length}`;
  };
  const asked = { question: "q", history: [{ role: "user", content: "earlier" }] };

  it("the same turn: the early read, and no second call", async () => {
    const calls: string[] = [];
    const early = startedFor(asked, read(calls));
    expect(early.reruns({ ...asked })).toBe(false);
    await expect(early.take({ ...asked })).resolves.toBe("read:q:1");
    expect(calls).toEqual(["q"]);
  });

  it("extraction changed the question: read again from the new turn, the same as with the flag off", async () => {
    const changed = { ...asked, question: "The employee is Marnie.\nq" };
    const off: string[] = [];
    const offResult = await read(off)(changed);
    const calls: string[] = [];
    const early = startedFor(asked, read(calls));
    expect(early.reruns(changed)).toBe(true);
    await expect(early.take(changed)).resolves.toBe(offResult);
    expect(calls).toEqual(["q", changed.question]);
  });

  it("extraction changed the history: read again", async () => {
    const calls: string[] = [];
    const early = startedFor(asked, read(calls));
    await expect(early.take({ ...asked, history: [] })).resolves.toBe("read:q:0");
    expect(calls).toEqual(["q", "q"]);
  });

  it("an early read that fails, never taken (a turn that returned), raises no unhandled rejection", async () => {
    startedFor(asked, async () => {
      throw new Error("normalizer down");
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
});
