// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import { MessageBubble } from "./message-bubble";
import type { ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * REQUIREMENTS 45–48 — WHAT THE MANAGER ACTUALLY SEES
 * ============================================================================
 *
 * TWO THINGS ARE BEING PINNED, and they pull in opposite directions.
 *
 * The card must SHOW the proposal, so a manager can check it before anything is
 * created. And it must OFFER NOTHING, because confirming a proposal into a
 * record is not built: a Create button that did nothing, or a Download PDF that
 * produced no PDF, would be a worse lie than the prototype's.
 *
 * Rendered rather than source-scanned, because a source scan cannot see that a
 * control is present but inert — and that has shipped here before.
 */

vi.mock("@/lib/session/session-context", () => ({
  useSession: () => ({ user: { avatarInitials: "PC" }, isAdmin: false }),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  cleanup();
  push.mockClear();
});

function proposal(overrides: Partial<ChatFormProposal> = {}): ChatFormProposal {
  return {
    proposalId: "prop-1",
    templateKey: "coaching",
    templateName: "Coaching Form",
    supportsInlineDraft: false,
    employeeName: "Sarah Jones",
    locationId: "loc-0101",
    locationName: null,
    locationResolution: "resolved",
    status: "ready",
    sourceMessageIds: ["msg-1", "msg-2"],
    ...overrides,
  };
}

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    role: "assistant",
    content: "Here is what I would put on a **Coaching Form**.",
    createdAt: "2026-09-07T12:00:00Z",
    mode: "standard",
    coverage: "not_applicable",
    citations: [],
    recommendedVideoIds: [],
    ...overrides,
  };
}

function bubble(overrides: Partial<ChatMessage> = {}) {
  return render(
    <MessageBubble message={message(overrides)} onSuggestion={() => {}} />,
  );
}

describe("45. the card shows what Sunny established", () => {
  it("names the template, the employee and the salon it verified", () => {
    const { container } = bubble({ formProposal: proposal() });
    // Scoped to the card itself: the answer prose above it names the template
    // too, and an unscoped query would pass on that alone.
    const card = container.querySelector("dl")!.parentElement!;

    expect(card.textContent).toContain("Coaching Form");
    expect(card.textContent).toContain("Sarah Jones");
    expect(card.textContent).toContain("loc-0101");
  });

  it("says on its face that nothing was created", () => {
    const { container } = bubble({ formProposal: proposal() });
    expect(container.textContent).toContain("Proposal — nothing created");
  });
});

describe("46. a missing fact reads as missing, not as a blank", () => {
  it("says the employee is not known rather than showing an empty row", () => {
    const { container } = bubble({
      formProposal: proposal({ employeeName: null, status: "needs_employee" }),
    });

    expect(container.textContent).toMatch(/Not yet — tell Sunny who this form is about/);
    // The prototype's stand-in, in the one place it would be least noticed.
    expect(container.textContent).not.toMatch(/Jane|Kowalski/i);
  });

  it("says the salon is not set, and shows no invented salon name", () => {
    const { container } = bubble({
      formProposal: proposal({
        locationId: null,
        locationResolution: "unavailable",
        status: "needs_location",
      }),
    });

    expect(container.textContent).toMatch(/Not set — Ask Sunny could not verify one/);
    expect(container.textContent).not.toMatch(/Sun Tan City —/);
  });

  it("asks which salon when the manager covers more than one", () => {
    const { container } = bubble({
      formProposal: proposal({
        locationId: null,
        locationResolution: "needs_selection",
        status: "needs_location",
      }),
    });
    expect(container.textContent).toMatch(/say which salon this is about/i);
  });
});

describe("47. the card offers no control at all", () => {
  it("renders no button, link or input inside the proposal", () => {
    const { container } = bubble({ formProposal: proposal() });

    /*
     * NO DEAD BUTTONS. Create, Finalize, Download PDF, Start another — none of
     * them exist, because none of them work yet. The follow-up chips are a
     * separate mechanism and are absent here because a proposal turn carries no
     * suggestions.
     */
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.querySelectorAll("input, select, textarea")).toHaveLength(0);
    expect(push).not.toHaveBeenCalled();
  });

  it.each(["Create", "Finalize", "Download", "Open in Create a Form", "Start another"])(
    "offers no %s",
    (label) => {
      const { container } = bubble({ formProposal: proposal() });
      expect(container.textContent).not.toContain(label);
    },
  );
});

describe("48. a pre-Phase-2 turn still renders, and leads nowhere", () => {
  const legacy: ChatMessage["formHandoff"] = {
    templateId: "tpl-coaching",
    templateName: "Coaching Form",
    values: {
      employee_name: "Jane Kowalski",
      employee_role: "Tanning Consultant",
      follow_up_date: "2026-01-19",
    },
    checkedOptions: { coaching_type: ["Documented coaching"] },
  };

  it("renders the prose without throwing", () => {
    /*
     * Conversations live in the browser's IndexedDB, so a manager can still
     * scroll back to one of these. It must deserialize and render — a thread
     * that throws is worse than one that leads nowhere.
     */
    const { container } = bubble({ formHandoff: legacy });
    expect(container.textContent).toContain("Here is what I would put on");
  });

  it("offers no route back into Create a Form", () => {
    const { container } = bubble({ formHandoff: legacy });

    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.textContent).not.toContain("Open in Create a Form");
    expect(container.textContent).toMatch(/no longer opens in Create a Form/i);
    expect(push).not.toHaveBeenCalled();
  });

  it("never puts the stored values back on screen", () => {
    const { container } = bubble({ formHandoff: legacy });

    for (const invented of ["Jane Kowalski", "Tanning Consultant", "Documented coaching"]) {
      expect(container.textContent, invented).not.toContain(invented);
    }
  });

  it("holds no redirect for it in the source either", () => {
    // The rendered assertions above cover the message shapes this test builds;
    // this covers the mechanism, so a redirect cannot come back behind a
    // condition these fixtures happen not to hit.
    const source = readFileSync("src/features/chat/message-bubble.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    expect(source).not.toContain("/forms/create");
    expect(source).not.toContain("publishedTemplateKeyFor");
    expect(source).not.toContain("handoff.values");
  });
});
