// @vitest-environment jsdom
import * as React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatConversation } from "@/types";
import { createId } from "@/lib/utils/id";

/**
 * "How do I request time off?" sent while /chat is still loading.
 *
 * listDocuments is held. The question is sent during that wait. On, it is
 * queued until the store is ready and the question and the reply both stay.
 * Off, hydration replaces the list and both are gone. The field is not
 * disabled in either case.
 */

vi.setConfig({ testTimeout: 20_000 });

const ORIGINAL = { ...process.env };
const QUESTION = "How do I request time off?";
const REPLY = "Request time off through the schedule.";

const asked: string[] = [];
const saved: { id: string; messages: { role: string; content: string }[] }[] = [];
let localHistory: ChatConversation[] = [];

const documents = vi.hoisted(() => {
  let release: () => void = () => {};
  let pending = Promise.resolve();
  return {
    hold() {
      pending = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    release() {
      release();
    },
    wait() {
      return pending;
    },
  };
});

vi.mock("@/lib/chat/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/chat/client")>(
    "@/lib/chat/client",
  );
  return {
    ...actual,
    fetchOwnConversations: async () => [],
    fetchHistoryState: async () => ({ stored: [], deleted: [], clearedAt: null }),
    saveOwnConversation: async (conversation: ChatConversation) => {
      saved.push({
        id: conversation.id,
        messages: conversation.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      });
    },
    deleteOwnConversation: async () => {},
    clearOwnConversations: async () => {},
    importConversationBatch: async () => ({ imported: [], declined: [] }),
  };
});

vi.mock("@/lib/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage")>("@/lib/storage");
  return {
    ...actual,
    getStorageProvider: () => ({
      name: "fake",
      isAvailable: () => true,
      list: async (collection: string) =>
        collection === "chat_conversations" ? localHistory : [],
      replace: async () => {},
      put: async () => {},
      remove: async () => {},
      getValue: async () => null,
      setValue: async () => {},
      putBlob: async () => {},
      getBlob: async () => null,
      getBlobMeta: async () => null,
      removeBlob: async () => {},
      clearAll: async () => {},
    }),
  };
});

vi.mock("@/lib/knowledge", () => ({
  getKnowledgeProvider: () => ({
    listDocuments: () => documents.wait().then(() => []),
  }),
  getLocalKnowledgeProvider: () => ({ setDocuments: () => {} }),
}));

vi.mock("@/lib/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai")>();
  return {
    ...actual,
    aiProviderStatus: () => ({
      name: "Claude (Anthropic)",
      connected: true,
      detail: "Answering live.",
    }),
    getAIProvider: () => ({
      name: "stub",
      connected: true,
      titleForConversation: (first: string) => first.slice(0, 40),
      async ask(request: { question: string }) {
        asked.push(request.question);
        return {
          content: REPLY,
          citations: [],
          coverage: "not_applicable" as const,
          recommendedVideoIds: [],
          turnId: "aaaaaaaa-1111-4111-8111-111111111111",
        };
      },
    }),
  };
});

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/chat",
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
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

const STORED: ChatConversation = {
  id: createId("conv"),
  title: "Weekend coverage",
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
  attachedDocumentIds: [],
  messages: [
    {
      id: createId("msg"),
      role: "user",
      content: "Who covers Saturday?",
      createdAt: "2026-10-01T10:00:00.000Z",
    },
  ],
};

beforeEach(() => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  delete process.env.SEND_AFTER_HYDRATE_ENABLED;
  delete process.env.NEXT_PUBLIC_SEND_AFTER_HYDRATE_ENABLED;
  asked.length = 0;
  saved.length = 0;
  localHistory = [STORED];
  documents.hold();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL };
});

async function renderChat() {
  const { Providers } = await import("@/app/providers");
  const { ChatScreen } = await import("./chat-screen");
  render(
    <Providers
      session={{
        subject: "11111111-1111-4111-8111-aaaaaaaaaaaa",
        email: "sd@example.com",
        displayName: "Salon Director",
        role: "salon_director",
        scope: { level: "salon", primaryAreaId: "loc-0306", alsoCoversAreaIds: [] },
      }}
      productionAuth
    >
      <ChatScreen />
    </Providers>,
  );
}

async function typeQuestion() {
  const user = userEvent.setup();
  const field = screen.getByLabelText(/ask sunny a question/i);
  await user.type(field, QUESTION);
  await user.click(screen.getByRole("button", { name: /send message/i }));
  return field;
}

describe("a question sent while the page is still loading", () => {
  it("keeps the question and the reply when the flag is on, without disabling the field", async () => {
    process.env.SEND_AFTER_HYDRATE_ENABLED = "1";
    await renderChat();
    const field = await typeQuestion();

    expect(asked).toEqual([]);
    expect((field as HTMLTextAreaElement).disabled).toBe(false);
    expect((field as HTMLTextAreaElement).value).toBe(QUESTION);

    await act(async () => {
      documents.release();
    });

    expect((await screen.findAllByText(REPLY)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(QUESTION).length).toBeGreaterThan(0);
    expect(
      (screen.getByLabelText(/ask sunny a question/i) as HTMLTextAreaElement).disabled,
    ).toBe(false);

    await waitFor(() => {
      expect(
        saved.some(
          (entry) =>
            entry.messages.some((message) => message.content === QUESTION) &&
            entry.messages.some((message) => message.content === REPLY),
        ),
      ).toBe(true);
    });
    expect(saved.some((entry) => entry.id === STORED.id)).toBe(false);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^history$/i }));
    expect(await screen.findByRole("button", { name: /^weekend coverage/i })).toBeTruthy();
    expect(
      await screen.findByRole("button", { name: /^how do i request time off\?/i }),
    ).toBeTruthy();
  });

  it("drops the question and the reply when the flag is off", async () => {
    await renderChat();
    const field = await typeQuestion();

    await waitFor(() => expect(asked).toEqual([QUESTION]));
    expect((field as HTMLTextAreaElement).disabled).toBe(false);
    expect((await screen.findAllByText(QUESTION)).length).toBeGreaterThan(0);

    await act(async () => {
      documents.release();
    });

    await waitFor(() => expect(screen.queryAllByText(QUESTION)).toEqual([]));
    expect(screen.queryAllByText(REPLY)).toEqual([]);
    expect(vi.mocked(console.warn).mock.calls.flat().join(" ")).not.toContain("dropped");
    expect(saved.some((entry) => entry.messages.some((message) => message.content === QUESTION))).toBe(
      false,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^history$/i }));
    expect(await screen.findByRole("button", { name: /^weekend coverage/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^how do i request time off\?/i })).toBeNull();
  });
});
