// @vitest-environment jsdom
import * as React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { announceFormUpdate } from "./form-update-events";
import { MessageBubble } from "./message-bubble";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import type { ChatMessage } from "@/types";

/**
 * ============================================================================
 * PRODUCTION QA OF PR #81 — A CHAT CHANGE SHOWS ON THE FORM AT ONCE
 * ============================================================================
 *
 * A revision or a follow-up date set from chat returns `formUpdate`; the chat
 * screen announces it, and the inline form must re-read the canonical record
 * so the manager sees the new timeframe — and the new date in the date
 * control — without reloading. `fetch` is faked at the boundary.
 */

vi.mock("@/lib/session/session-context", () => ({
  useSession: () => ({ user: { avatarInitials: "PC", name: "Paulyne" }, role: "salon_director", isAdmin: false }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the inline form after a chat change", () => {
  it("re-reads the record when the chat announces an update", async () => {
    const template = TEMPLATE_SEEDS.find((entry) => entry.key === "follow-up-coaching")!;
    const server = { followUpDate: null as string | null, timeframe: "within 2 weeks" };
    const fetchMock = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        instance: {
          id: "inst-1",
          templateKey: "follow-up-coaching",
          templateName: template.name,
          templateVersion: 1,
          templateVersionId: "ver-1",
          variantKey: null,
          employeeName: "Kaitlyn Marsh",
          locationId: "loc-0310",
          locationName: null,
          source: "ask_sunny",
          status: "draft",
          followUpDate: server.followUpDate,
        },
        version: { document: template.document, variants: [] },
        values: [{ fieldKey: "next_follow_up", value: server.timeframe, checked: [], filledBy: "ai" }],
        events: [{ kind: "drafted", actor: "u", createdAt: "2026-10-01T12:00:00Z" }],
      }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const user: ChatMessage = { id: "m-1", role: "user", content: "Follow-up form for Kaitlyn Marsh.", createdAt: "2026-10-01T12:00:00Z" };
    const message: ChatMessage = {
      id: "a-1",
      role: "assistant",
      content: "Here is the form.",
      createdAt: "2026-10-01T12:00:01Z",
      mode: "standard",
      coverage: "not_applicable",
      citations: [],
      recommendedVideoIds: [],
      formProposal: {
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
      },
      formInstanceRef: { instanceId: "inst-1", proposalId: "prop-1", templateName: "Follow-Up Coaching Form" },
    };
    render(<MessageBubble message={message} conversation={[user, message]} onSuggestion={() => {}} onFormCreated={vi.fn()} />);
    await waitFor(() => expect(screen.getByDisplayValue("within 2 weeks")).toBeTruthy());
    expect((screen.getByLabelText("Follow-up date") as HTMLInputElement).value).toBe("");
    const readsBefore = fetchMock.mock.calls.length;

    // The chat turn changed the record on the server…
    server.followUpDate = "2026-10-15";
    server.timeframe = "within 10 days";
    act(() => announceFormUpdate("inst-1"));

    // …and the form shows it without a reload.
    await waitFor(() => expect(screen.getByDisplayValue("within 10 days")).toBeTruthy());
    expect((screen.getByLabelText("Follow-up date") as HTMLInputElement).value).toBe("2026-10-15");
    expect(fetchMock.mock.calls.length).toBeGreaterThan(readsBefore);
  });
});
