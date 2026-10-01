// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageBubble } from "./message-bubble";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import type { ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * COACHING FEEDBACK — WHAT THE MANAGER SEES
 * ============================================================================
 *
 * Point 2: one version showed "Next follow-up: timeframe agreed for the next
 * follow-up" AND a separate "Follow up on" date, and read as the same thing
 * twice. They are two things — the agreed timeframe is on the form, the date
 * is the booking — and the control now says which is which.
 *
 * Point 7: a manager choosing between salons was shown raw ids. They see the
 * roster's names now.
 *
 * `fetch` is faked at the boundary; jsdom is not a browser.
 */

vi.mock("@/lib/session/session-context", () => ({
  useSession: () => ({ user: { avatarInitials: "PC", name: "Paulyne" }, role: "salon_director", isAdmin: false }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const seed = (key: string) => TEMPLATE_SEEDS.find((entry) => entry.key === key)!;

function proposal(overrides: Partial<ChatFormProposal> = {}): ChatFormProposal {
  return {
    proposalId: "prop-1",
    templateKey: "follow-up-coaching",
    templateName: "Follow-Up Coaching Form",
    supportsInlineDraft: true,
    variantKey: null,
    employeeRole: null,
    employeeName: "Kaitlyn Marsh",
    locationId: "loc-0310",
    locationName: null,
    locationResolution: "resolved",
    authorizedLocationIds: [],
    status: "ready",
    sourceMessageIds: ["m-1"],
    ...overrides,
  };
}

function serve(templateKey: string, values: { fieldKey: string; value: string | null; checked: string[]; filledBy: string }[]) {
  const template = seed(templateKey);
  globalThis.fetch = vi.fn().mockImplementation(async () => ({
    ok: true,
    json: async () => ({
      instance: {
        id: "inst-1",
        templateKey,
        templateName: template.name,
        templateVersion: 1,
        templateVersionId: "ver-1",
        variantKey: null,
        employeeName: "Kaitlyn Marsh",
        locationId: "loc-0310",
        locationName: null,
        source: "ask_sunny",
        status: "draft",
        followUpDate: "2026-10-15",
      },
      version: { document: template.document, variants: [] },
      values,
      events: [{ kind: "drafted", actor: "u", createdAt: "2026-10-01T12:00:00Z" }],
    }),
  })) as unknown as typeof fetch;
}

function bubble(message: ChatMessage) {
  const user: ChatMessage = { id: "m-1", role: "user", content: "Follow-up form for Kaitlyn Marsh.", createdAt: "2026-10-01T12:00:00Z" };
  return render(
    <MessageBubble message={message} conversation={[user, message]} onSuggestion={() => {}} onFormCreated={vi.fn()} />,
  );
}

const assistant = (overrides: Partial<ChatMessage>): ChatMessage => ({
  id: "a-1",
  role: "assistant",
  content: "Here is what I would put on a **Follow-Up Coaching Form**.",
  createdAt: "2026-10-01T12:00:01Z",
  mode: "standard",
  coverage: "not_applicable",
  citations: [],
  recommendedVideoIds: [],
  ...overrides,
});

describe("the agreed timeframe and the scheduled date", () => {
  it("shows both, labelled as different things, with one date control", async () => {
    serve("follow-up-coaching", [{ fieldKey: "next_follow_up", value: "within 2 weeks", checked: [], filledBy: "ai" }]);
    const { container } = bubble(
      assistant({
        formProposal: proposal(),
        formInstanceRef: { instanceId: "inst-1", proposalId: "prop-1", templateName: "Follow-Up Coaching Form" },
      }),
    );

    await waitFor(() => expect(screen.getByDisplayValue("within 2 weeks")).toBeTruthy());
    const date = screen.getByLabelText("Follow-up date") as HTMLInputElement;
    expect(date.type).toBe("date");
    expect(date.value).toBe("2026-10-15");
    expect(container.querySelectorAll('input[type="date"]')).toHaveLength(1);
    expect(container.textContent).toContain("The agreed timeframe stays in Next Follow-Up above.");
    expect(container.textContent).not.toContain("Follow up on");
  });

  it("on the Coaching Form, which has no timeframe field, the hint does not point at one", async () => {
    serve("coaching", []);
    const { container } = bubble(
      assistant({
        content: "Here is what I would put on a **Coaching Form**.",
        formProposal: proposal({ templateKey: "coaching", templateName: "Coaching Form" }),
        formInstanceRef: { instanceId: "inst-1", proposalId: "prop-1", templateName: "Coaching Form" },
      }),
    );
    await waitFor(() => expect(screen.getByLabelText("Follow-up date")).toBeTruthy());
    expect(container.textContent).toContain("The day the follow-up is scheduled");
    expect(container.textContent).not.toContain("Next Follow-Up above");
  });
});

describe("choosing a salon", () => {
  it("offers the salons by name, not by id", () => {
    const { container } = bubble(
      assistant({
        content: "I won't choose which salon this belongs to.",
        formProposal: proposal({
          templateKey: "coaching",
          templateName: "Coaching Form",
          locationId: null,
          locationResolution: "needs_selection",
          authorizedLocationIds: ["loc-0310", "loc-0311"],
          status: "needs_location",
          supportsInlineDraft: false,
        }),
      }),
    );
    const options = [...container.querySelectorAll("option")].map((option) => option.textContent);
    expect(options).not.toContain("loc-0310");
    expect(options.filter((text) => text && text !== "Choose a salon…").length).toBe(2);
    for (const text of options.filter((entry) => entry !== "Choose a salon…")) {
      expect(text).not.toMatch(/^loc-/);
    }
  });
});
