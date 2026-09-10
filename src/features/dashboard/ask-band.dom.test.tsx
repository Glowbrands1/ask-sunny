// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AskBand } from "./ask-band";
import type { ChatConversation, ChatMessage } from "@/types";
import type { ClientAskRequest } from "@/lib/ai/types";

/**
 * ============================================================================
 * THE OVERVIEW'S ASK BOX HOLDS A CONVERSATION
 * ============================================================================
 *
 * It used to hold exactly one question: the moment an answer landed the
 * composer went read-only and every route onward left the page. That was a
 * deliberate cap and it was lifted by request — "when i type there it only
 * allows me to send 1 message, id like to keep chatting there".
 *
 * So the case that matters is not that a second message can be typed. It is
 * that the second message is part of the SAME conversation and carries the
 * first exchange with it. A follow-up like "what about a second occurrence?"
 * names nothing on its own; sent with an empty history it is a different and
 * worse question than the one the manager asked. The band sent `history: []`
 * when it could only hold one turn, which was correct then and would be a
 * silent regression now — so it is asserted here rather than assumed.
 *
 * The store is stubbed with a REAL reducer rather than spies. Appending to a
 * conversation and reading the thread back out is the mechanism under test, and
 * a stub that records calls without applying them would pass while the thread
 * never grew.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  usePathname: () => "/",
}));

vi.mock("@/lib/session/session-context", () => ({
  useSession: () => ({
    user: { name: "Paulyne Camacho", isSalonAccount: false, title: "Owner", scope: {} },
    role: "owner",
    can: () => true,
    primaryLocationName: "Riverbend Commons",
    managerDisplayName: "Paulyne",
    demoMode: true,
    brand: { knowledgeScopeId: "stc-core" },
  }),
}));

/* ------------------------------------------------------------ the store ---- */

let conversations: ChatConversation[] = [];
let notify: (() => void) | null = null;

function useFakeStore() {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    notify = force;
    return () => {
      notify = null;
    };
  }, [force]);
  return {
    forms: [],
    documents: [{ id: "doc-1" }],
    videos: [],
    conversations,
    addConversation(conversation: ChatConversation) {
      conversations = [conversation, ...conversations];
      notify?.();
    },
    appendConversationMessages(id: string, messages: ChatMessage[]) {
      conversations = conversations.map((entry) =>
        entry.id === id ? { ...entry, messages: [...entry.messages, ...messages] } : entry,
      );
      notify?.();
    },
    updateConversation() {},
  };
}

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: () => useFakeStore(),
}));

/* ------------------------------------------------------------- the provider */

const asks: ClientAskRequest[] = [];

vi.mock("@/lib/ai", () => ({
  getAIProvider: () => ({
    name: "fake",
    connected: true,
    titleForConversation: (first: string) => first.slice(0, 20),
    async ask(request: ClientAskRequest) {
      asks.push(request);
      return {
        content: `Answer ${asks.length}`,
        citations: [],
        coverage: "not_applicable" as const,
        recommendedVideoIds: [],
        followUpSuggestions: asks.length === 1 ? ["And a second occurrence?"] : [],
      };
    },
  }),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  conversations = [];
  asks.length = 0;
});

afterEach(cleanup);

/**
 * Type a question into the band and wait for THIS request to be made.
 *
 * Waits on the count going UP rather than on it being non-zero, so the second
 * call in a test cannot pass on the first call's request.
 */
async function ask(user: ReturnType<typeof userEvent.setup>, question: string) {
  const before = asks.length;
  const box = screen.getByLabelText("Ask Sunny a question");
  await user.click(box);
  await user.type(box, question);
  // By role: the band's own section carries `aria-label="Ask Sunny"` too.
  await user.click(screen.getByRole("button", { name: "Ask Sunny" }));
  await waitFor(() => expect(asks.length).toBe(before + 1));
}

describe("asking twice in the band", () => {
  it("keeps the composer live after an answer instead of locking it", async () => {
    const user = userEvent.setup();
    render(<AskBand />);

    await ask(user, "What does our attendance policy say?");
    await waitFor(() => expect(screen.getByText("Answer 1")).toBeTruthy());

    /*
     * THE CAP, GONE. `readOnly` and a disabled send button were what made this
     * one question only, and the field also used to be forced back to the text
     * that had been asked.
     */
    const box = screen.getByLabelText("Ask Sunny a question") as HTMLTextAreaElement;
    expect(box.readOnly).toBe(false);
    expect(box.value).toBe("");
  });

  it("sends the first exchange as history with the follow-up", async () => {
    const user = userEvent.setup();
    render(<AskBand />);

    await ask(user, "What does our attendance policy say?");
    await waitFor(() => expect(screen.getByText("Answer 1")).toBeTruthy());
    await ask(user, "And a second occurrence?");
    await waitFor(() => expect(asks.length).toBe(2));

    // A first question has nothing behind it.
    expect(asks[0]!.history).toEqual([]);

    /*
     * THE ASSERTION THIS FILE EXISTS FOR. The follow-up carries the question
     * and the answer above it, in order, so "a second occurrence" of WHAT is
     * answerable at all.
     */
    const history = asks[1]!.history ?? [];
    expect(history.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(history[0]!.content).toBe("What does our attendance policy say?");
    expect(history[1]!.content).toBe("Answer 1");
  });

  it("keeps both exchanges in ONE conversation, newest first", async () => {
    const user = userEvent.setup();
    render(<AskBand />);

    await ask(user, "First question");
    await waitFor(() => expect(screen.getByText("Answer 1")).toBeTruthy());
    await ask(user, "Second question");
    await waitFor(() => expect(screen.getByText("Answer 2")).toBeTruthy());

    /*
     * One conversation, four messages. Two conversations would mean the chat
     * page's history rail showed the same exchange split in half, and the
     * hand-off could only adopt one of them.
     */
    expect(conversations.length).toBe(1);
    expect(conversations[0]!.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);

    // Each question is shown above the answer it produced — with the composer
    // now empty, nothing else says what was asked.
    expect(screen.getByText("First question")).toBeTruthy();
    expect(screen.getByText("Second question")).toBeTruthy();
    expect(screen.getAllByText("You asked").length).toBe(2);

    /*
     * NEWEST FIRST, because the composer is at the TOP of this layout. In
     * document order the second exchange precedes the first; chronological
     * order would push each new answer further below the fold.
     */
    const body = document.body.textContent ?? "";
    expect(body.indexOf("Second question")).toBeLessThan(body.indexOf("First question"));
  });

  it("asks a follow-up chip in place rather than navigating away", async () => {
    const user = userEvent.setup();
    render(<AskBand />);

    await ask(user, "What does our attendance policy say?");
    await waitFor(() => expect(screen.getByText("Answer 1")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "And a second occurrence?" }));
    await waitFor(() => expect(asks.length).toBe(2));

    // Same conversation, and the chip's own text is the question that was sent.
    expect(conversations.length).toBe(1);
    expect(asks[1]!.question).toBe("And a second occurrence?");
  });

  it("offers the hand-off once, on the newest exchange", async () => {
    /*
     * The link is still the way to the full thread and the document context —
     * it is just no longer the only way to keep thinking. One of them, not one
     * under every answer.
     */
    const user = userEvent.setup();
    render(<AskBand />);

    await ask(user, "First question");
    await waitFor(() => expect(screen.getByText("Answer 1")).toBeTruthy());
    await ask(user, "Second question");
    await waitFor(() => expect(screen.getByText("Answer 2")).toBeTruthy());

    expect(screen.getAllByText("Continue in Ask Sunny").length).toBe(1);
  });

  it("clears the typed text before it clears the conversation", async () => {
    /*
     * Escape and the X share this. Reversing the order would mean one keystroke
     * wipes an exchange the manager was mid-way through adding to.
     */
    const user = userEvent.setup();
    render(<AskBand />);

    await ask(user, "First question");
    await waitFor(() => expect(screen.getByText("Answer 1")).toBeTruthy());

    const box = screen.getByLabelText("Ask Sunny a question");
    await user.click(box);
    await user.type(box, "half a thought");
    await user.keyboard("{Escape}");

    // The draft is gone; the exchange is not.
    expect((box as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByText("Answer 1")).toBeTruthy();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Answer 1")).toBeNull());

    // And clearing did not delete it from history — that is the whole reason
    // the band writes to the store rather than to local state.
    expect(conversations.length).toBe(1);
    expect(conversations[0]!.messages.length).toBe(2);
  });
});
