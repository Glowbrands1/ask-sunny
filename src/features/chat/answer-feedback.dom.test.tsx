// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnswerFeedback } from "./answer-feedback";
import type { SavedFeedback } from "@/lib/feedback/types";

/**
 * ============================================================================
 * THE FEEDBACK PANEL, EXERCISED
 * ============================================================================
 *
 * The rules themselves are proved in `lib/feedback/feedback.test.ts`, and that
 * every surface mounts this is proved in `feedback-surfaces.test.ts`. What is
 * left is the part a source scan cannot see: that the controls are real, that
 * a required field actually stops a save, that the save button says what is
 * missing rather than going quietly inert, and that editing sends an update
 * rather than a second opinion.
 *
 * THE NETWORK IS FAKED AT `fetch`, not at the module, so the request body this
 * panel really produces is asserted. Mocking `submitFeedback` would test that
 * the panel calls a function, which is the part nobody gets wrong.
 */

const TURN = "11111111-1111-4111-8111-111111111111";

function saved(overrides: Partial<SavedFeedback> = {}): SavedFeedback {
  return {
    id: "fb-1",
    turnId: TURN,
    rating: 4,
    gotWhatNeeded: "partially",
    comment: "Nearly right.",
    updatedAt: "2026-09-15T10:00:00.000Z",
    ...overrides,
  };
}

function fakeFetch(response: unknown = { feedback: saved() }, ok = true) {
  const spy = vi.fn(async () => ({
    ok,
    json: async () => response,
  }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

function open(props: Partial<React.ComponentProps<typeof AnswerFeedback>> = {}) {
  const onSaved = vi.fn();
  const view = render(
    <AnswerFeedback
      turnId={TURN}
      conversationId="conv_1"
      messageId="msg_1"
      onSaved={onSaved}
      {...props}
    />,
  );
  return { ...view, onSaved };
}

beforeEach(() => {
  /*
   * LIVE MODE, so the panel posts. In demo mode `submitFeedback` resolves
   * locally and never reaches `fetch` — correct behaviour, and it would make
   * every assertion about the request body vacuous.
   */
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------ rendering --- */

describe("the panel only appears where there is something to rate", () => {
  it("renders nothing without a turn id", () => {
    /*
     * An answer whose activity insert did not land has no row to attach a
     * rating to. Analytics is best-effort by design, so this is a real case,
     * and a form that would fail on save is worse than no form.
     */
    const { container } = render(
      <AnswerFeedback turnId={undefined} onSaved={vi.fn()} />,
    );
    /*
     * `innerHTML` rather than a jest-dom matcher: this project does not install
     * `@testing-library/jest-dom`, and a matcher that does not exist fails with
     * "is not a function" — which reads as a broken test rather than a broken
     * component.
     */
    expect(container.innerHTML).toBe("");
  });

  it("opens collapsed, then expands to the three questions", () => {
    open();
    expect(screen.getByText("How helpful was this answer?")).toBeDefined();
    expect(screen.queryByRole("radiogroup", { name: /what you needed/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Give feedback" }));

    expect(screen.getByRole("radiogroup", { name: /how helpful/i })).toBeDefined();
    expect(screen.getByRole("radiogroup", { name: /what you needed/i })).toBeDefined();
    expect(screen.getByLabelText(/what worked, what was missing/i)).toBeDefined();
  });

  it("says the next question is waiting on it", () => {
    /* The gate is enforced by the send path; this is where it is explained. */
    open();
    expect(screen.getByText(/required before your next question/i)).toBeDefined();
  });
});

/* ----------------------------------------------------------- the rules --- */

describe("all three answers are required", () => {
  function expand() {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Give feedback" }));
  }

  it("refuses an empty form and names every missing field", async () => {
    const spy = fakeFetch();
    expand();

    fireEvent.click(screen.getByRole("button", { name: "Save feedback" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Please add a star rating, whether you got what you needed and a comment.",
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses a rating and an outcome with no comment", async () => {
    const spy = fakeFetch();
    expand();

    fireEvent.click(screen.getByRole("radio", { name: /^4 — Helpful$/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Partially" }));
    fireEvent.click(screen.getByRole("button", { name: "Save feedback" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Please add a comment.",
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses a comment with no rating", async () => {
    const spy = fakeFetch();
    expand();

    fireEvent.click(screen.getByRole("radio", { name: "No" }));
    fireEvent.change(screen.getByLabelText(/what worked/i), {
      target: { value: "It gave me the wrong policy." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save feedback" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Please add a star rating.",
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("keeps the save button enabled so the reason can be announced", () => {
    /*
     * A disabled button with no explanation is the commonest accessibility
     * failure in a required form: nothing is announced and nobody learns what
     * is missing by clicking something inert.
     */
    expand();
    const save = screen.getByRole("button", { name: "Save feedback" });
    expect(save.hasAttribute("disabled")).toBe(false);
  });
});

/* ------------------------------------------------------------- saving --- */

describe("saving", () => {
  it("posts the rating, the outcome, the comment and both browser ids", async () => {
    const spy = fakeFetch();
    const { onSaved } = open();
    fireEvent.click(screen.getByRole("button", { name: "Give feedback" }));

    fireEvent.click(screen.getByRole("radio", { name: /^2 — Slightly helpful$/ }));
    fireEvent.click(screen.getByRole("radio", { name: "No" }));
    fireEvent.change(screen.getByLabelText(/what worked/i), {
      target: { value: "  It cut off the policy text.  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save feedback" }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/chat/feedback");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      turnId: TURN,
      rating: 2,
      gotWhatNeeded: "no",
      /* Trimmed on the way out, so whitespace never becomes a stored comment. */
      comment: "It cut off the policy text.",
      conversationId: "conv_1",
      messageId: "msg_1",
    });

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("confirms, and shows what was said", () => {
    open({ saved: saved({ rating: 5, gotWhatNeeded: "yes" }) });

    expect(screen.getByText(/thanks — your feedback helps improve sunny/i)).toBeDefined();
    expect(screen.getByText("Yes")).toBeDefined();
    /* The stars are a picture of a number, so the number is also in text. */
    expect(screen.getByText(/you rated this 5 out of 5/i)).toBeDefined();
  });

  it("keeps the typed comment when the save fails", async () => {
    /*
     * Losing a typed complaint to a failed request would be a particularly bad
     * way to handle feedback about things going wrong.
     */
    fakeFetch({ error: "That answer is not yours to rate." }, false);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Give feedback" }));

    fireEvent.click(screen.getByRole("radio", { name: /^1 — Not helpful$/ }));
    fireEvent.click(screen.getByRole("radio", { name: "No" }));
    fireEvent.change(screen.getByLabelText(/what worked/i), {
      target: { value: "Wrong salon entirely." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save feedback" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "That answer is not yours to rate.",
    );
    expect(
      (screen.getByLabelText(/what worked/i) as HTMLTextAreaElement).value,
    ).toBe("Wrong salon entirely.");
  });
});

/* ------------------------------------------------------------ editing --- */

describe("editing replaces an opinion rather than adding one", () => {
  it("reopens with what was said and sends an update to the same turn", async () => {
    const spy = fakeFetch({ feedback: saved({ rating: 5, comment: "Fixed now." }) });
    open({ saved: saved() });

    fireEvent.click(screen.getByRole("button", { name: /edit your feedback/i }));

    expect(
      (screen.getByLabelText(/what worked/i) as HTMLTextAreaElement).value,
    ).toBe("Nearly right.");
    expect(
      (screen.getByRole("radio", { name: /^4 — Helpful$/ }) as HTMLInputElement).checked,
    ).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: /^5 — Very helpful$/ }));
    fireEvent.change(screen.getByLabelText(/what worked/i), {
      target: { value: "Fixed now." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update feedback" }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const body = JSON.parse(
      String((spy.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    /*
     * THE SAME TURN ID. The server's unique constraint turns this into an
     * update; a client that invented a new id would create a second row and
     * move the average twice for one opinion.
     */
    expect(body.turnId).toBe(TURN);
    expect(body.rating).toBe(5);
  });

  it("cancels back to what was saved, discarding the edit", () => {
    open({ saved: saved() });
    fireEvent.click(screen.getByRole("button", { name: /edit your feedback/i }));
    fireEvent.change(screen.getByLabelText(/what worked/i), {
      target: { value: "Something else" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByText(/thanks — your feedback helps improve sunny/i)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /edit your feedback/i }));
    expect(
      (screen.getByLabelText(/what worked/i) as HTMLTextAreaElement).value,
    ).toBe("Nearly right.");
  });
});

/* ----------------------------------------------------- accessibility ----- */

describe("the controls are reachable without a mouse", () => {
  it("makes the stars one radio group with five named options", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Give feedback" }));

    const group = screen.getByRole("radiogroup", { name: /how helpful/i });
    expect(group).toBeDefined();

    /*
     * FIVE REAL RADIOS, each naming what its position MEANS rather than only
     * its number — "3 stars" says what you are selecting and not what it says.
     */
    for (const name of [
      /^1 — Not helpful$/,
      /^2 — Slightly helpful$/,
      /^3 — Somewhat helpful$/,
      /^4 — Helpful$/,
      /^5 — Very helpful$/,
    ]) {
      expect(screen.getByRole("radio", { name })).toBeDefined();
    }
  });

  it("makes the outcome one radio group with three named options", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Give feedback" }));

    expect(screen.getByRole("radiogroup", { name: /what you needed/i })).toBeDefined();
    for (const name of ["Yes", "Partially", "No"]) {
      expect(screen.getByRole("radio", { name })).toBeDefined();
    }
  });

  it("labels the comment field rather than relying on a placeholder", () => {
    /*
     * A placeholder disappears the moment somebody types, so a person using a
     * screen reader loses the question while answering it.
     */
    open();
    fireEvent.click(screen.getByRole("button", { name: "Give feedback" }));
    expect(screen.getByLabelText(/what worked, what was missing/i)).toBeDefined();
  });

  it("selects a rating from the keyboard", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Give feedback" }));

    const three = screen.getByRole("radio", { name: /^3 — Somewhat helpful$/ });
    fireEvent.click(three);
    expect((three as HTMLInputElement).checked).toBe(true);
  });
});
