// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageBubble } from "@/features/chat/message-bubble";
import type { ChatMessage } from "@/types";

import { groundFormSlots } from "./form-full-remap";

vi.mock("@/lib/session/session-context", () => ({
  useSession: () => ({ user: { avatarInitials: "PC" }, isAdmin: false }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(() => {
  cleanup();
});

/** chat_traces conv_mvmj8a26gtq901w. */
const TURNS = ["verbal CA for Test Employee, on cell phone 30+ min 10-20"] as const;

const TODAY = "2026-10-24";

describe("conv_mvmj8a26gtq901w", () => {
  it("replays the turn onto the corrective action card", () => {
    const { slots, response } = groundFormSlots({
      raw: {
        templateKey: "coaching",
        employeeName: null,
        observation: "invented unicorn incident",
        store: "Kearney",
        warningLevel: null,
        payrollDeduct: null,
      },
      history: [],
      question: TURNS[0],
      today: TODAY,
      people: [],
    });
    const card = response.formProposal!;
    expect(slots.templateKey).toBe("dpoa");
    expect(slots.warningLevel).toBe("verbal");
    expect(slots.employeeName).toBe("Test Employee");
    expect(slots.observation).toBe("cell phone use 30+ min");
    expect(slots.incidentDateIso).toBe("2026-10-20");
    expect(slots.incidentTime).toBeNull();
    expect(slots.locationId).toBeNull();
    expect(slots.store).toBeNull();
    expect(slots.payrollDeduct).toBeNull();
    expect(slots.payrollAmount).toBeNull();
    expect(response.content).toContain("Which salon?");
    expect(response.content).not.toMatch(/Kearney|Lawrence/);
    expect(response.content).not.toMatch(/Who is this for\?|Which date should go on the form\?|What happened\?|Verbal or written\?/);

    const message: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "Draft",
      createdAt: "2026-10-24T15:06:00Z",
      mode: "standard",
      coverage: "not_applicable",
      citations: [],
      recommendedVideoIds: [],
      formProposal: card,
    };
    render(<MessageBubble message={message} onSuggestion={() => {}} />);
    const shown = document.querySelector("dl")?.textContent ?? "";
    expect(screen.getByText("Corrective Action Form")).toBeTruthy();
    expect(screen.queryByText("Coaching Form")).toBeNull();
    expect(shown).toContain("Test Employee");
    expect(shown).toContain("Verbal Warning");
    expect(shown).toContain("cell phone use 30+ min");
    expect(shown).toContain("2026-10-20");
    expect(shown).not.toMatch(/Time/);
    expect(shown).not.toMatch(/Kearney|Lawrence/);
    expect(shown).toMatch(/Not set/);
  });
});
