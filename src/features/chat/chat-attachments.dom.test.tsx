// @vitest-environment jsdom
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "@/app/providers";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import type { AskResponse, ClientAskRequest } from "@/lib/ai/types";
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

/*
 * FILES IN THE MAIN CHAT, END TO END ON THE SCREEN (Pau, 26 Nov 2026): a picked file goes with the question to the
 * provider as a data URL, the sent message shows its name, the composer is empty again, and the next question names
 * the earlier file instead of sending it again (its bytes were not kept, as in the DM L10 panel). Invented people only.
 */
describe("attaching a file in the main chat", () => {
  it("sends the file with the question, shows its name on the message, and names it on the next turn", async () => {
    const asked: ClientAskRequest[] = [];
    vi.spyOn(MockAIProvider.prototype, "ask").mockImplementation(async (request: ClientAskRequest) => {
      asked.push(request);
      return { content: "It is a two-week coaching plan for Wren Ashdown.", citations: [], coverage: "not_applicable", recommendedVideoIds: [] } as AskResponse;
    });
    const user = userEvent.setup();
    render(
      <Providers>
        <ChatScreen />
      </Providers>,
    );
    const field = await screen.findByPlaceholderText(/ask about policy/i);
    fireEvent.change(screen.getByTestId("chat-attach-input"), { target: { files: [new File(["%PDF-1.7 Wren Ashdown"], "Wren plan.pdf", { type: "application/pdf" })] } });
    expect(screen.getAllByTestId("chat-attachment-chip").map((chip) => chip.textContent)).toEqual(["Wren plan.pdf"]);
    await user.type(field, "summarize this file{Enter}");

    await screen.findByText(/two-week coaching plan/);
    expect(asked).toHaveLength(1);
    expect(asked[0]!.question).toBe("summarize this file");
    expect(asked[0]!.attachments).toHaveLength(1);
    expect(asked[0]!.attachments![0]).toMatchObject({ filename: "Wren plan.pdf", mediaType: "application/pdf" });
    expect(atob(asked[0]!.attachments![0]!.url.replace(/^data:application\/pdf;base64,/, ""))).toBe("%PDF-1.7 Wren Ashdown");
    // The sent message names the file; the composer has no chips left.
    expect(screen.getAllByTestId("sent-chat-attachment").map((chip) => chip.textContent)).toEqual(["Wren plan.pdf"]);
    expect(screen.queryAllByTestId("chat-attachment-chip")).toHaveLength(0);

    await user.type(field, "what is week 2?{Enter}");
    await waitFor(() => expect(asked).toHaveLength(2));
    expect(asked[1]!.attachments).toBeUndefined();
    const earlier = asked[1]!.history.find((message) => message.role === "user");
    expect(earlier?.content).toContain("[Attached earlier: Wren plan.pdf.");
  });

  it("a question that is only a file is sent in words", async () => {
    const asked: ClientAskRequest[] = [];
    vi.spyOn(MockAIProvider.prototype, "ask").mockImplementation(async (request: ClientAskRequest) => {
      asked.push(request);
      return { content: "Read it.", citations: [], coverage: "not_applicable", recommendedVideoIds: [] } as AskResponse;
    });
    render(
      <Providers>
        <ChatScreen />
      </Providers>,
    );
    await screen.findByPlaceholderText(/ask about policy/i);
    fireEvent.change(screen.getByTestId("chat-attach-input"), { target: { files: [new File(["notes"], "notes.txt", { type: "text/plain" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0]!.question).toBe("Please read the attached file.");
    expect(asked[0]!.attachments![0]).toMatchObject({ filename: "notes.txt", mediaType: "text/plain" });
  });
});
