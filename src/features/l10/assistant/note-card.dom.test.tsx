// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NoteDraft } from "./notes";

/*
 * The Leadership Hub's note card, in the DM L10 assistant: the assistant drafts, the person sends. Invented people only.
 */
const sent = vi.hoisted(() => ({ calls: [] as unknown[][], answer: null as unknown }));
vi.mock("@/features/l10/notifications/actions", () => ({
  sendNoteAction: async (...args: unknown[]) => {
    sent.calls.push(args);
    return sent.answer;
  },
}));

import { NoteCard } from "./NoteCard";

const AVERY = { id: "00000000-0000-4000-8000-0000000000a1", name: "Avery Quill" };
const BO = { id: "00000000-0000-4000-8000-0000000000b2", name: "Bo Lark" };
const draft: NoteDraft = {
  status: "draft_not_sent",
  meeting: { key: "stc-dm", name: "STC DM L10" },
  to: [AVERY],
  unclear: [{ asked: "Cy", options: [] }],
  message: "Please send the staffing plan by Friday.",
  people: [AVERY, BO],
};

beforeEach(() => {
  sent.calls = [];
  sent.answer = { ok: true, results: [{ id: AVERY.id, name: AVERY.name, status: "sent" }] };
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});
afterEach(() => cleanup());

describe("the note card", () => {
  it("shows the Hub's card: not sent yet, the recipient, the note, Send and Don't send", () => {
    render(<NoteCard part={{ toolCallId: "call_1", result: draft }} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Hub notification · not sent yet");
    expect(text).toContain("STC DM L10 members");
    expect(text).toContain("Avery Quill");
    expect(text).toContain("Nobody named “Cy” is in STC DM L10.");
    expect((screen.getByLabelText("Note") as HTMLTextAreaElement).value).toBe("Please send the staffing plan by Friday.");
    expect(screen.getByRole("button", { name: /Send notification/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Don’t send" })).toBeTruthy();
    // The picker offers only the meeting's other people.
    const options = [...(screen.getByLabelText("Add person") as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options).toEqual(["+ Add person", "Bo Lark"]);
  });

  it("renders nothing for anything that is not a draft", () => {
    const { container } = render(<NoteCard part={{ toolCallId: "x", result: { error: "nope" } }} />);
    expect(container.innerHTML).toBe("");
  });

  it("Send sends this meeting's note to the chosen people with the draft's id, and shows who got it", async () => {
    render(<NoteCard part={{ toolCallId: "call_1", result: draft }} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Send notification/ }));
    });
    expect(sent.calls).toEqual([["stc-dm", [AVERY.id], "Please send the staffing plan by Friday.", "call_1"]]);
    expect(screen.getByLabelText("Note sent")).toBeTruthy();
    expect(document.body.textContent).toContain("Avery QuillSent");
  });

  it("a refused send shows the Hub's words and keeps the card", async () => {
    sent.answer = { ok: false, reason: "limit" };
    render(<NoteCard part={{ toolCallId: "call_2", result: draft }} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Send notification/ }));
    });
    expect(screen.getByRole("alert").textContent).toBe("You've sent the most notes allowed this hour (30). Try again later.");
    expect(screen.getByRole("button", { name: /Send notification/ })).toBeTruthy();
  });

  it("Don't send dismisses it without sending", () => {
    render(<NoteCard part={{ toolCallId: "call_3", result: draft }} />);
    fireEvent.click(screen.getByRole("button", { name: "Don’t send" }));
    expect(screen.getByTestId("note-card-dismissed").textContent).toBe("Note not sent.");
    expect(sent.calls).toEqual([]);
  });
});
