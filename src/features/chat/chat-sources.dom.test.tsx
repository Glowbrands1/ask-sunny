// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageBubble } from "./message-bubble";
import { ContextPanel } from "./context-panel";
import type { ChatMessage, SourceCitation } from "@/types";

/**
 * ============================================================================
 * NO SOURCE-MATERIAL BLOCK UNDER AN ANSWER
 * ============================================================================
 *
 * THE FEEDBACK THESE PIN. A grounded answer rendered a heading and a card per
 * excerpt beneath it — document title, page locator, category, excerpt preview —
 * and the context rail rendered the same material a second time under "Sources
 * for this answer". A manager asking about the tardiness policy wants the
 * answer, not a bibliography taller than it.
 *
 * PRESENTATION ONLY, AND THAT IS THE HALF WORTH TESTING TWICE. `citations` are
 * still produced by retrieval, still returned by the API, still carried on the
 * message and still stored. If these tests passed because grounding had been
 * turned off, the product would be broken in a way no source-removal assertion
 * would notice — so coverage, the insufficient-coverage notice, follow-ups and
 * the answer body are all asserted alongside.
 */

vi.mock("@/lib/session/session-context", () => ({
  useSession: () => ({
    user: { avatarInitials: "PC" },
    isAdmin: false,
  }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock("@/lib/ai", () => ({
  aiProviderStatus: () => ({ name: "Claude", connected: true, detail: "Answering live." }),
}));

function citation(overrides: Partial<SourceCitation> = {}): SourceCitation {
  return {
    documentId: "doc-1",
    documentTitle: "Attendance Policy",
    locator: "Page 4",
    excerpt: "Employees are expected to be ready at their scheduled start time.",
    category: "policies",
    relevance: 0.91,
    ...overrides,
  } as SourceCitation;
}

function answer(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    role: "assistant",
    content: "Arriving late three times in two weeks is a documented coaching matter.",
    createdAt: "2026-09-07T12:00:00Z",
    mode: "standard",
    coverage: "grounded",
    citations: [citation(), citation({ locator: "Page 7" }), citation({ documentId: "doc-2", documentTitle: "Coaching Standards", locator: "Page 2" })],
    ...overrides,
  };
}

function renderAnswer(message: ChatMessage) {
  return render(
    <MessageBubble message={message} onSuggestion={vi.fn()} onRetry={vi.fn()} />,
  );
}

afterEach(cleanup);

describe("an answer carrying citations renders no source material", () => {
  it("renders no source heading", () => {
    /*
     * A. Every wording the heading has ever had.
     *
     * PLAIN SUBSTRING MATCHING, NOT WORD BOUNDARIES. `textContent`
     * concatenates adjacent nodes with no separator, so the rendered heading
     * arrives as "...bodySources1Attendance..." and `\bSources?\b` matches
     * nothing in it. An earlier version of this test used exactly that and
     * passed against a bubble that was rendering the heading — a mutation check
     * is what surfaced it.
     */
    const { container } = renderAnswer(answer());
    const text = container.textContent ?? "";

    for (const wording of ["Sources", "Source —", "Source -", "excerpt", "Excerpt"]) {
      expect(text, `renders "${wording}"`).not.toContain(wording);
    }
    // And the eyebrow the heading was rendered as is gone from the bubble.
    expect(container.querySelector(".eyebrow")).toBeNull();
  });

  it("renders no source card for any citation", () => {
    // B. The cards carried the document title, the locator and the excerpt.
    const { container } = renderAnswer(answer());

    expect(container.textContent).not.toContain("Attendance Policy");
    expect(container.textContent).not.toContain("Coaching Standards");
    expect(container.textContent).not.toContain("Page 4");
    expect(container.textContent).not.toContain(
      "Employees are expected to be ready at their scheduled start time.",
    );
    // And no link into the knowledge base, which is what a card was.
    expect(container.querySelector('a[href^="/knowledge?document="]')).toBeNull();
  });

  it("renders no count, badge or 'view sources' affordance in its place", () => {
    /*
     * The instruction was not "make it smaller". A collapsed panel, an
     * accordion or a count badge would each be a smaller version of the thing
     * that was asked to go.
     */
    const { container } = renderAnswer(answer());
    expect(container.textContent).not.toMatch(/view sources|show sources|\d+ sources?/i);
  });

  it("does not crash on a message that still carries citation data", () => {
    // C. The data is still there. Rendering simply ignores it.
    const message = answer();
    expect(message.citations).toHaveLength(3);
    const { container } = renderAnswer(message);
    expect(container.textContent).toContain("documented coaching matter");
  });
});

describe("everything else about an answer is untouched", () => {
  it("still renders the answer body", () => {
    // D.
    renderAnswer(answer());
    expect(screen.getByText(/documented coaching matter/)).toBeTruthy();
  });

  it("still renders follow-up suggestions", () => {
    // E.
    renderAnswer(answer({ followUpSuggestions: ["What should I document afterwards?"] }));
    expect(
      screen.getByRole("button", { name: "What should I document afterwards?" }),
    ).toBeTruthy();
  });

  it("still says when the knowledge base did not cover the question", () => {
    /*
     * F. THE MOST IMPORTANT ONE HERE. Coverage is not a source card — it is
     * Sunny telling a manager that what they just read is general guidance
     * rather than company policy. Removing the bibliography must not have taken
     * that with it.
     */
    const { container } = renderAnswer(
      answer({ coverage: "insufficient", citations: [] }),
    );
    expect(container.textContent).toContain("Not covered by the knowledge base");
    expect(container.textContent).toContain("not");
  });

  it("still renders a failed turn as a failure rather than an answer", () => {
    const { container } = renderAnswer(
      answer({
        content: "",
        citations: undefined,
        error: {
          kind: "model_failed",
          message: "Sunny could not reach the model.",
          retryable: true,
          question: "how much PTO?",
        },
      }),
    );
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});

describe("the context rail no longer shows sources either", () => {
  it("renders no 'Sources for this answer' section", () => {
    // The second surface. Phase 1 did not touch it, so removing only the
    // in-thread block would have left the request half-done.
    const { container } = render(<ContextPanel messages={[answer()]} />);
    expect(container.textContent).not.toMatch(/sources for this answer/i);
    expect(container.textContent).not.toContain("Attendance Policy");
    expect(container.querySelector('a[href^="/knowledge?document="]')).toBeNull();
  });

  it("still shows the provider status and the take-it-further links", () => {
    const { container } = render(<ContextPanel messages={[answer()]} />);
    expect(container.textContent).toContain("Claude");
    expect(container.textContent).toContain("Take it further");
  });
});
