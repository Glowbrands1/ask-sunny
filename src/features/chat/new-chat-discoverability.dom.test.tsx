// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { Providers } from "@/app/providers";
import { TooltipProvider } from "@/components/ui/overlays";
import { ChatScreen } from "./chat-screen";
import { ConversationList } from "./conversation-list";
import type { ChatConversation } from "@/types";

/**
 * "I EVENTUALLY FOUND THE NEW CHAT OPTION UNDER HISTORY."
 *
 * That report was accurate. `New chat` lives at the top of the conversation
 * rail, and the rail is `hidden ... xl:block` — so on every laptop narrower
 * than 1280px the button was not merely hard to see, it was `display:none`
 * and off the page entirely. The only remaining route to a fresh thread was
 * the History drawer, which is exactly where nobody expects to find "start
 * something new".
 *
 * These tests pin the two halves of the fix, because either alone leaves a
 * width where a manager has to open History to escape it:
 *
 *   the rail puts `New chat` above the history rather than inside it, and
 *   the chat header carries the same action wherever the rail is hidden.
 *
 * And they pin what must NOT change: the action reuses one handler, creates
 * nothing until a question is asked, and leaves stored conversations intact
 * and reselectable.
 */

/** jsdom lacks the layout and pointer APIs Radix's primitives reach for. */
beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  for (const name of [
    "hasPointerCapture",
    "setPointerCapture",
    "releasePointerCapture",
  ] as const) {
    if (!(name in Element.prototype)) {
      Object.defineProperty(Element.prototype, name, {
        value: () => false,
        writable: true,
      });
    }
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

/**
 * No Next router in jsdom. ChatScreen reads `?q=` for the dashboard prompt
 * chips, and a rendered answer's form hand-off pushes a route.
 */
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------ the rail -- */

const CONVERSATIONS: ChatConversation[] = [
  {
    id: "conv-a",
    title: "Invented thread A",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    attachedDocumentIds: [],
    messages: [],
  },
];

function renderRail(overrides: Partial<React.ComponentProps<typeof ConversationList>> = {}) {
  const onNew = vi.fn();
  render(
    <TooltipProvider>
      <ConversationList
        conversations={CONVERSATIONS}
        activeId={null}
        onSelect={vi.fn()}
        onNew={onNew}
        onDelete={vi.fn()}
        onClearAll={vi.fn()}
        {...overrides}
      />
    </TooltipProvider>,
  );
  return { onNew };
}

describe("conversation rail", () => {
  it("puts New chat ahead of the conversations, so starting reads before returning", () => {
    /*
     * THE VISIBLE "HISTORY" HEADING IS GONE, BY DESIGN, and this assertion was
     * rewritten around that rather than weakened.
     *
     * The Marquee Chat artifact's history panel is labelled by its own bucket
     * rows — Today, Yesterday, Previous 7 days — so a heading above them was a
     * fourth label saying what the three already said. The panel keeps an
     * accessible name for screen readers (`role="region"`), which is checked
     * below.
     *
     * The ORDER is the property this test exists for and it is unchanged: the
     * action that starts a thread comes before the list of old ones, because
     * the reported defect was a manager who could only find "New chat" by
     * opening History first.
     */
    renderRail();

    const newChat = screen.getByRole("button", { name: /new chat/i });
    const bucket = screen.getByText("Today");
    const conversation = screen.getByRole("button", { name: /^Invented thread A/i });

    // Node.DOCUMENT_POSITION_FOLLOWING === 4: the argument comes after `this`.
    expect(newChat.compareDocumentPosition(bucket) & 4).toBeTruthy();
    expect(bucket.compareDocumentPosition(conversation) & 4).toBeTruthy();
  });

  it("still names the history region for a screen reader", () => {
    // What the removed heading was doing for assistive technology.
    renderRail();
    expect(screen.getByRole("region", { name: /chat history/i })).toBeTruthy();
  });

  it("labels the action in text, not by icon alone", () => {
    renderRail();
    expect(
      screen.getByRole("button", { name: /new chat/i }).textContent,
    ).toMatch(/new chat/i);
  });

  it("calls the handler it was given rather than resetting anything itself", async () => {
    const user = userEvent.setup();
    const { onNew } = renderRail();

    await user.click(screen.getByRole("button", { name: /new chat/i }));
    expect(onNew).toHaveBeenCalledTimes(1);

    // Nothing was removed from the history by starting a new chat.
    expect(screen.getByRole("button", { name: /^Invented thread A/i })).toBeTruthy();
  });

  it("drops its own labelling where the drawer already has a title", () => {
    renderRail({ showHeading: false });
    expect(screen.queryByRole("heading", { name: /^history$/i })).toBeNull();
    // And no second "Chat history" name competing with the drawer's own.
    expect(screen.queryByRole("region", { name: /chat history/i })).toBeNull();
    // The action itself is never dropped.
    expect(screen.getByRole("button", { name: /new chat/i })).toBeTruthy();
  });
});

/* ----------------------------------------------------------- the screen -- */

function renderChat() {
  // The app's own provider composition, so the screen under test is wired the
  // way it is in `/chat` rather than to a hand-rolled approximation.
  return render(
    <Providers>
      <ChatScreen />
    </Providers>,
  );
}

/** The persistent header, identified by the control that has always been in it. */
function chatHeader(): HTMLElement {
  const history = screen.getByRole("button", { name: /^history$/i });
  const header = history.closest("div");
  if (!header) throw new Error("chat header not found");
  return header as HTMLElement;
}

describe("Ask Sunny chat header", () => {
  it("offers New chat without the History drawer being opened first", () => {
    renderChat();

    // The drawer is closed: its own titled header is not mounted.
    expect(screen.queryByText(/^chat history$/i)).toBeNull();

    const header = chatHeader();
    expect(within(header).getByRole("button", { name: /new chat/i })).toBeTruthy();
  });

  it("puts New chat before History, so starting reads ahead of returning", () => {
    renderChat();

    const header = chatHeader();
    const newChat = within(header).getByRole("button", { name: /new chat/i });
    const history = within(header).getByRole("button", { name: /^history$/i });

    expect(newChat.compareDocumentPosition(history) & 4).toBeTruthy();
  });

  it("opens a genuinely fresh thread and keeps the previous one in history", async () => {
    const user = userEvent.setup();
    renderChat();

    const seeded = screen.getByRole("button", { name: /^Daily Stats/i });
    await user.click(seeded);

    // The seeded conversation's own turns are on screen, so the empty state is gone.
    expect(screen.queryByRole("heading", { name: /how can .* help today/i })).toBeNull();

    await user.click(
      within(chatHeader()).getByRole("button", { name: /new chat/i }),
    );

    // A fresh thread: the welcome state is back and the composer is empty.
    expect(
      screen.getByRole("heading", { name: /how can .* help today/i }),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText(/ask sunny a question/i) as HTMLTextAreaElement).value,
    ).toBe("");

    // Nothing was deleted, and the old thread is selectable again.
    const again = screen.getByRole("button", { name: /^Daily Stats/i });
    await user.click(again);
    expect(screen.queryByRole("heading", { name: /how can .* help today/i })).toBeNull();
  });

  it("does not create or duplicate a conversation when pressed repeatedly", async () => {
    const user = userEvent.setup();
    renderChat();

    const countRows = () =>
      screen.getAllByRole("button", { name: /^delete conversation:/i }).length;
    const before = countRows();

    const newChat = within(chatHeader()).getByRole("button", { name: /new chat/i });
    await user.click(newChat);
    await user.click(newChat);
    await user.click(newChat);

    // A conversation is created by the first question, never by this button, so
    // three presses leave the history exactly as it was — no empty stubs.
    expect(countRows()).toBe(before);
  });
});
