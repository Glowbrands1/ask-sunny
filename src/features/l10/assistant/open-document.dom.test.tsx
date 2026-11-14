// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* The Hub's "Open as document" (artifacts-lite): a long answer opens in the document pane with Copy, Word and .md. */
vi.mock("@/features/l10/actions", () => ({ meetingPeopleAction: async () => [] }));

import { AssistantPanel } from "./AssistantPanel";
import { saveConversation } from "./storage";

const SCOPE = "sunny-user-1:stc-dm";
const LONG = ["# Staffing plan for Q1", "", ...Array.from({ length: 24 }, (_, i) => `- Step ${i + 1}: hire and train`)].join("\n");

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ configured: true }), { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openWith(answer: string) {
  saveConversation(
    [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Write the staffing plan" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: answer }] },
    ],
    SCOPE,
  );
  render(<AssistantPanel open onClose={() => {}} meetingKey="stc-dm" scope={SCOPE} />);
  await act(async () => {
    await Promise.resolve();
  });
}

describe("Open as document", () => {
  it("shows under a long answer only, and opens it in the pane with its title, Copy, Word and .md", async () => {
    await openWith(LONG);
    fireEvent.click(screen.getByRole("button", { name: "Open as document" }));
    const pane = within(screen.getByRole("region", { name: "Document: Staffing plan for Q1" }));
    expect(pane.getByRole("button", { name: "Download Word" })).toBeTruthy();
    expect(pane.getByRole("button", { name: "Download .md" })).toBeTruthy();
    expect(pane.getByRole("button", { name: /Copy/ })).toBeTruthy();
    expect(screen.getByTestId("assistant-panel").getAttribute("data-wide")).toBe("true");
  });

  it("no button under a short answer", async () => {
    await openWith("**Bottom line:** two rocks are off track.");
    expect(screen.queryByRole("button", { name: "Open as document" })).toBeNull();
  });

  it("downloads the Markdown under the document's name; Shrink closes the document", async () => {
    await openWith(LONG);
    fireEvent.click(screen.getByRole("button", { name: "Open as document" }));
    const made: string[] = [];
    URL.createObjectURL = vi.fn(() => "blob:doc");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      made.push(this.download);
    });
    fireEvent.click(screen.getByRole("button", { name: "Download .md" }));
    expect(made).toEqual(["staffing-plan-for-q1.md"]);
    fireEvent.click(screen.getByRole("button", { name: "Shrink panel" }));
    expect(screen.queryByTestId("artifact-pane")).toBeNull();
  });
});
