// @vitest-environment jsdom
import * as React from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatConversation } from "@/types";

/**
 * =============================================================================
 * RATING A CONVERSATION, INSIDE THE REAL CHAT SCREEN
 * =============================================================================
 *
 * THE PRODUCTION REPORT: "I open Rate this conversation, click a star, and the
 * page jumps — I'm left on a mostly blank /chat screen with the feedback form
 * displaced near the bottom." The URL never changed, and the cause was layout,
 * not routing: the stars' visually hidden radios were anchored to the document
 * rather than to the thread's scroller, so focusing one scrolled the window —
 * see `conversation-rating.tsx`, and the structural pin in
 * `conversation-rating.dom.test.tsx`.
 *
 * What a layout-free DOM CAN prove is everything around it, and that is this
 * file: with the REAL `ChatScreen` inside the app's own providers, opening the
 * form and clicking every star navigates nowhere, keeps the same conversation
 * active, keeps every message on screen, and changes nothing but the draft's
 * rating — and a submitted rating survives the conversation being reloaded
 * from the account.
 *
 * LIVE MODE, NOT DEMO, for the reason `rollout-fixes.dom.test.tsx` gives: the
 * seeded demo conversations carry no `turnId`, so the rating control would not
 * render at all and every assertion below would pass vacuously.
 */

const ORIGINAL = { ...process.env };

let serverConversations: ChatConversation[] = [];
/** Every thread the screen asked the account to store, most recent last. */
const savedToAccount: ChatConversation[] = [];

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/chat/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/chat/client")>(
    "@/lib/chat/client",
  );
  return {
    ...actual,
    fetchOwnConversations: async () => serverConversations,
    fetchHistoryState: async () => ({
      stored: serverConversations.map((entry) => ({
        id: entry.id,
        messages: entry.messages.length,
      })),
      deleted: [],
      clearedAt: null,
    }),
    saveOwnConversation: async (conversation: ChatConversation) => {
      savedToAccount.push(structuredClone(conversation));
    },
    deleteOwnConversation: async () => {},
    clearOwnConversations: async () => {},
    importConversationBatch: async () => ({ imported: [], declined: [] }),
  };
});

/** IndexedDB stands in as nothing at all: the account is the source here. */
vi.mock("@/lib/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage")>("@/lib/storage");
  return {
    ...actual,
    getStorageProvider: () => ({
      name: "fake",
      isAvailable: () => true,
      list: async () => [],
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

/* Retrieval is not what this file is about, and it reaches the network. */
vi.mock("@/lib/knowledge", () => ({
  getKnowledgeProvider: () => ({ listDocuments: async () => [] }),
  getLocalKnowledgeProvider: () => ({ setDocuments: () => {} }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/chat",
  useRouter: () => router,
}));

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
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

/* ------------------------------------------------------------- fixtures -- */

const TURN_A = "aaaaaaaa-1111-4111-8111-111111111111";
const TURN_B = "bbbbbbbb-2222-4222-8222-222222222222";

function conversation(id: string, title: string, turnId: string): ChatConversation {
  const now = new Date().toISOString();
  return {
    id,
    title,
    createdAt: now,
    updatedAt: now,
    attachedDocumentIds: [],
    messages: [
      { id: `msg_${id.slice(5)}u`, role: "user", content: `question for ${title}`, createdAt: now },
      {
        id: `msg_${id.slice(5)}a`,
        role: "assistant",
        content: `answer for ${title}`,
        createdAt: now,
        mode: "standard",
        turnId,
        citations: [],
      },
      { id: `msg_${id.slice(5)}v`, role: "user", content: `follow-up for ${title}`, createdAt: now },
      {
        id: `msg_${id.slice(5)}w`,
        role: "assistant",
        content: `second answer for ${title}`,
        createdAt: now,
        mode: "standard",
        turnId,
        citations: [],
      },
    ],
  };
}

const ALPHA = "conv_mfxratejump1";
const BETA = "conv_mfxratejump2";

beforeEach(() => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  serverConversations = [
    conversation(ALPHA, "Alpha thread", TURN_A),
    conversation(BETA, "Beta thread", TURN_B),
  ];
  savedToAccount.length = 0;
  for (const spy of Object.values(router)) spy.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL };
});

async function renderChat() {
  const { Providers } = await import("@/app/providers");
  const { ChatScreen } = await import("./chat-screen");
  const view = render(
    <Providers
      session={{
        subject: "11111111-1111-4111-8111-aaaaaaaaaaaa",
        email: "dm@example.com",
        displayName: "District Manager",
        role: "district_manager",
        scope: { level: "district", primaryAreaId: "district-7", alsoCoversAreaIds: [] },
      }}
      productionAuth
    >
      <ChatScreen />
    </Providers>,
  );
  await act(async () => {
    for (let tick = 0; tick < 30; tick += 1) await Promise.resolve();
  });
  return view;
}

async function openConversation(user: ReturnType<typeof userEvent.setup>, title: RegExp) {
  await user.click(screen.getByRole("button", { name: /^history$/i }));
  const row = await screen.findByRole("button", { name: title });
  await user.click(row);
}

/** Which history row is marked current — the screen's own idea of "active". */
async function activeTitle(user: ReturnType<typeof userEvent.setup>): Promise<string | null> {
  await user.click(screen.getByRole("button", { name: /^history$/i }));
  const current = screen
    .getAllByRole("button")
    .find((button) => button.getAttribute("aria-current") === "true");
  const title = current?.textContent ?? null;
  /* Close it again, so the panel is not left over the thread. */
  await user.click(screen.getByRole("button", { name: /^history$/i }));
  return title;
}

const ALPHA_MESSAGES = [
  /question for Alpha thread/,
  /^answer for Alpha thread/,
  /follow-up for Alpha thread/,
  /second answer for Alpha thread/,
];

function expectAlphaThreadIntact() {
  for (const text of ALPHA_MESSAGES) expect(screen.getByText(text)).toBeTruthy();
  expect(screen.queryByText(/answer for Beta thread/)).toBeNull();
}

/** Every call the page could make that would leave or reload the chat. */
function navigationCalls() {
  return Object.entries(router)
    .filter(([name]) => name !== "prefetch")
    .reduce((sum, [, spy]) => sum + spy.mock.calls.length, 0);
}

/* =========================================================== the jump === */

describe("rating a conversation leaves the chat exactly where it was", () => {
  it("opening Rate this conversation does not navigate", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await renderChat();
    await openConversation(user, /^Alpha thread/);

    const href = window.location.href;
    const historyLength = window.history.length;
    const before = navigationCalls();

    await user.click(screen.getByRole("button", { name: /rate this conversation/i }));

    expect(screen.getByRole("radiogroup", { name: /how was your ask sunny experience/i })).toBeTruthy();
    expect(navigationCalls()).toBe(before);
    expect(window.location.href).toBe(href);
    expect(window.history.length).toBe(historyLength);
    expect(fetchSpy).not.toHaveBeenCalled();
    expectAlphaThreadIntact();
  });

  it("clicking each star from 1 to 5 navigates nowhere, keeps the conversation and its messages, and changes only the rating", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);

    await renderChat();
    await openConversation(user, /^Alpha thread/);
    expect(await activeTitle(user)).toMatch(/^Alpha thread/);

    await user.click(screen.getByRole("button", { name: /rate this conversation/i }));

    const href = window.location.href;
    const historyLength = window.history.length;
    const before = navigationCalls();
    const saves = savedToAccount.length;
    const composer = screen.getByLabelText(/ask sunny a question/i) as HTMLTextAreaElement;
    const composerValue = composer.value;

    for (const value of [1, 2, 3, 4, 5]) {
      const radio = screen.getByRole("radio", {
        name: new RegExp(`^${value} —`),
      }) as HTMLInputElement;

      /* A pointer clicks the STAR, which is inside the label. */
      const star = radio.closest("label")!.querySelector("svg")!;
      await user.click(star);

      expect(radio.checked).toBe(true);

      /* 1. no navigation of any kind */
      expect(navigationCalls()).toBe(before);
      expect(window.location.href).toBe(href);
      expect(window.history.length).toBe(historyLength);
      expect(scrollTo).not.toHaveBeenCalled();

      /* 2. the same conversation, every message still on screen */
      expectAlphaThreadIntact();

      /* 3. only the draft's rating moved: outcome, comment and composer did not */
      const outcomes = within(
        screen.getByRole("radiogroup", { name: /what you needed/i }),
      ).getAllByRole("radio") as HTMLInputElement[];
      expect(outcomes.some((outcome) => outcome.checked)).toBe(false);
      expect(
        (screen.getByRole("textbox", { name: /anything sunny should do better/i }) as HTMLTextAreaElement)
          .value,
      ).toBe("");
      expect(composer.value).toBe(composerValue);

      /* The form is still open, and nothing was saved anywhere. */
      expect(screen.getByRole("button", { name: "Submit feedback" })).toBeTruthy();
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    /* Choosing a star is not a change to the conversation, so nothing is re-stored. */
    expect(savedToAccount.length).toBe(saves);
    expect(await activeTitle(user)).toMatch(/^Alpha thread/);
  });
});

/* ======================================================= saving it ====== */

describe("a submitted rating reads as Rated, and survives a reload", () => {
  it("submits stars, outcome and comment against this conversation's turn, then shows Rated ✓", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          feedback: {
            id: "fb-alpha",
            turnId: body.turnId,
            rating: body.rating,
            gotWhatNeeded: body.gotWhatNeeded,
            comment: body.comment,
            updatedAt: new Date().toISOString(),
          },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchSpy);

    await renderChat();
    await openConversation(user, /^Alpha thread/);
    const before = navigationCalls();

    await user.click(screen.getByRole("button", { name: /rate this conversation/i }));
    await user.click(screen.getByRole("radio", { name: /^4 — Helpful$/ }));
    await user.click(screen.getByRole("radio", { name: "Partially" }));
    await user.type(
      screen.getByRole("textbox", { name: /anything sunny should do better/i }),
      "Close, missed the attendance policy.",
    );
    await user.click(screen.getByRole("button", { name: "Submit feedback" }));

    await waitFor(() => expect(screen.getByText(/^Rated$/)).toBeTruthy());

    const feedbackCalls = fetchSpy.mock.calls.filter(([url]) => url === "/api/chat/feedback");
    expect(feedbackCalls).toHaveLength(1);
    expect(JSON.parse(String(feedbackCalls[0]![1]!.body))).toEqual({
      turnId: TURN_A,
      rating: 4,
      gotWhatNeeded: "partially",
      comment: "Close, missed the attendance policy.",
      conversationId: ALPHA,
      messageId: `msg_${ALPHA.slice(5)}w`,
    });

    expect(screen.getByText(/you rated this conversation 4 out of 5/i)).toBeTruthy();
    expect(navigationCalls()).toBe(before);
    expectAlphaThreadIntact();

    /* THE RATING IS WRITTEN ONTO THE THREAD THE ACCOUNT STORES. */
    await waitFor(() =>
      expect(
        savedToAccount.some(
          (entry) =>
            entry.id === ALPHA &&
            entry.messages.some((message) => message.feedback?.rating === 4),
        ),
      ).toBe(true),
    );
  });

  it("shows the saved rating when the conversation is reloaded and reopened", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}"));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            feedback: {
              id: "fb-alpha",
              turnId: body.turnId,
              rating: body.rating,
              gotWhatNeeded: body.gotWhatNeeded,
              comment: body.comment,
              updatedAt: new Date().toISOString(),
            },
          }),
        };
      }),
    );

    await renderChat();
    await openConversation(user, /^Alpha thread/);
    await user.click(screen.getByRole("button", { name: /rate this conversation/i }));
    await user.click(screen.getByRole("radio", { name: /^5 — Very helpful$/ }));
    await user.click(screen.getByRole("button", { name: "Submit feedback" }));
    await waitFor(() => expect(screen.getByText(/^Rated$/)).toBeTruthy());

    let stored: ChatConversation | undefined;
    await waitFor(() => {
      stored = [...savedToAccount]
        .reverse()
        .find((entry) => entry.id === ALPHA && entry.messages.some((m) => m.feedback));
      expect(stored).toBeDefined();
    });

    /*
     * THE REFRESH. Everything in memory is thrown away and the screen is
     * rebuilt from what the account holds — which is now the thread as the
     * screen last stored it.
     */
    cleanup();
    vi.resetModules();
    serverConversations = [stored!, conversation(BETA, "Beta thread", TURN_B)];

    await renderChat();
    await openConversation(user, /^Alpha thread/);

    expect(screen.getByText(/^Rated$/)).toBeTruthy();
    expect(screen.getByText(/you rated this conversation 5 out of 5/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /rate this conversation/i })).toBeNull();

    /* Editing reopens on what was saved, and names the SAME turn. */
    await user.click(screen.getByRole("button", { name: /edit your rating/i }));
    expect((screen.getByRole("radio", { name: /^5 — Very helpful$/ }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(screen.getByRole("button", { name: "Update rating" })).toBeTruthy();
  });
});
