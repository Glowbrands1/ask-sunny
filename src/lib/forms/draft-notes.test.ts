import { describe, expect, it } from "vitest";

import { MANAGER_CONTEXT_CHARS } from "./context-limits";
import {
  DRAFT_NOTES_MINIMUM,
  draftNotesAreUsable,
  draftNotesFromConversation,
} from "./draft-notes";
import type { ChatMessage } from "@/types";

/**
 * ============================================================================
 * REQUIREMENTS 20-23, 26 — WHAT REACHES THE DRAFTING MODEL
 * ============================================================================
 *
 * These notes become the AI-drafted paragraphs of a real coaching form. Every
 * filter here exists because of what the alternative would put on somebody's
 * employment file:
 *
 *   an assistant turn        Sunny's INTERPRETATION of what the manager said,
 *                            written up as fact
 *   a dropped turn           content the bounded window excluded, sneaking back
 *                            in through the client
 *   a failed turn            an error message read as an account of events
 */

let counter = 0;
function turn(role: "user" | "assistant", content: string, extra: Partial<ChatMessage> = {}) {
  counter += 1;
  return {
    id: `msg-${counter}`,
    role,
    content,
    createdAt: "2026-01-05T10:00:00.000Z",
    ...extra,
  } as ChatMessage;
}

describe("20. only the manager's own turns become drafting notes", () => {
  it("excludes an assistant turn even when its id is listed", () => {
    /*
     * The id list is provenance, not permission. A client that sends an
     * assistant id — by bug or otherwise — still gets nothing from it.
     */
    const manager = turn("user", "Sarah was late three times this week.");
    const sunny = turn("assistant", "Understood. Is this about Jane Kowalski?");

    const notes = draftNotesFromConversation([manager, sunny], [manager.id, sunny.id]);

    expect(notes.text).toBe("Sarah was late three times this week.");
    expect(notes.text).not.toContain("Jane Kowalski");
    expect(notes.usedMessageIds).toEqual([manager.id]);
  });

  it("excludes a failed turn, which is not something anybody said", () => {
    const failed = turn("user", "Sarah was late", {
      error: { kind: "model_failed", message: "no", retryable: true, question: "x" },
    });
    const good = turn("user", "I spoke with her this morning about arriving on time.");

    const notes = draftNotesFromConversation([failed, good], [failed.id, good.id]);
    expect(notes.usedMessageIds).toEqual([good.id]);
  });
});

describe("21. only RETAINED turns become drafting notes", () => {
  it("ignores a manager turn the bounded window dropped", () => {
    const dropped = turn("user", "Last month I coached Marcus about the same thing.");
    const retained = turn("user", "Sarah was late three times this week.");

    // Only the retained id is listed — which is what the server's bounded
    // window produced.
    const notes = draftNotesFromConversation([dropped, retained], [retained.id]);

    expect(notes.text).toBe("Sarah was late three times this week.");
    expect(notes.text).not.toContain("Marcus");
  });

  it("ignores an id naming no message at all", () => {
    const only = turn("user", "Sarah was late three times this week.");
    const notes = draftNotesFromConversation([only], [only.id, "msg-does-not-exist"]);
    expect(notes.usedMessageIds).toEqual([only.id]);
  });
});

describe("22. the newest correction is included", () => {
  it("carries the manager's retraction alongside the original statement", () => {
    const first = turn("user", "Sarah was late three times this week.");
    const correction = turn("user", "Correction — it was twice, not three times.");

    const notes = draftNotesFromConversation([first, correction], [first.id, correction.id]);

    expect(notes.text).toContain("Correction — it was twice, not three times.");
    // In the order they were said: an account reads forwards.
    expect(notes.text.indexOf("three times this week")).toBeLessThan(
      notes.text.indexOf("Correction"),
    );
  });
});

describe("23. the character bound holds on this side too", () => {
  it("stops rather than sending more than the window allows", () => {
    const long = turn("user", "a".repeat(MANAGER_CONTEXT_CHARS - 10));
    const overflow = turn("user", "b".repeat(500));

    const notes = draftNotesFromConversation([long, overflow], [long.id, overflow.id]);

    expect(notes.text.length).toBeLessThanOrEqual(MANAGER_CONTEXT_CHARS);
    expect(notes.usedMessageIds).toEqual([long.id]);
  });
});

describe("26. an account too thin to draft from is refused, not padded", () => {
  it("reports unusable rather than inventing something to send", () => {
    const thin = turn("user", "ok");
    const notes = draftNotesFromConversation([thin], [thin.id]);

    expect(notes.text).toBe("ok");
    expect(draftNotesAreUsable(notes)).toBe(false);
    expect(DRAFT_NOTES_MINIMUM).toBeGreaterThan(2);
  });

  it("reports unusable when nothing at all qualified", () => {
    const sunny = turn("assistant", "Here is what I would put on a Coaching Form.");
    expect(draftNotesAreUsable(draftNotesFromConversation([sunny], [sunny.id]))).toBe(false);
  });

  it("accepts a real account", () => {
    const real = turn(
      "user",
      "Sarah has been late three times this week. I spoke with her this morning.",
    );
    expect(draftNotesAreUsable(draftNotesFromConversation([real], [real.id]))).toBe(true);
  });
});
