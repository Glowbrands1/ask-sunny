// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "@/app/providers";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import type { AskOptions, AskResponse, ClientAskRequest } from "@/lib/ai/types";
import { ChatScreen } from "./chat-screen";
import { ThinkingBubble } from "./message-bubble";

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

/*
 * PROGRESS WHILE THE LOOP WORKS (rebuild plan PR 6, item 5): the thinking bubble shows the latest status the answer
 * streamed ("Looking up <name>…"), as plain text, and it is gone when the answer arrives. Never a chat message.
 */
describe("the thinking bubble's status", () => {
  it("shows the status as plain text, and only the dots without one", () => {
    const { rerender } = render(<ThinkingBubble />);
    expect(screen.queryByTestId("thinking-status")).toBeNull();
    rerender(<ThinkingBubble status={"Looking up <b>Remy</b>…"} />);
    expect(screen.getByTestId("thinking-status").textContent).toBe("Looking up <b>Remy</b>…");
    expect(screen.getByTestId("thinking-status").querySelector("b")).toBeNull();
  });

  it("the chat shows each status while the answer is made, then clears it; the status never becomes a message", async () => {
    let finish!: () => void;
    vi.spyOn(MockAIProvider.prototype, "ask").mockImplementation(async (_request: ClientAskRequest, options?: AskOptions) => {
      options?.onProgress?.("Looking up Remy Calder…");
      options?.onProgress?.("Building the card…");
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { content: "Here's the Corrective Action Form for **Remy Calder**.", citations: [], coverage: "not_applicable", recommendedVideoIds: [] } as AskResponse;
    });
    const user = userEvent.setup();
    render(
      <Providers>
        <ChatScreen />
      </Providers>,
    );
    await user.type(await screen.findByPlaceholderText(/ask about policy/i), "ca for remy calder, she was 20 minutes late on 11/12{Enter}");
    await waitFor(() => expect(screen.getByTestId("thinking-status").textContent).toBe("Building the card…"));
    finish();
    await waitFor(() => expect(screen.queryByTestId("thinking-status")).toBeNull());
    expect(await screen.findByText(/Corrective Action Form/)).toBeTruthy();
    expect(screen.queryByText("Building the card…")).toBeNull();
    expect(screen.queryByText("Looking up Remy Calder…")).toBeNull();
  });
});
