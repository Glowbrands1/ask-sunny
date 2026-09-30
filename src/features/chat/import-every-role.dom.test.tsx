// @vitest-environment jsdom
import * as React from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ROLES } from "@/lib/permissions";
import type { ChatConversation, Permission, Role } from "@/types";

/**
 * ============================================================================
 * IMPORT, IN THE HISTORY PANEL, FOR EVERY ROLE
 * ============================================================================
 *
 * REPORTED: Rachel Dugan, a District Manager, "has History but does not see
 * Import". Import was never gated by role; it was only ever the one-time prompt
 * above the thread, which appears when this browser holds conversations the
 * account does not and disappears for good after "Not now". So somebody with
 * nothing new on this device, or who had dismissed it once, had no Import at
 * all.
 *
 * These cases pin the fix with the REAL `ChatScreen` inside the app's own
 * providers, signed in as each role in turn:
 *
 *   Import is in the History panel for every role;
 *   pressing it opens the import dialog and sends nothing yet;
 *   confirming runs the one existing import — the same client call the prompt
 *   makes — and the thread is in History afterwards;
 *   it works after "Not now", and says so plainly when there is nothing to do;
 *   and what the person may do elsewhere in the app is exactly what it was.
 */

const ORIGINAL = { ...process.env };

/** Every batch the one import path sent to the account. */
const importedBatches: ChatConversation[][] = [];
let localHistory: ChatConversation[] = [];
let storedOnAccount: { id: string; messages: number }[] = [];

vi.mock("@/lib/chat/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/chat/client")>(
    "@/lib/chat/client",
  );
  return {
    ...actual,
    fetchOwnConversations: async () => [],
    fetchHistoryState: async () => ({
      stored: storedOnAccount,
      deleted: [],
      clearedAt: null,
    }),
    saveOwnConversation: async () => {},
    deleteOwnConversation: async () => {},
    clearOwnConversations: async () => {},
    importConversationBatch: async (conversations: ChatConversation[]) => {
      importedBatches.push(structuredClone(conversations));
      return { imported: conversations.map((entry) => entry.id), declined: [] };
    },
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
      replace: async (collection: string, records: ChatConversation[]) => {
        if (collection === "chat_conversations") localHistory = records;
      },
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

const SCOPE: Record<Role, { level: "salon" | "district" | "region" | "global"; primaryAreaId: string | null }> = {
  employee: { level: "salon", primaryAreaId: "loc-0101" },
  assistant_salon_director: { level: "salon", primaryAreaId: "loc-0101" },
  salon_director: { level: "salon", primaryAreaId: "loc-0101" },
  district_manager: { level: "district", primaryAreaId: "district-7" },
  regional_manager: { level: "region", primaryAreaId: "region-2" },
  admin: { level: "global", primaryAreaId: null },
  owner: { level: "global", primaryAreaId: null },
  developer: { level: "global", primaryAreaId: null },
};

/** A browser-local conversation from before history lived on the account. */
const LOCAL: ChatConversation = {
  id: "conv_mfxdevice0001",
  title: "Saturday coverage from last month",
  createdAt: "2026-08-01T09:00:00.000Z",
  updatedAt: "2026-08-01T09:30:00.000Z",
  attachedDocumentIds: [],
  messages: [
    {
      id: "msg_mfxdevice0001",
      role: "user",
      content: "Who covers Saturday?",
      createdAt: "2026-08-01T09:00:00.000Z",
    },
  ],
};

/** Every permission a manager-facing screen could check, sampled after import. */
const PERMISSIONS_TO_SAMPLE: Permission[] = [
  "ask_questions",
  "view_reports",
  "manage_form_templates",
  "manage_knowledge",
  "view_ai_usage",
  "manage_users",
  "manage_integrations",
];

beforeEach(() => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  importedBatches.length = 0;
  localHistory = [structuredClone(LOCAL)];
  storedOnAccount = [];
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL };
});

async function renderChatAs(role: Role) {
  const { Providers } = await import("@/app/providers");
  const { ChatScreen } = await import("./chat-screen");
  const { useSession } = await import("@/lib/session/session-context");

  const permissions: { current: Record<string, boolean> } = { current: {} };
  function PermissionProbe() {
    const { can } = useSession();
    permissions.current = Object.fromEntries(
      PERMISSIONS_TO_SAMPLE.map((permission) => [permission, can(permission)]),
    );
    return null;
  }

  render(
    <Providers
      session={{
        subject: "11111111-1111-4111-8111-aaaaaaaaaaaa",
        email: `${role}@example.com`,
        displayName: role,
        role,
        scope: { ...SCOPE[role], alsoCoversAreaIds: [] },
      }}
      productionAuth
    >
      <PermissionProbe />
      <ChatScreen />
    </Providers>,
  );
  await act(async () => {
    for (let tick = 0; tick < 30; tick += 1) await Promise.resolve();
  });
  return { permissions };
}

async function openHistory(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^history$/i }));
  expect(screen.getByText("Chat history")).toBeTruthy();
}

function historyImportButton(): HTMLElement {
  /* The panel's Import, not the prompt's: the one beside Clear history. */
  const clear = screen.getByRole("button", { name: /^clear history$/i });
  return within(clear.parentElement!).getByRole("button", { name: /^import$/i });
}

/* ============================================================ per role === */

describe.each(ROLES)("signed in as %s", (role) => {
  it("sees Import in History, opens it, and imports through the one existing path", async () => {
    const user = userEvent.setup();
    const { permissions } = await renderChatAs(role);
    const before = { ...permissions.current };

    await openHistory(user);

    /* 1. Import is visible. */
    const button = historyImportButton();
    expect(button).toBeTruthy();

    /* 2. It opens, and opening it sends nothing. */
    await user.click(button);
    const dialog = await screen.findByRole("dialog", {
      name: /import conversations from this device/i,
    });
    expect(
      within(dialog).getByText(/1 conversation stored on this device is not on your account yet/i),
    ).toBeTruthy();
    expect(importedBatches).toHaveLength(0);

    /* 3. Confirming runs the same import the prompt runs. */
    await user.click(within(dialog).getByRole("button", { name: /^import$/i }));
    await waitFor(() => expect(importedBatches).toHaveLength(1));
    expect(importedBatches[0]!.map((entry) => entry.id)).toEqual([LOCAL.id]);
    expect(importedBatches[0]![0]!.messages).toEqual(LOCAL.messages);

    /* 4. It says it landed, and the thread is in History. */
    expect(
      await within(dialog).findByText(/1 conversation is now on your account/i),
    ).toBeTruthy();
    /* The footer's Close — the dialog's corner × carries the same name. */
    await user.click(within(dialog).getAllByRole("button", { name: /^close$/i }).at(-1)!);
    expect(screen.getByRole("button", { name: /^Saturday coverage from last month/ })).toBeTruthy();

    /* The prompt above the thread has nothing left to offer, so it is gone. */
    expect(screen.queryByText(/Ask Sunny found 1 conversation/i)).toBeNull();

    /* 5 & 6. What this role may do anywhere else is exactly what it was. */
    expect(permissions.current).toEqual(before);
  });

  it("still has Import after choosing Not now on the prompt", async () => {
    const user = userEvent.setup();
    await renderChatAs(role);

    await user.click(await screen.findByRole("button", { name: /not now/i }));
    expect(screen.queryByText(/Ask Sunny found 1 conversation/i)).toBeNull();

    await openHistory(user);
    await user.click(historyImportButton());
    const dialog = await screen.findByRole("dialog", {
      name: /import conversations from this device/i,
    });
    await user.click(within(dialog).getByRole("button", { name: /^import$/i }));
    await waitFor(() => expect(importedBatches).toHaveLength(1));
  });

  it("says there is nothing to import, rather than hiding Import, when the account already has it", async () => {
    storedOnAccount = [{ id: LOCAL.id, messages: LOCAL.messages.length }];
    const user = userEvent.setup();
    await renderChatAs(role);

    await openHistory(user);
    await user.click(historyImportButton());
    const dialog = await screen.findByRole("dialog", {
      name: /import conversations from this device/i,
    });
    expect(within(dialog).getByText(/there is nothing on this device to import/i)).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /^import$/i })).toBeNull();
    expect(importedBatches).toHaveLength(0);
  });
});

/* ============================================================ the case === */

describe("the reported case: a District Manager with History and no prompt", () => {
  it("has Import in History even though the prompt above the thread is not showing", async () => {
    window.localStorage.setItem("ask-sunny:import-local-history-dismissed", "true");
    const user = userEvent.setup();
    await renderChatAs("district_manager");

    expect(screen.queryByText(/Ask Sunny found/i)).toBeNull();

    await openHistory(user);
    expect(historyImportButton()).toBeTruthy();
  });
});
