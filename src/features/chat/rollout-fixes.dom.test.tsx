// @vitest-environment jsdom
import * as React from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatConversation, ChatFormProposal, ChatFormSelection } from "@/types";

/**
 * =============================================================================
 * THE TEAMS TEST ROLLOUT'S CHAT REPORTS, EACH PINNED TO THE DEFECT IT NAMED
 * =============================================================================
 *
 * Four reports came back from the client's Teams pilot, and three of them were
 * one screen's problem:
 *
 *   "Clicking Rate this conversation inside one conversation exposes the
 *    rating function across every conversation in history."
 *   "There's no way to go back into a past chat to revisit it or make updates."
 *   "Create a form from this conversation was failing this morning and is
 *    still failing."
 *   "Can we hide the chat history so it isn't visible all the time?"
 *
 * These render the REAL `ChatScreen` inside the app's own provider composition,
 * against an account that already holds history, and drive it the way a manager
 * does. A source scan cannot see that switching conversations carries a typed
 * complaint onto somebody else's turn, and it certainly cannot see that a click
 * which was never sent files an HR record ten seconds later.
 *
 * LIVE MODE, NOT DEMO. The seeded conversations carry no `turnId`, so the
 * rating control does not render against them at all — every rating assertion
 * below would be vacuous. The account's own history is faked at the chat client
 * instead, which is the same seam `chat-history-sync.dom.test.tsx` uses.
 */

const ORIGINAL = { ...process.env };

let serverConversations: ChatConversation[] = [];

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
    saveOwnConversation: async () => {},
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
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
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

/**
 * `conv_` plus twelve characters, which is the shape `createId` mints and the
 * shape `isClientConversationId` accepts. A shorter id is refused by the payload
 * validator and the conversation would drop out for the wrong reason.
 */
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
    ],
  };
}

const READY_PROPOSAL: ChatFormProposal = {
  proposalId: "prop_1",
  templateKey: "coaching",
  templateName: "Coaching Form",
  supportsInlineDraft: true,
  variantKey: null,
  employeeName: "Sarah Test",
  employeeRole: null,
  locationId: "loc-0306",
  locationName: null,
  locationResolution: "resolved",
  authorizedLocationIds: ["loc-0306"],
  status: "ready",
  sourceMessageIds: [],
};

const SELECTION: ChatFormSelection = {
  primary: {
    templateKey: "dpoa",
    templateName: "Corrective Action Form",
    description: "The formal corrective step after coaching.",
  },
  additional: [],
};

/** A thread whose last answer offered the form picker rather than a proposal. */
function conversationOfferingForms(): ChatConversation {
  const now = new Date().toISOString();
  return {
    id: "conv_mfxrollout03",
    title: "Gamma thread",
    createdAt: now,
    updatedAt: now,
    attachedDocumentIds: [],
    messages: [
      { id: "msg_g_u", role: "user", content: "I need a form", createdAt: now },
      {
        id: "msg_g_a",
        role: "assistant",
        content: "Which form do you need?",
        createdAt: now,
        mode: "standard",
        turnId: "dddddddd-4444-4444-8444-444444444444",
        citations: [],
        formSelection: SELECTION,
      },
    ],
  };
}

beforeEach(() => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  serverConversations = [
    conversation("conv_mfxrollout01", "Alpha thread", TURN_A),
    conversation("conv_mfxrollout02", "Beta thread", TURN_B),
  ];
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
  /*
   * Hydration asks the account what it holds, several microtask hops after
   * first paint. Waiting on ticks rather than on a rendered row, because the
   * history is CLOSED by default now and there is nothing on screen to wait for.
   */
  await act(async () => {
    for (let tick = 0; tick < 30; tick += 1) await Promise.resolve();
  });
  return view;
}

/** Opens the history panel and returns the conversation row named. */
async function openConversation(user: ReturnType<typeof userEvent.setup>, title: RegExp) {
  await user.click(screen.getByRole("button", { name: /^history$/i }));
  const row = await screen.findByRole("button", { name: title });
  await user.click(row);
}

/* ================================================================ 1. rating */

describe("rating is scoped to the conversation being rated", () => {
  it("does not carry an open rating form into another conversation", async () => {
    const user = userEvent.setup();
    await renderChat();
    await openConversation(user, /^Alpha thread/);

    await user.click(screen.getByRole("button", { name: /rate this conversation/i }));
    expect(
      screen.getByRole("textbox", { name: /anything sunny should do better/i }),
    ).toBeTruthy();

    await openConversation(user, /^Beta thread/);

    /*
     * THE REPORT ITSELF. `ConversationRating` sits at one position in the tree,
     * so selecting another thread changed its PROPS and React reconciled rather
     * than remounted — the open form stayed open, on every conversation after
     * it.
     */
    expect(
      screen.queryByRole("textbox", { name: /anything sunny should do better/i }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: /rate this conversation/i })).toBeTruthy();
  });

  it("does not carry a typed complaint onto another conversation's turn", async () => {
    const user = userEvent.setup();
    await renderChat();
    await openConversation(user, /^Alpha thread/);

    await user.click(screen.getByRole("button", { name: /rate this conversation/i }));
    await user.type(
      screen.getByRole("textbox", { name: /anything sunny should do better/i }),
      "Alpha specific complaint",
    );
    await user.click(screen.getByRole("radio", { name: /^2 —/ }));

    await openConversation(user, /^Beta thread/);
    await user.click(screen.getByRole("button", { name: /rate this conversation/i }));

    /*
     * WHY THIS IS NOT MERELY COSMETIC. `save()` reads `turnId` from the current
     * props and the draft from state, so Alpha's words and Alpha's two stars
     * were submitted against BETA's turn — a rating row naming the wrong
     * conversation, the wrong surface and the wrong topic, with nothing in the
     * dashboard able to tell.
     */
    const comment = screen.getByRole("textbox", {
      name: /anything sunny should do better/i,
    }) as HTMLTextAreaElement;
    expect(comment.value).toBe("");
    expect((screen.getByRole("radio", { name: /^2 —/ }) as HTMLInputElement).checked).toBe(
      false,
    );
  });

  it("shows an unrated conversation as unrated after leaving a rated one", async () => {
    const user = userEvent.setup();
    const rated = conversation("conv_mfxrollout01", "Alpha thread", TURN_A);
    rated.messages[1]!.feedback = {
      id: "fb-1",
      turnId: TURN_A,
      rating: 5,
      gotWhatNeeded: "yes",
      comment: "",
      updatedAt: new Date().toISOString(),
    };
    serverConversations = [rated, conversation("conv_mfxrollout02", "Beta thread", TURN_B)];

    await renderChat();
    await openConversation(user, /^Alpha thread/);
    expect(screen.getByText(/^Rated$/)).toBeTruthy();

    await openConversation(user, /^Beta thread/);
    expect(screen.queryByText(/^Rated$/)).toBeNull();
    expect(screen.getByRole("button", { name: /rate this conversation/i })).toBeTruthy();
  });
});

/* ====================================================== 2. reopening a chat */

describe("a past conversation can be reopened and continued", () => {
  it("loads the whole thread when one is selected from history", async () => {
    const user = userEvent.setup();
    await renderChat();
    await openConversation(user, /^Alpha thread/);

    expect(screen.getByText(/question for Alpha thread/)).toBeTruthy();
    expect(screen.getByText(/answer for Alpha thread/)).toBeTruthy();
    // The empty state is gone: this is a thread, not a fresh chat.
    expect(screen.queryByRole("heading", { name: /how can .* help today/i })).toBeNull();
  });

  it("continues it in place rather than opening a duplicate", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          content: "follow-up answer",
          citations: [],
          turnId: "cccccccc-3333-4333-8333-333333333333",
          coverage: "not_applicable",
        }),
      })),
    );

    await renderChat();
    await openConversation(user, /^Alpha thread/);

    await user.type(
      screen.getByLabelText(/ask sunny a question/i),
      "and what about Tuesday?",
    );
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByText(/follow-up answer/)).toBeTruthy());

    /*
     * THE EARLIER TURNS ARE STILL THERE — a continuation that replaced the
     * thread would read as working and would have lost the conversation the
     * manager came back for.
     */
    expect(screen.getByText(/answer for Alpha thread/)).toBeTruthy();

    // And history still holds two threads, not three.
    await user.click(screen.getByRole("button", { name: /^history$/i }));
    expect(
      screen.getAllByRole("button", { name: /^delete conversation:/i }),
    ).toHaveLength(2);
  });
});

/* ================================================== 3. form from conversation */

describe("create a form from this conversation", () => {
  it("says it is waiting instead of swallowing the press mid-turn", async () => {
    const user = userEvent.setup();
    /*
     * `let` plus an explicit type: the assignment happens inside the fetch
     * stub, which TypeScript cannot see from here and would otherwise narrow to
     * `never`.
     */
    let release: (() => void) | undefined;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            content: "an answer",
            citations: [],
            turnId: "eeeeeeee-5555-4555-8555-555555555555",
            coverage: "not_applicable",
          }),
        };
      }),
    );

    await renderChat();
    await openConversation(user, /^Alpha thread/);

    await user.type(screen.getByLabelText(/ask sunny a question/i), "a slow question");
    await user.keyboard("{Enter}");

    /*
     * REPORTED AS THE ACTION FAILING. `send` refuses a second turn while one is
     * running — correctly — and the rail repeated that check and returned
     * silently, so the button stayed live, was pressed, and did nothing at all.
     */
    const action = screen.getByRole("button", {
      name: /create a form from this conversation/i,
    }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    expect(screen.getByText(/sunny is answering/i)).toBeTruthy();

    release?.();
    await waitFor(() => expect(screen.getByText(/an answer/)).toBeTruthy());

    // And it is live again the moment the turn lands.
    expect(
      (
        screen.getByRole("button", {
          name: /create a form from this conversation/i,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("never files a form from a choice whose request was refused", async () => {
    const user = userEvent.setup();
    /*
     * `let` plus an explicit type: the assignment happens inside the fetch
     * stub, which TypeScript cannot see from here and would otherwise narrow to
     * `never`.
     */
    let release: (() => void) | undefined;
    const called: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        called.push(String(url));
        if (String(url).includes("/api/forms/instances")) {
          return { ok: true, status: 200, json: async () => ({ instance: { id: "inst_1" } }) };
        }
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            content: "Here is the coaching form I can prepare.",
            citations: [],
            turnId: "ffffffff-6666-4666-8666-666666666666",
            coverage: "not_applicable",
            formProposal: READY_PROPOSAL,
          }),
        };
      }),
    );

    serverConversations = [conversationOfferingForms()];
    await renderChat();
    await openConversation(user, /^Gamma thread/);

    // A turn is started and is still in flight.
    await user.type(
      screen.getByLabelText(/ask sunny a question/i),
      "coaching form for Sarah Test",
    );
    await user.keyboard("{Enter}");

    // The manager also presses a form card while that turn is running. `send`
    // refuses it, so this choice was NEVER MADE.
    await user.click(screen.getByRole("button", { name: /Corrective Action Form/i }));

    // The running turn now lands, carrying a ready proposal of its own.
    release?.();
    await waitFor(() =>
      expect(screen.getByText(/Here is the coaching form/)).toBeTruthy(),
    );
    await act(async () => {
      for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
    });

    /*
     * NOTHING WAS CREATED, AND THAT IS THE WHOLE POINT. The picker's intent was
     * a boolean ref set before `send` decided anything, so a refused click armed
     * it and the next proposal card to mount consumed it — filing a real
     * `form_instances` row for a COACHING form off a press of the CORRECTIVE
     * ACTION card. The intent now names the one answer it belongs to.
     */
    expect(called.filter((url) => url.includes("/api/forms/instances"))).toEqual([]);
    // The proposal is offered, not executed: the manager still decides.
    expect(screen.getByRole("button", { name: /create draft/i })).toBeTruthy();
  });

  it("still creates the form when the card's own choice is the one that answered", async () => {
    const user = userEvent.setup();
    const called: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        called.push(String(url));
        if (String(url).includes("/api/forms/instances")) {
          return { ok: true, status: 200, json: async () => ({ instance: { id: "inst_1" } }) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            content: "Here is the form I can prepare.",
            citations: [],
            turnId: "99999999-7777-4777-8777-777777777777",
            coverage: "not_applicable",
            formProposal: READY_PROPOSAL,
          }),
        };
      }),
    );

    serverConversations = [conversationOfferingForms()];
    await renderChat();
    await openConversation(user, /^Gamma thread/);

    /*
     * THE BEHAVIOUR THE FIX MUST NOT COST. Choosing a document by name IS the
     * decision, and a ready proposal that came from that choice creates itself
     * rather than asking the same question twice.
     */
    await user.click(screen.getByRole("button", { name: /Corrective Action Form/i }));
    await waitFor(() =>
      expect(called.some((url) => url.includes("/api/forms/instances"))).toBe(true),
    );
  });
});

/* ============================================================ 6. chat history */

describe("chat history is hidden until it is asked for", () => {
  it("is closed on arrival", async () => {
    await renderChat();
    // No conversation rows, and no Clear History control, are on screen.
    expect(screen.queryByRole("button", { name: /^delete conversation:/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /clear history/i })).toBeNull();
  });

  it("offers one clearly labelled control to open it, at any width", async () => {
    const user = userEvent.setup();
    await renderChat();

    const history = screen.getByRole("button", { name: /^history$/i });
    expect(history.getAttribute("aria-expanded")).toBe("false");

    await user.click(history);
    expect(
      screen.getByRole("button", { name: /^history$/i }).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(await screen.findByRole("button", { name: /^Alpha thread/ })).toBeTruthy();
  });

  it("gets out of the way once a conversation is chosen", async () => {
    const user = userEvent.setup();
    await renderChat();
    await openConversation(user, /^Alpha thread/);

    /*
     * "After selecting a conversation, normal chat view remains the primary
     * focus." A panel that stayed open would be the permanent rail again, only
     * opened by hand.
     */
    expect(screen.queryByRole("button", { name: /^delete conversation:/i })).toBeNull();
    expect(screen.getByText(/answer for Alpha thread/)).toBeTruthy();
  });

  it("keeps every conversation — hiding the panel deletes nothing", async () => {
    const user = userEvent.setup();
    await renderChat();

    await user.click(screen.getByRole("button", { name: /^history$/i }));
    expect(
      screen.getAllByRole("button", { name: /^delete conversation:/i }),
    ).toHaveLength(2);

    // Close it, reopen it: both threads are still there.
    await user.click(screen.getByRole("button", { name: /^history$/i }));
    await user.click(screen.getByRole("button", { name: /^history$/i }));
    expect(
      screen.getAllByRole("button", { name: /^delete conversation:/i }),
    ).toHaveLength(2);
  });

  it("starts a new chat without opening history first", async () => {
    const user = userEvent.setup();
    await renderChat();
    await openConversation(user, /^Alpha thread/);

    await user.click(screen.getByRole("button", { name: /new chat/i }));
    expect(
      screen.getByRole("heading", { name: /how can .* help today/i }),
    ).toBeTruthy();

    // And the thread is still one click away.
    await user.click(screen.getByRole("button", { name: /^history$/i }));
    expect(within(document.body).getByRole("button", { name: /^Alpha thread/ })).toBeTruthy();
  });
});
