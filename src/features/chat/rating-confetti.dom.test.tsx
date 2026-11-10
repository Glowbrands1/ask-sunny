// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Confetti on a 5-star rating — requested by the app owner, 9 Nov 2026: "can
 * you add a confetti when someone rates the app 5 star please confetti
 * animation on screen". It fires only after the rating has SAVED, only for
 * five stars, and never for a failed save.
 */
const burst = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ui/confetti", () => ({ burstConfetti: burst }));

import { ConversationRating } from "./conversation-rating";

const TURN = "11111111-1111-4111-8111-111111111111";

function fakeFetch(rating: number, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      json: async () =>
        ok
          ? {
              feedback: {
                id: "fb-1",
                turnId: TURN,
                rating,
                gotWhatNeeded: null,
                comment: "",
                updatedAt: "2026-11-09T10:00:00.000Z",
              },
            }
          : { error: "Could not save." },
    })),
  );
}

function rate(label: RegExp) {
  const onSaved = vi.fn();
  render(<ConversationRating turnId={TURN} conversationId="conv_1" messageId="msg_1" onSaved={onSaved} />);
  fireEvent.click(screen.getByRole("button", { name: /rate this conversation/i }));
  fireEvent.click(screen.getByRole("radio", { name: label }));
  fireEvent.click(screen.getByRole("button", { name: "Submit feedback" }));
  return onSaved;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  burst.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("confetti when someone rates the app 5 stars", () => {
  it("bursts once a 5-star rating has saved", async () => {
    fakeFetch(5);
    const onSaved = rate(/^5 — Very helpful$/);
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(burst).toHaveBeenCalledTimes(1);
  });

  it("does not burst for four stars", async () => {
    fakeFetch(4);
    const onSaved = rate(/^4 — Helpful$/);
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(burst).not.toHaveBeenCalled();
  });

  it("does not burst when the 5-star save fails", async () => {
    fakeFetch(5, false);
    rate(/^5 — Very helpful$/);
    await waitFor(() => expect(screen.getByText(/could not save/i)).toBeDefined());
    expect(burst).not.toHaveBeenCalled();
  });
});
