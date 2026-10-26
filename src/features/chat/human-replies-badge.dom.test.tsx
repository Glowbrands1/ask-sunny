// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageBubble } from "./message-bubble";
import type { ChatFormProposal, ChatMessage } from "@/types";

/**
 * HUMAN_REPLIES_ENABLED on the card: the badge says "Draft preview — not saved
 * yet" instead of "Proposal — nothing created" (owner, 26 Oct 2026: "humanize
 * it"). The browser reads the public twin. Off, the badge is as it was.
 */

vi.mock("@/lib/session/session-context", () => ({
  useSession: () => ({ user: { avatarInitials: "PC" }, isAdmin: false }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const FLAG = "NEXT_PUBLIC_HUMAN_REPLIES_ENABLED";
const saved = process.env[FLAG];

afterEach(() => {
  cleanup();
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
});

const proposal: ChatFormProposal = {
  proposalId: "prop-1",
  templateKey: "coaching",
  templateName: "Coaching Form",
  supportsInlineDraft: false,
  variantKey: null,
  employeeRole: null,
  employeeName: "Avery Testperson",
  locationId: "loc-0101",
  locationName: null,
  locationResolution: "resolved",
  authorizedLocationIds: [],
  status: "ready",
  sourceMessageIds: ["msg-1"],
};

const message: ChatMessage = {
  id: "m1",
  role: "assistant",
  content: "Here's the **Coaching Form**.",
  createdAt: "2026-10-26T12:00:00Z",
  mode: "standard",
  coverage: "not_applicable",
  citations: [],
  recommendedVideoIds: [],
  formProposal: proposal,
};

describe("the card's badge", () => {
  it("on: Draft preview — not saved yet", () => {
    process.env[FLAG] = "true";
    const { container } = render(<MessageBubble message={message} onSuggestion={() => {}} />);
    expect(container.textContent).toContain("Draft preview — not saved yet");
    expect(container.textContent).not.toContain("Proposal — nothing created");
  });

  it("off: as main", () => {
    delete process.env[FLAG];
    const { container } = render(<MessageBubble message={message} onSuggestion={() => {}} />);
    expect(container.textContent).toContain("Proposal — nothing created");
  });
});
