import { afterEach, describe, expect, it, vi } from "vitest";

import { ClaudeProvider } from "./claude-provider";
import type { ClientAskRequest } from "./types";

/*
 * SAME_FORM_COPY_NEW_PERSON_ENABLED: the browser sends the copy an answer
 * offered with the next turn only (names invented).
 */
const ASKED = "Who is the new Coaching Form for?";

function request(question: string, history: { role: "user" | "assistant"; content: string }[]): ClientAskRequest {
  return {
    question,
    mode: "standard",
    conversationId: "conv-1",
    history: history.map((turn, index) => ({ id: `m${index}`, createdAt: "", ...turn })),
    context: { userName: "Manager", locationName: "here" },
  } as unknown as ClientAskRequest;
}

function answering(...answers: Record<string, unknown>[]) {
  const sent: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(answers.shift()), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  return sent;
}

afterEach(() => vi.unstubAllGlobals());

describe("ClaudeProvider carries an offered copy to the next turn only", () => {
  const SAME = "can you create the same draft that we did with Liora Pellow by changing the name and position?";

  it("the name right after the ask carries it; the turn after that does not", async () => {
    const sent = answering(
      { content: ASKED, citations: [], pendingCopy: { fromInstanceId: "f-liora" } },
      { content: "card", citations: [] },
      { content: "ok", citations: [] },
    );
    const provider = new ClaudeProvider();
    await provider.ask(request(SAME, []));
    await provider.ask(request("Teodric Sabrin", [{ role: "user", content: SAME }, { role: "assistant", content: ASKED }]));
    await provider.ask(request("thanks", [{ role: "user", content: SAME }, { role: "assistant", content: ASKED }, { role: "user", content: "Teodric Sabrin" }, { role: "assistant", content: "card" }]));
    expect(sent[0]!.pendingCopyFromInstanceId).toBeUndefined();
    expect(sent[1]!.pendingCopyFromInstanceId).toBe("f-liora");
    expect(sent[2]!.pendingCopyFromInstanceId).toBeUndefined();
  });

  it("not when the thread's last answer is no longer the ask", async () => {
    const sent = answering({ content: ASKED, citations: [], pendingCopy: { fromInstanceId: "f-liora" } }, { content: "x", citations: [] });
    const provider = new ClaudeProvider();
    await provider.ask(request(SAME, []));
    await provider.ask(request("Teodric Sabrin", [{ role: "user", content: SAME }, { role: "assistant", content: "something else" }]));
    expect(sent[1]!.pendingCopyFromInstanceId).toBeUndefined();
  });
});
