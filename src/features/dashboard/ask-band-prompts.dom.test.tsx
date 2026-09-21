// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { DEFAULT_PERMISSION_MATRIX, hasPermission } from "@/lib/permissions";
import type { AccessScope, Permission, Role } from "@/types";

import { AskBand } from "./ask-band";

/**
 * ============================================================================
 * THE CHIPS ON THE BAND ARE THE READER'S, NOT A CONSTANT
 * ============================================================================
 *
 * `quick-questions.test.ts` proves the resolution. This proves the WIRING —
 * that the band asks for this reader's questions and renders what comes back.
 * The two could not both be broken silently, but either could: the band sliced
 * a module constant for its whole life, and a component that kept doing that
 * would pass every test in the other file.
 *
 * THE FOUR-CHIP CAP IS PART OF THE WIRING. The direction draws four, the
 * catalogue holds six for any given reader, and which four depends on who is
 * asking — so the cap is asserted here beside the selection rather than
 * trusted.
 */

/* The identity under test, rebound per case before each render. */
let session = {
  role: "salon_director" as Role,
  scope: {
    level: "salon",
    primaryAreaId: "loc-0306",
    alsoCoversAreaIds: [],
  } as AccessScope,
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  usePathname: () => "/",
}));

vi.mock("@/lib/session/session-context", () => ({
  useSession: () => ({
    user: {
      name: "Madeline Reyes",
      isSalonAccount: false,
      title: "Salon Director",
      scope: session.scope,
    },
    role: session.role,
    /*
     * THE REAL MATRIX, not `() => true`. Whether an employee is offered a
     * reporting chip is the whole question in the last case below, and a
     * permissive stub would answer it wrong in the direction that passes.
     */
    can: (permission: Permission) =>
      hasPermission(DEFAULT_PERMISSION_MATRIX, session.role, permission),
    primaryLocationName: "MO Kansas City Wornall",
    managerDisplayName: "Madeline",
    demoMode: true,
    brand: { knowledgeScopeId: "stc-core" },
  }),
}));

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: () => ({
    forms: [],
    documents: [{ id: "doc-1" }],
    videos: [],
    conversations: [],
    addConversation() {},
    appendConversationMessages() {},
    updateConversation() {},
    patchConversationMessage() {},
    removeConversation() {},
    clearConversations() {},
  }),
}));

function chips(): string[] {
  return screen
    .getAllByRole("button")
    .map((button) => button.textContent?.trim() ?? "")
    .filter((text) => text.endsWith("?") || text.endsWith("."));
}

beforeEach(() => {
  session = {
    role: "salon_director",
    scope: { level: "salon", primaryAreaId: "loc-0306", alsoCoversAreaIds: [] },
  };
});

afterEach(cleanup);

describe("the Overview band offers the questions this reader can be answered", () => {
  it("gives a district manager the two multi-salon openings", () => {
    session = {
      role: "district_manager",
      scope: { level: "district", primaryAreaId: "dist-1", alsoCoversAreaIds: [] },
    };
    render(<AskBand />);

    expect(chips()).toEqual([
      "Where is my region losing revenue based on the latest data?",
      "Which salons need my attention today?",
      "Help me prepare for a coaching conversation.",
      "What does our policy say about attendance?",
    ]);
  });

  it("gives a salon director the single-salon opening", () => {
    render(<AskBand />);

    const rendered = chips();
    expect(rendered[0]).toBe(
      "Show me the most recent Daily Stats and what I need to focus on today.",
    );
    expect(rendered).not.toContain("Which salons need my attention today?");
    expect(rendered).toHaveLength(4);
  });

  /**
   * THE QUESTION THAT STARTED ALL OF THIS IS GONE FROM EVERY SCREEN.
   *
   * "What should I focus on in today's Daily Stats?" asked for a report dated
   * today, and no delivery is ever dated today — so every click opened with an
   * absence. Asserted for all three identities, because the failure was that
   * one list was shown to everybody.
   */
  it.each([
    ["district_manager", "district", "dist-1"],
    ["salon_director", "salon", "loc-0306"],
    ["assistant_salon_director", "salon", "loc-0306"],
  ] as const)("never offers the retired today's-Daily-Stats chip to %s", (role, level, area) => {
    session = { role, scope: { level, primaryAreaId: area, alsoCoversAreaIds: [] } };
    render(<AskBand />);

    for (const chip of chips()) {
      expect(chip).not.toMatch(/today'?s\s+Daily Stats/i);
    }
  });

  it("offers an employee no reporting chip, and does not leave them with none", () => {
    session = {
      role: "employee",
      scope: { level: "salon", primaryAreaId: "loc-0306", alsoCoversAreaIds: [] },
    };
    render(<AskBand />);

    const rendered = chips();
    expect(rendered).toEqual([
      "What does our policy say about attendance?",
      "How should I handle a client objection?",
      "Show me training related to this issue.",
    ]);
    expect(rendered.join(" ")).not.toMatch(/Daily Stats|revenue|salons need/i);
  });
});
