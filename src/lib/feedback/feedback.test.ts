import { describe, expect, it } from "vitest";

import { classifyTurnKind, isActivitySurface } from "@/lib/analytics/taxonomy";
import {
  EMPTY_FEEDBACK_FILTERS,
  hasActiveFeedbackFilters,
  parseFeedbackFilters,
  serializeFeedbackFilters,
  type FeedbackFilters,
} from "@/lib/analytics/feedback-filters";
import type { ChatMessage } from "@/types";
import { FEEDBACK_DUE_MESSAGE, feedbackDueOn } from "./gate";
import {
  feedbackDraftProblem,
  isFeedbackDraftComplete,
  COMMENT_MAX_LENGTH,
  type FeedbackDraft,
} from "./types";

/**
 * ASK SUNNY FEEDBACK — the rules, tested where they are decided.
 *
 * All pure functions. The panel, the three send paths and the route all import
 * these rather than restating them, so a case proved here is proved for every
 * surface at once — which is the property that matters: nine places draw this
 * control and a rule that held on one of them would be worse than no rule.
 */

/* ------------------------------------------------------------ the draft --- */

const COMPLETE: FeedbackDraft = {
  rating: 4,
  gotWhatNeeded: "partially",
  comment: "Close, but it missed the attendance policy.",
};

describe("a feedback draft is complete only with all three answers", () => {
  it("accepts a draft with a rating, an outcome and a comment", () => {
    expect(feedbackDraftProblem(COMPLETE)).toBeNull();
    expect(isFeedbackDraftComplete(COMPLETE)).toBe(true);
  });

  it("refuses a missing rating", () => {
    expect(feedbackDraftProblem({ ...COMPLETE, rating: null })).toBe(
      "Please add a star rating.",
    );
  });

  it("refuses a missing got-what-needed answer", () => {
    expect(feedbackDraftProblem({ ...COMPLETE, gotWhatNeeded: null })).toBe(
      "Please add whether you got what you needed.",
    );
  });

  it("refuses a missing comment", () => {
    expect(feedbackDraftProblem({ ...COMPLETE, comment: "" })).toBe(
      "Please add a comment.",
    );
  });

  it("refuses a comment that is only whitespace", () => {
    /*
     * A space bar is the cheapest way past a required field, and a queue of
     * blank comments is exactly the outcome requiring one was meant to avoid.
     */
    expect(feedbackDraftProblem({ ...COMPLETE, comment: "   \n  " })).toBe(
      "Please add a comment.",
    );
  });

  it("names every missing field at once rather than one at a time", () => {
    /*
     * Reporting them one per attempt makes an empty form a three-round
     * conversation with a button.
     */
    expect(
      feedbackDraftProblem({ rating: null, gotWhatNeeded: null, comment: "" }),
    ).toBe(
      "Please add a star rating, whether you got what you needed and a comment.",
    );
  });

  it("reports a too-long comment as too long, not as missing", () => {
    const problem = feedbackDraftProblem({
      ...COMPLETE,
      comment: "x".repeat(COMMENT_MAX_LENGTH + 1),
    });
    expect(problem).toContain("shorten");
    expect(problem).toContain(String(COMMENT_MAX_LENGTH));
  });

  it("accepts a comment of exactly the maximum length", () => {
    /* The boundary itself, so an off-by-one refuses a comment that fits. */
    expect(
      feedbackDraftProblem({ ...COMPLETE, comment: "x".repeat(COMMENT_MAX_LENGTH) }),
    ).toBeNull();
  });

  it("accepts every rating on the scale and nothing else", () => {
    for (const rating of [1, 2, 3, 4, 5] as const) {
      expect(feedbackDraftProblem({ ...COMPLETE, rating })).toBeNull();
    }
    for (const rating of [0, 6, -1, 2.5]) {
      expect(
        feedbackDraftProblem({
          ...COMPLETE,
          rating: rating as FeedbackDraft["rating"],
        }),
      ).toBe("Please add a star rating.");
    }
  });
});

/* -------------------------------------------------------------- the gate -- */

function answer(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-a",
    role: "assistant",
    content: "Here is what I found.",
    createdAt: "2026-09-15T10:00:00.000Z",
    turnId: "11111111-1111-4111-8111-111111111111",
    ...overrides,
  };
}

function question(): ChatMessage {
  return {
    id: "msg-q",
    role: "user",
    content: "What is the attendance policy?",
    createdAt: "2026-09-15T09:59:00.000Z",
  };
}

const SAVED = {
  id: "f1",
  turnId: "11111111-1111-4111-8111-111111111111",
  rating: 4 as const,
  gotWhatNeeded: "yes" as const,
  comment: "Good.",
  updatedAt: "2026-09-15T10:01:00.000Z",
};

describe("the gate holds the next question until the last answer is rated", () => {
  it("is due on a completed, recorded, unrated answer", () => {
    expect(feedbackDueOn([question(), answer()])?.id).toBe("msg-a");
  });

  it("releases once that answer has feedback", () => {
    expect(feedbackDueOn([question(), answer({ feedback: SAVED })])).toBeNull();
  });

  it("never holds an empty thread", () => {
    expect(feedbackDueOn([])).toBeNull();
    expect(feedbackDueOn([question()])).toBeNull();
  });

  it("releases on a failed turn", () => {
    /*
     * A turn that errored is not an answer. Asking somebody to rate a failure
     * they can already see is a failure is asking them to do the product's
     * work — and it would trap them behind a broken request at the moment they
     * most need to retry.
     */
    expect(
      feedbackDueOn([
        question(),
        answer({
          error: {
            kind: "model_failed",
            message: "Sunny could not answer.",
            question: "x",
            retryable: true,
          },
        }),
      ]),
    ).toBeNull();
  });

  it("releases on an answer the server did not record", () => {
    /*
     * No `turnId` means no row to attach a rating to. Analytics is best-effort
     * by design, so this really happens, and an answer must not become
     * un-followable because a dashboard row was lost.
     */
    expect(feedbackDueOn([question(), answer({ turnId: undefined })])).toBeNull();
  });

  it("checks only the newest answer, so an old backlog never blocks", () => {
    /*
     * The rule is "rate the answer you just got", not "clear the backlog".
     * Without this, every conversation that existed before this shipped would
     * have become unusable on the day it deployed.
     */
    const thread = [
      question(),
      answer({ id: "old", turnId: "22222222-2222-4222-8222-222222222222" }),
      question(),
      answer({ id: "new", feedback: SAVED }),
    ];
    expect(feedbackDueOn(thread)).toBeNull();
  });

  it("holds when the newest is unrated even if an older one was rated", () => {
    const thread = [
      question(),
      answer({ id: "old", feedback: SAVED }),
      question(),
      answer({ id: "new", turnId: "33333333-3333-4333-8333-333333333333" }),
    ];
    expect(feedbackDueOn(thread)?.id).toBe("new");
  });

  it("names the action that clears it", () => {
    /* A composer that stops accepting input without saying why is a bug. */
    expect(FEEDBACK_DUE_MESSAGE).toMatch(/rate/i);
    expect(FEEDBACK_DUE_MESSAGE).toMatch(/next question/i);
  });
});

/* ------------------------------------------------- acknowledgement kinds --- */

describe("an acknowledgement is not a question", () => {
  it.each([
    "yes",
    "Yes",
    "YES",
    "yes please",
    "  yes  ",
    "yes!",
    "yes.",
    "thanks",
    "Thank you!",
    "thx",
    "ok",
    "got it",
    "today",
    "perfect",
    "no",
    "hi",
  ])("classifies %o as an acknowledgement", (text) => {
    expect(classifyTurnKind(text)).toBe("acknowledgement");
  });

  it.each([
    "yes, but why is Wornall down on PPTA?",
    "Thanks — can you also pull the Spa numbers?",
    "ok so what should I coach first?",
    "What is the attendance policy?",
    "no, that is the wrong salon",
  ])("classifies %o as a question", (text) => {
    /*
     * WHOLE-STRING EQUALITY, NEVER A PREFIX. These five are the most
     * interesting turns in the log — somebody pushing back on an answer — and a
     * prefix match would throw every one of them away.
     */
    expect(classifyTurnKind(text)).toBe("question");
  });

  it("treats an absent or empty question as a question", () => {
    /*
     * Nothing was seen, so nothing may be claimed. `question` is the value that
     * leaves the turn counted where it would have been counted before.
     */
    expect(classifyTurnKind(null)).toBe("question");
    expect(classifyTurnKind(undefined)).toBe("question");
    expect(classifyTurnKind("   ")).toBe("question");
  });

  it("never classifies a long message as an acknowledgement", () => {
    expect(classifyTurnKind(`yes ${"x".repeat(60)}`)).toBe("question");
  });
});

/* ---------------------------------------------------------- queue filters -- */

describe("the feedback queue filters survive a round trip through a URL", () => {
  it("restores everything that was set", () => {
    const filters: FeedbackFilters = {
      status: "in_review",
      outcome: "no",
      rating: 1,
      surface: "spa_engagement",
      search: "DPOA",
      includeHidden: true,
      page: 3,
    };
    expect(
      parseFeedbackFilters(
        Object.fromEntries(new URLSearchParams(serializeFeedbackFilters(filters))),
      ),
    ).toEqual(filters);
  });

  it("omits an unset filter from the query string entirely", () => {
    expect(serializeFeedbackFilters(EMPTY_FEEDBACK_FILTERS)).toBe("");
  });

  it("drops values that are not members of their own vocabulary", () => {
    /*
     * Each is passed to a Postgres function as a typed argument, so a junk
     * value must come back as "no filter" rather than as an error page.
     */
    const parsed = parseFeedbackFilters({
      status: "escalated",
      outcome: "maybe",
      stars: "7",
      surface: "tiktok",
    });
    expect(parsed.status).toBeNull();
    expect(parsed.outcome).toBeNull();
    expect(parsed.rating).toBeNull();
    expect(parsed.surface).toBeNull();
  });

  it("never yields a page below one", () => {
    /*
     * `Number("")` is 0 and `Number("x")` is NaN, and either would become an
     * offset of -25 — which Postgres refuses, turning a mistyped URL into an
     * error page.
     */
    for (const page of ["0", "-4", "x", ""]) {
      expect(parseFeedbackFilters({ page }).page).toBe(1);
    }
    expect(parseFeedbackFilters({ page: "4" }).page).toBe(4);
  });

  it("only shows hidden feedback for exactly \"1\"", () => {
    expect(parseFeedbackFilters({ hidden: "1" }).includeHidden).toBe(true);
    for (const value of ["maybe", "true", "0", ""]) {
      expect(parseFeedbackFilters({ hidden: value }).includeHidden).toBe(false);
    }
  });

  it("does not count paging as an active filter", () => {
    /*
     * Otherwise Reset would appear on page two of an unfiltered queue and
     * "clear the filters" would mean "go back to page one".
     */
    expect(hasActiveFeedbackFilters({ ...EMPTY_FEEDBACK_FILTERS, page: 4 })).toBe(false);
    expect(hasActiveFeedbackFilters({ ...EMPTY_FEEDBACK_FILTERS, status: "pending" })).toBe(
      true,
    );
    expect(hasActiveFeedbackFilters({ ...EMPTY_FEEDBACK_FILTERS, search: "  " })).toBe(
      false,
    );
  });

  it("recognises every surface the product ships and nothing else", () => {
    expect(isActivitySurface("main_chat")).toBe(true);
    expect(isActivitySurface("spa_wellness")).toBe(true);
    expect(isActivitySurface("constructor")).toBe(false);
    expect(isActivitySurface("toString")).toBe(false);
    expect(isActivitySurface(null)).toBe(false);
  });
});
