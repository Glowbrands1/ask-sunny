// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "@/app/providers";
import { ChatScreen } from "./chat-screen";

/*
 * Demo mode, set before the store module loads, so the store holds the two
 * fixture threads below (see `new-chat-discoverability.dom.test.tsx`).
 */
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_DEMO_MODE = "true";
});

vi.mock("@/data/demo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/demo")>();
  const at = new Date("2026-09-20T10:00:00.000Z").toISOString();
  const thread = (id: string, title: string, question: string, answer: string) => ({
    id,
    title,
    createdAt: at,
    updatedAt: at,
    attachedDocumentIds: [],
    messages: [
      { id: `${id}-q`, role: "user" as const, content: question, createdAt: at },
      { id: `${id}-a`, role: "assistant" as const, content: answer, createdAt: at },
    ],
  });
  return {
    ...actual,
    DEMO_CONVERSATIONS: [
      thread("conv-fixture-1", "Weekend coverage", "Who covers Saturday?", "Check the schedule."),
      thread("conv-fixture-2", "Opening checklist", "How do I open?", "Follow the checklist."),
    ],
  };
});

/*
 * THE ADDRESS IS THE REAL ONE. `useSearchParams` reads `window.location`, the
 * way Next's router does once `replaceState` has synced it, so what these
 * tests read back is exactly what a reload would load.
 */
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
}));

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  for (const name of ["hasPointerCapture", "setPointerCapture", "releasePointerCapture"] as const) {
    if (!(name in Element.prototype)) {
      Object.defineProperty(Element.prototype, name, { value: () => false, writable: true });
    }
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  window.history.replaceState(null, "", "/chat");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderChat() {
  return render(
    <Providers>
      <ChatScreen />
    </Providers>,
  );
}

function chatHeader(): HTMLElement {
  const header = screen.getByRole("button", { name: /^history$/i }).closest("div");
  if (!header) throw new Error("chat header not found");
  return header as HTMLElement;
}

const address = () => new URLSearchParams(window.location.search);

describe("the open conversation is kept in the address", () => {
  it("writes ?c= when a thread is picked, and drops it for a new chat", async () => {
    const user = userEvent.setup();
    renderChat();

    await user.click(screen.getByRole("button", { name: /^history$/i }));
    await user.click(await screen.findByRole("button", { name: /^Opening checklist/i }));

    await waitFor(() => expect(address().get("c")).toBe("conv-fixture-2"));
    expect(window.location.pathname).toBe("/chat");

    await user.click(within(chatHeader()).getByRole("button", { name: /new chat/i }));
    expect(address().get("c")).toBeNull();
  });

  it("reopens the thread the address names, as a reload does", async () => {
    window.history.replaceState(null, "", "/chat?c=conv-fixture-1");
    renderChat();

    expect(await screen.findByText("Check the schedule.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /how can .* help today/i })).toBeNull();
    expect(address().get("c")).toBe("conv-fixture-1");
  });

  it("asks ?q= once, then swaps it for the new thread so a reload does not ask again", async () => {
    window.history.replaceState(null, "", "/chat?q=How%20do%20I%20close%20the%20register%3F");
    renderChat();

    await waitFor(() => expect(address().get("c")).toBeTruthy(), { timeout: 4000 });
    expect(address().get("q")).toBeNull();
    // The question went out exactly once, into the thread the address now names.
    expect(screen.getAllByText("How do I close the register?")).toHaveLength(1);
    // And that thread is still there after hydration: not a fixture thread.
    expect(address().get("c")).not.toMatch(/^conv-fixture/);
  });

  it("writes the address again when the router commits its own after a client-side arrival", async () => {
    window.history.replaceState(null, "", "/chat?q=How%20do%20I%20close%20the%20register%3F");
    const view = renderChat();
    await waitFor(() => expect(address().get("c")).toBeTruthy(), { timeout: 4000 });
    const opened = address().get("c");

    // Next's router finishes committing the link's own address after the
    // effect first ran, putting ?q= back and dropping ?c=.
    window.history.replaceState(null, "", "/chat?q=How%20do%20I%20close%20the%20register%3F");
    view.rerender(
      <Providers>
        <ChatScreen />
      </Providers>,
    );

    await waitFor(() => expect(address().get("c")).toBe(opened));
    expect(address().get("q")).toBeNull();
    // And the question was not asked a second time.
    expect(screen.getAllByText("How do I close the register?")).toHaveLength(1);
  });
});
