// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationRating } from "./conversation-rating";
import type { SavedFeedback } from "@/lib/feedback/types";

/**
 * ============================================================================
 * "RATE THIS CONVERSATION", EXERCISED
 * ============================================================================
 *
 * The rules themselves are proved in `lib/feedback/feedback.test.ts`, and that
 * every surface mounts this — and that no send path is gated on it — is proved
 * in `feedback-surfaces.test.ts`. What is left is the part a source scan cannot
 * see: that the closed state is a quiet, optional invitation rather than a
 * demand; that stars alone are a complete submission; that a conversation
 * already rated says so instead of asking again; and that editing sends an
 * update to the same turn rather than a second opinion.
 *
 * THE NETWORK IS FAKED AT `fetch`, not at the module, so the request body this
 * control really produces is asserted. Mocking `submitFeedback` would test that
 * the control calls a function, which is the part nobody gets wrong.
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

function open(props: Partial<React.ComponentProps<typeof ConversationRating>> = {}) {
  const onSaved = vi.fn();
  const view = render(
    <ConversationRating
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
   * LIVE MODE, so the control posts. In demo mode `submitFeedback` resolves
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

describe("the control only appears where there is something to rate", () => {
  it("renders nothing without a turn id", () => {
    /*
     * An answer whose activity insert did not land has no row to attach a
     * rating to. Analytics is best-effort by design, so this is a real case,
     * and a form that would fail on save is worse than no form.
     */
    const { container } = render(
      <ConversationRating turnId={undefined} onSaved={vi.fn()} />,
    );
    /*
     * `innerHTML` rather than a jest-dom matcher: this project does not install
     * `@testing-library/jest-dom`, and a matcher that does not exist fails with
     * "is not a function" — which reads as a broken test rather than a broken
     * component.
     */
    expect(container.innerHTML).toBe("");
  });

  it("is one quiet action until somebody asks for it", () => {
    /*
     * ======================================================================
     * THE WHOLE POINT OF THE CHANGE, ASSERTED
     * ======================================================================
     *
     * What was here drew itself under every answer as "How helpful was this
     * answer? / Give feedback / Required before your next question" — a
     * standing demand, and an accurate one, because the composer really did
     * refuse the next question. Closed, this is a single passive control and
     * no form at all.
     */
    open();

    expect(screen.getByRole("button", { name: /rate this conversation/i })).toBeDefined();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("never says a rating is required before anything", () => {
    open();
    expect(screen.queryByText(/required before/i)).toBeNull();
    expect(screen.queryByText(/before your next question/i)).toBeNull();
    expect(screen.queryByText(/please rate/i)).toBeNull();
  });

  it("opens the review UI when the action is clicked", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /rate this conversation/i }));

    expect(screen.getByText(/how was your ask sunny experience\?/i)).toBeDefined();
    expect(screen.getByRole("radiogroup", { name: /how was your ask sunny experience/i })).toBeDefined();
    expect(screen.getByRole("radiogroup", { name: /what you needed/i })).toBeDefined();
    expect(screen.getByLabelText(/anything sunny should do better/i)).toBeDefined();
  });

  it("marks a conversation that was already rated, instead of asking again", () => {
    /*
     * Requirement in the brief: somebody who has rated is not asked a second
     * time. The passive action becomes a statement, with an edit beside it.
     */
    open({ saved: saved({ rating: 5 }) });

    expect(screen.getByText("Rated")).toBeDefined();
    expect(screen.queryByRole("button", { name: /rate this conversation/i })).toBeNull();
    expect(screen.getByRole("button", { name: /edit your rating/i })).toBeDefined();
    /* The stars are a picture of a number, so the number is also in text. */
    expect(screen.getByText(/you rated this conversation 5 out of 5/i)).toBeDefined();
  });
});

/* ----------------------------------------------------------- the rules --- */

describe("the stars are the only required answer", () => {
  function expand() {
    open();
    fireEvent.click(screen.getByRole("button", { name: /rate this conversation/i }));
  }

  it("refuses an empty form, naming the one thing it needs", async () => {
    const spy = fakeFetch();
    expand();

    fireEvent.click(screen.getByRole("button", { name: "Submit feedback" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Please choose a star rating.",
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("submits stars alone, with no outcome and no words", async () => {
    /*
     * THE SUBMISSION THE OLD PANEL REFUSED. Somebody who wants to say "that was
     * a 5" and get on with their day is the majority case for a voluntary
     * control, and demanding a sentence from them collected nothing at all.
     */
    const spy = fakeFetch();
    expand();

    fireEvent.click(screen.getByRole("radio", { name: /^4 — Helpful$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Submit feedback" }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const body = JSON.parse(
      String((spy.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    expect(body.rating).toBe(4);
    expect(body.gotWhatNeeded).toBeNull();
    expect(body.comment).toBe("");
  });

  it("keeps the submit button enabled so the reason can be announced", () => {
    /*
     * A disabled button with no explanation is the commonest accessibility
     * failure in a form like this: nothing is announced and nobody learns what
     * is missing by clicking something inert.
     */
    expand();
    const save = screen.getByRole("button", { name: "Submit feedback" });
    expect(save.hasAttribute("disabled")).toBe(false);
  });
});

/* ------------------------------------------------------------- saving --- */

describe("saving", () => {
  it("posts the rating, the outcome, the comment and both browser ids", async () => {
    const spy = fakeFetch();
    const { onSaved } = open();
    fireEvent.click(screen.getByRole("button", { name: /rate this conversation/i }));

    fireEvent.click(screen.getByRole("radio", { name: /^2 — Slightly helpful$/ }));
    fireEvent.click(screen.getByRole("radio", { name: "No" }));
    fireEvent.change(screen.getByLabelText(/anything sunny should do better/i), {
      target: { value: "  It cut off the policy text.  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit feedback" }));

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

  it("hands the saved feedback back to the host, which is what marks it rated", async () => {
    /*
     * The host writes it onto the message in the conversation store — that is
     * what survives a refresh and what stops the same thread being asked about
     * again. This component holds no opinion about where it is kept.
     */
    const spy = fakeFetch({ feedback: saved({ rating: 5 }) });
    const { onSaved } = open();
    fireEvent.click(screen.getByRole("button", { name: /rate this conversation/i }));
    fireEvent.click(screen.getByRole("radio", { name: /^5 — Very helpful$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Submit feedback" }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onSaved.mock.calls[0][0].rating).toBe(5);
  });

  it("keeps the typed comment when the save fails", async () => {
    /*
     * Losing a typed complaint to a failed request would be a particularly bad
     * way to handle feedback about things going wrong.
     */
    fakeFetch({ error: "That answer is not yours to rate." }, false);
    open();
    fireEvent.click(screen.getByRole("button", { name: /rate this conversation/i }));

    fireEvent.click(screen.getByRole("radio", { name: /^1 — Not helpful$/ }));
    fireEvent.click(screen.getByRole("radio", { name: "No" }));
    fireEvent.change(screen.getByLabelText(/anything sunny should do better/i), {
      target: { value: "Wrong salon entirely." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit feedback" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "That answer is not yours to rate.",
    );
    expect(
      (screen.getByLabelText(/anything sunny should do better/i) as HTMLTextAreaElement)
        .value,
    ).toBe("Wrong salon entirely.");
  });
});

/* ------------------------------------------------------------ editing --- */

describe("editing replaces an opinion rather than adding one", () => {
  it("reopens with what was said and sends an update to the same turn", async () => {
    const spy = fakeFetch({ feedback: saved({ rating: 5, comment: "Fixed now." }) });
    open({ saved: saved() });

    fireEvent.click(screen.getByRole("button", { name: /edit your rating/i }));

    expect(
      (screen.getByLabelText(/anything sunny should do better/i) as HTMLTextAreaElement)
        .value,
    ).toBe("Nearly right.");
    expect(
      (screen.getByRole("radio", { name: /^4 — Helpful$/ }) as HTMLInputElement).checked,
    ).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: /^5 — Very helpful$/ }));
    fireEvent.change(screen.getByLabelText(/anything sunny should do better/i), {
      target: { value: "Fixed now." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update rating" }));

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
    fireEvent.click(screen.getByRole("button", { name: /edit your rating/i }));
    fireEvent.change(screen.getByLabelText(/anything sunny should do better/i), {
      target: { value: "Something else" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByText("Rated")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /edit your rating/i }));
    expect(
      (screen.getByLabelText(/anything sunny should do better/i) as HTMLTextAreaElement)
        .value,
    ).toBe("Nearly right.");
  });
});

/* ----------------------------------------------------- accessibility ----- */

describe("the controls are reachable without a mouse", () => {
  it("makes the stars one radio group with five named options", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /rate this conversation/i }));

    const group = screen.getByRole("radiogroup", {
      name: /how was your ask sunny experience/i,
    });
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
    fireEvent.click(screen.getByRole("button", { name: /rate this conversation/i }));

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
    fireEvent.click(screen.getByRole("button", { name: /rate this conversation/i }));
    expect(screen.getByLabelText(/anything sunny should do better/i)).toBeDefined();
  });

  it("selects a rating from the keyboard", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /rate this conversation/i }));

    const three = screen.getByRole("radio", { name: /^3 — Somewhat helpful$/ });
    fireEvent.click(three);
    expect((three as HTMLInputElement).checked).toBe(true);
  });
});

/* ------------------------------------------------ the page stays put ----- */

describe("choosing a star never moves the page", () => {
  /*
   * ==========================================================================
   * "CLICKING A STAR LEAVES ME LOOKING AT A BLANK /chat SCREEN"
   * ==========================================================================
   *
   * The Production report, and its cause: each star is a visually hidden radio
   * (`sr-only`, which is `position: absolute`) inside a `<label>`. With no
   * positioned ancestor, the radio's containing block was the DOCUMENT rather
   * than anything inside the thread's `overflow-y-auto` scroller — so it sat at
   * the offset the long thread had laid it out at, stretched the document to
   * that height, and did not scroll with the thread. Clicking a star focuses
   * the radio, and the browser scrolled the WINDOW thousands of pixels to reveal
   * it. No navigation, no reset — the page simply moved to empty space below
   * the app.
   *
   * jsdom has no layout engine, so the pixels cannot be measured here (they
   * were measured in Chromium when this was fixed: the window scrolled 3044px
   * before, 0px after). What CAN be pinned is the structure that decides them:
   * every hidden radio is anchored to its own label. Remove `relative` from a
   * label and this fails before the jump can ship again.
   */
  function expand() {
    const view = open();
    fireEvent.click(screen.getByRole("button", { name: /rate this conversation/i }));
    return view;
  }

  /** The Tailwind utilities that make an element a containing block. */
  const POSITIONED = /(^|\s)(relative|absolute|fixed|sticky)(\s|$)/;

  it("anchors every visually hidden radio to its own label", () => {
    const { container } = expand();
    const radios = [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];

    /* Five stars and three outcomes: the check must see every one of them. */
    expect(radios).toHaveLength(8);

    for (const radio of radios) {
      expect(radio.className).toMatch(/(^|\s)sr-only(\s|$)/);

      const label = radio.closest("label");
      expect(label).not.toBeNull();
      expect(label!.className).toMatch(/(^|\s)relative(\s|$)/);

      /*
       * THE NEAREST POSITIONED ANCESTOR IS THE LABEL ITSELF — not merely
       * "somewhere above there is a relative". A positioned wrapper further
       * out, around the whole form, would still leave the radio anchored away
       * from the star it stands for.
       */
      let ancestor = radio.parentElement;
      while (ancestor && !POSITIONED.test(ancestor.className)) {
        ancestor = ancestor.parentElement;
      }
      expect(ancestor).toBe(label);
    }
  });

  it.each([
    ["the open form", {}, true],
    ["the unrated invitation", {}, false],
    ["the Rated state", { saved: saved({ rating: 5 }) }, false],
  ] as const)(
    "anchors every visually hidden element inside the control in %s",
    (_label, props, expanded) => {
      /*
       * THE SAME DEFECT, ONE STATE LATER. After saving, the "You rated this
       * conversation" sentence is `sr-only` too; unanchored, it stretched the
       * document below the app just as the radios did (measured: 768px →
       * 1893px), leaving blank page to scroll into past the end of the thread.
       */
      const { container } = open(props);
      if (expanded) {
        fireEvent.click(screen.getByRole("button", { name: /rate this conversation/i }));
      }
      const root = container.firstElementChild as HTMLElement;
      expect(root.className).toMatch(/(^|\s)relative(\s|$)/);

      for (const hidden of container.querySelectorAll<HTMLElement>(".sr-only")) {
        let ancestor = hidden.parentElement;
        while (ancestor && ancestor !== container && !POSITIONED.test(ancestor.className)) {
          ancestor = ancestor.parentElement;
        }
        expect(ancestor).not.toBe(container);
        expect(root.contains(ancestor)).toBe(true);
      }
    },
  );

  it("keeps the rating inside no form, so no click can submit or navigate", () => {
    /*
     * An implicit submission is the other way a click in a panel like this
     * reloads the page. There is no `<form>` for a radio or a button to
     * submit, and every button declares `type="button"` so one could be
     * wrapped in a form later without becoming a submit button.
     */
    const { container } = expand();
    expect(container.querySelector("form")).toBeNull();
    expect(container.closest("form")).toBeNull();
    for (const button of container.querySelectorAll("button")) {
      expect(button.getAttribute("type")).toBe("button");
    }
  });

  it("changes the selected star, and nothing else, on every star from 1 to 5", () => {
    const spy = fakeFetch();
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    const href = window.location.href;
    const historyLength = window.history.length;

    const { onSaved } = expand();

    for (const [value, name] of [
      [1, /^1 — Not helpful$/],
      [2, /^2 — Slightly helpful$/],
      [3, /^3 — Somewhat helpful$/],
      [4, /^4 — Helpful$/],
      [5, /^5 — Very helpful$/],
    ] as const) {
      const radio = screen.getByRole("radio", { name }) as HTMLInputElement;
      /* Click the LABEL, the way a pointer does — the star is inside it. */
      fireEvent.click(radio.closest("label")!);

      expect(radio.checked).toBe(true);

      /* Exactly one star is chosen, and it is this one. */
      const chosen = screen
        .getAllByRole("radio")
        .filter((r) => (r as HTMLInputElement).name.startsWith("rating-"))
        .filter((r) => (r as HTMLInputElement).checked)
        .map((r) => (r as HTMLInputElement).value);
      expect(chosen).toEqual([String(value)]);

      /* The rest of the draft is untouched. */
      for (const outcome of ["Yes", "Partially", "No"]) {
        expect((screen.getByRole("radio", { name: outcome }) as HTMLInputElement).checked).toBe(
          false,
        );
      }
      expect(
        (screen.getByLabelText(/anything sunny should do better/i) as HTMLTextAreaElement).value,
      ).toBe("");

      /* The form is still open, still unsaved, and nothing has gone anywhere. */
      expect(screen.getByRole("button", { name: "Submit feedback" })).toBeDefined();
      expect(screen.queryByRole("alert")).toBeNull();
    }

    expect(spy).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(window.location.href).toBe(href);
    expect(window.history.length).toBe(historyLength);
  });

  it("keeps the stars focusable, named and grouped for a keyboard and a screen reader", () => {
    /*
     * The fix must not buy stability with accessibility: the radios are still
     * real, focusable, in the tab order, and inside the one named radio group.
     */
    expand();
    const group = screen.getByRole("radiogroup", {
      name: /how was your ask sunny experience/i,
    });
    const stars = [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(stars).toHaveLength(5);

    for (const star of stars) {
      expect(star.tabIndex).toBe(0);
      expect(star.disabled).toBe(false);
      star.focus();
      expect(document.activeElement).toBe(star);
      /* The visible focus ring is drawn by the label around the star. */
      expect(star.closest("label")!.className).toContain("focus-within:ring-2");
    }
  });
});

/* --------------------------------------------- the three submissions ----- */

describe("each shape of submission reaches the endpoint intact", () => {
  function expand() {
    const view = open();
    fireEvent.click(screen.getByRole("button", { name: /rate this conversation/i }));
    return view;
  }

  function sentBody(spy: ReturnType<typeof fakeFetch>) {
    return JSON.parse(String((spy.mock.calls[0] as unknown as [string, RequestInit])[1].body));
  }

  it("rating only", async () => {
    const spy = fakeFetch({ feedback: saved({ rating: 3, gotWhatNeeded: null, comment: "" }) });
    const { onSaved } = expand();
    fireEvent.click(screen.getByRole("radio", { name: /^3 — Somewhat helpful$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Submit feedback" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(sentBody(spy)).toMatchObject({ turnId: TURN, rating: 3, gotWhatNeeded: null, comment: "" });
  });

  it("rating and outcome", async () => {
    const spy = fakeFetch({ feedback: saved({ rating: 5, gotWhatNeeded: "yes", comment: "" }) });
    const { onSaved } = expand();
    fireEvent.click(screen.getByRole("radio", { name: /^5 — Very helpful$/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit feedback" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(sentBody(spy)).toMatchObject({ turnId: TURN, rating: 5, gotWhatNeeded: "yes", comment: "" });
  });

  it("rating, outcome and comment — and the control then reads Rated", async () => {
    const spy = fakeFetch({
      feedback: saved({ rating: 2, gotWhatNeeded: "partially", comment: "Missed the policy." }),
    });
    const onSaved = vi.fn();
    const { rerender } = render(
      <ConversationRating turnId={TURN} conversationId="conv_1" messageId="msg_1" onSaved={onSaved} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /rate this conversation/i }));
    fireEvent.click(screen.getByRole("radio", { name: /^2 — Slightly helpful$/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Partially" }));
    fireEvent.change(screen.getByLabelText(/anything sunny should do better/i), {
      target: { value: "Missed the policy." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit feedback" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(sentBody(spy)).toMatchObject({
      turnId: TURN,
      rating: 2,
      gotWhatNeeded: "partially",
      comment: "Missed the policy.",
    });

    /* The host stores what came back and hands it down as `saved`. */
    rerender(
      <ConversationRating
        turnId={TURN}
        conversationId="conv_1"
        messageId="msg_1"
        saved={onSaved.mock.calls[0][0]}
        onSaved={onSaved}
      />,
    );
    expect(screen.getByText("Rated")).toBeDefined();
    expect(screen.getByText(/you rated this conversation 2 out of 5/i)).toBeDefined();
  });
});
