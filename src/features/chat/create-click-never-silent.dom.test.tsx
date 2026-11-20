// @vitest-environment jsdom
import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderToString } from "react-dom/server";

import { MessageBubble } from "./message-bubble";
import type { ChatFormInstanceRef, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * f073 (QA live test, 20 Nov 2026): A "CREATE DRAFT" PRESS THAT DID NOTHING
 * ============================================================================
 *
 * The card said "Proposal — nothing created". The tester pressed "Create draft" and nothing happened: no create
 * reached the server, no message, and the button stayed. A second press 115 s later created the form. The deploy had
 * changed 16 s before the chat started.
 *
 * A create request that never answers (a connection to the old deployment that stalls instead of failing) left the
 * card waiting until the browser gave up on its own, minutes later, and then showed the browser's own words
 * ("Load failed" / "Failed to fetch") or nothing a manager reads as an error. The rule: a press either starts the
 * create or says plainly what to do, and never files a second form. A second press of the same card is safe: the
 * create route returns the draft this card already made (`proposalId`, `findRecentAssistantDraft`).
 */

vi.mock("@/lib/session/session-context", () => ({
  useSession: () => ({ user: { avatarInitials: "TT", name: "Dana Whitlock" }, role: "salon_director", isAdmin: false }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const RETRY = /Something went wrong — press Create again/;

const ACCOUNT: ChatMessage = {
  id: "msg-account",
  role: "user",
  content: "Corin Vale was late twice this week.",
  createdAt: "2026-11-20T16:24:00Z",
};

function proposal(): ChatFormProposal {
  return {
    proposalId: "prop-f073",
    templateKey: "coaching",
    templateName: "Coaching Form",
    supportsInlineDraft: true,
    variantKey: null,
    employeeRole: null,
    employeeName: "Corin Vale",
    locationId: "loc-0101",
    locationName: null,
    locationResolution: "resolved",
    authorizedLocationIds: [],
    status: "ready",
    sourceMessageIds: ["msg-account"],
  };
}

const TURN: ChatMessage = {
  id: "msg-answer",
  role: "assistant",
  content: "Here is what I would put on a **Coaching Form**.",
  createdAt: "2026-11-20T16:24:10Z",
  mode: "standard",
  coverage: "not_applicable",
  citations: [],
  recommendedVideoIds: [],
  formProposal: proposal(),
};

let creates: { proposalId: unknown }[] = [];
let onFormCreated: ReturnType<typeof vi.fn<(messageId: string, reference: ChatFormInstanceRef) => void>>;

/** The create POST behaves as `firstCreate` says once, then answers; every other request answers at once. */
function fakeFetch(firstCreate: "hang" | "network") {
  globalThis.fetch = vi.fn().mockImplementation(async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    if (url === "/api/forms/instances" && init.method === "POST") {
      creates.push({ proposalId: (JSON.parse(String(init.body)) as { proposalId?: unknown }).proposalId });
      if (creates.length === 1) {
        if (firstCreate === "network") throw new TypeError("Load failed");
        // A stalled connection: no answer, ever, unless the request is aborted.
        return new Promise((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
        });
      }
      return { ok: true, json: async () => ({ instance: { id: "inst-73" } }) } as unknown as Response;
    }
    if (url.endsWith("/draft")) return { ok: true, json: async () => ({ values: {}, checked: {}, withheld: [] }) } as unknown as Response;
    return { ok: false, json: async () => ({ error: "not in this test" }) } as unknown as Response;
  }) as typeof fetch;
}

function card() {
  render(<MessageBubble message={TURN} conversation={[ACCOUNT, TURN]} onSuggestion={() => {}} onFormCreated={onFormCreated} />);
  return screen.getByRole("button", { name: /create draft/i });
}

beforeEach(() => {
  creates = [];
  onFormCreated = vi.fn<(messageId: string, reference: ChatFormInstanceRef) => void>();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("f073: a Create press either starts the create or says what to do", () => {
  it("a create that never answers is given up after 30 s with a plain message, and the button works again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fakeFetch("hang");
    fireEvent.click(card());
    expect(creates).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    expect(screen.getByText(RETRY)).toBeTruthy();
    const again = screen.getByRole("button", { name: /create draft/i }) as HTMLButtonElement;
    expect(again.disabled).toBe(false);

    // The second press creates, as the tester's did, and carries the same card id: the route returns the draft
    // this card already made if the first request did reach it, so there is never a second form.
    fireEvent.click(again);
    await waitFor(() => expect(onFormCreated).toHaveBeenCalledTimes(1));
    expect(creates).toHaveLength(2);
    expect(creates.map((made) => made.proposalId)).toEqual(["prop-f073", "prop-f073"]);
  });

  it("a create the network drops says to press Create again, never the browser's 'Load failed'", async () => {
    fakeFetch("network");
    fireEvent.click(card());
    await waitFor(() => expect(screen.getByText(RETRY)).toBeTruthy());
    expect(document.body.textContent).not.toMatch(/Load failed|Failed to fetch/);
    expect(onFormCreated).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /create draft/i }));
    await waitFor(() => expect(onFormCreated).toHaveBeenCalledTimes(1));
    expect(creates).toHaveLength(2);
  });

  it("a double press still sends one create (unchanged)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fakeFetch("hang");
    const button = card();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(creates).toHaveLength(1);
    expect((screen.getByRole("button", { name: /creating/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("f073: a Create button drawn before the browser's code attached is never pressable", () => {
  it("the server's HTML shows a disabled \"Loading…\", never a live-looking \"Create draft\"", () => {
    fakeFetch("hang");
    const html = renderToString(
      <MessageBubble message={TURN} conversation={[ACCOUNT, TURN]} onSuggestion={() => {}} onFormCreated={onFormCreated} />,
    );
    expect(html).toContain("Loading…");
    expect(html).not.toContain("Create draft");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^]*?Loading…/);
  });

  it("once mounted, the button reads \"Create draft\" and is pressable", () => {
    fakeFetch("hang");
    const button = card() as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain("Create draft");
  });
});
