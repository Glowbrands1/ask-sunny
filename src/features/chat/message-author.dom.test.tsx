// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageBubble } from "./message-bubble";
import type { ChatMessage } from "@/types";

/**
 * ============================================================================
 * THE AVATAR BESIDE A QUESTION IS WHOEVER ASKED IT
 * ============================================================================
 *
 * A salon computer is shared, and its browser's chat history holds threads
 * other people started. The avatar used to be the signed-in person's initials
 * on every question, so a regional manager opening a thread Dez started saw
 * their own initials beside Dez's words.
 */

vi.mock("@/lib/session/session-context", () => ({
  useSession: () => ({
    user: { id: "u-sa", avatarInitials: "SA" },
    managerDisplayName: "Sam Avery",
    isAdmin: false,
  }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

function question(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "q1",
    role: "user",
    content: "Generate a weekly summary for the district manager.",
    createdAt: "2026-10-08T20:16:00.000Z",
    ...overrides,
  };
}

function renderQuestion(message: ChatMessage, ownedBySignedIn?: boolean) {
  render(
    <MessageBubble
      message={message}
      onSuggestion={() => {}}
      ownedBySignedIn={ownedBySignedIn}
    />,
  );
}

afterEach(cleanup);

describe("question avatar", () => {
  it("shows the person who asked, not the person signed in", () => {
    renderQuestion(
      question({ author: { userId: "u-dez", name: "Dez Ruiz", initials: "DR" } }),
      false,
    );
    expect(screen.getByTitle("Dez Ruiz").textContent).toBe("DR");
    expect(screen.queryByText("SA")).toBeNull();
  });

  it("uses the stamp even on a thread the signed-in account holds", () => {
    renderQuestion(
      question({ author: { userId: "u-dez", name: "Dez Ruiz", initials: "DR" } }),
      true,
    );
    expect(screen.getByText("DR")).toBeTruthy();
  });

  it("an unstamped question on the signed-in account's thread is theirs", () => {
    renderQuestion(question(), true);
    expect(screen.getByTitle("Sam Avery").textContent).toBe("SA");
  });

  it("an unstamped question only this browser holds gets a neutral avatar", () => {
    renderQuestion(question(), false);
    expect(screen.queryByText("SA")).toBeNull();
    expect(screen.getByLabelText("Unknown asker")).toBeTruthy();
  });
});
