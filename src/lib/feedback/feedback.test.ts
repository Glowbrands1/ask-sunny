import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { classifyTurnKind, isActivitySurface } from "@/lib/analytics/taxonomy";
import {
  EMPTY_FEEDBACK_FILTERS,
  hasActiveFeedbackFilters,
  parseFeedbackFilters,
  serializeFeedbackFilters,
  statusesFor,
  type FeedbackFilters,
} from "@/lib/analytics/feedback-filters";
import type { ChatMessage } from "@/types";
import { conversationIsRated, conversationRatingTarget } from "./conversation";
import {
  feedbackDraftProblem,
  isFeedbackDraftComplete,
  COMMENT_MAX_LENGTH,
  type FeedbackDraft,
} from "./types";

/**
 * ASK SUNNY FEEDBACK — the rules, tested where they are decided.
 *
 * All pure functions. The rating control, every host and the route all import
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

describe("a feedback draft needs the stars and nothing else", () => {
  it("accepts a draft with a rating, an outcome and a comment", () => {
    expect(feedbackDraftProblem(COMPLETE)).toBeNull();
    expect(isFeedbackDraftComplete(COMPLETE)).toBe(true);
  });

  it("refuses a missing rating", () => {
    expect(feedbackDraftProblem({ ...COMPLETE, rating: null })).toBe(
      "Please choose a star rating.",
    );
  });

  /*
   * ==========================================================================
   * THE OUTCOME AND THE COMMENT ARE OFFERED, NOT DEMANDED
   * ==========================================================================
   *
   * Both were required, and the reasoning — a 1-star with no words is a dead
   * end — was sound for a form people had to fill in before they could ask
   * their next question. Rating is now a passive action nobody has to open, and
   * a required field on a voluntary form is the reason the form is abandoned
   * and the record is nothing at all.
   */
  it("accepts stars alone", () => {
    expect(
      feedbackDraftProblem({ rating: 5, gotWhatNeeded: null, comment: "" }),
    ).toBeNull();
  });

  it("accepts stars with an outcome and no words", () => {
    expect(
      feedbackDraftProblem({ rating: 2, gotWhatNeeded: "no", comment: "" }),
    ).toBeNull();
  });

  it("accepts stars with words and no outcome", () => {
    expect(
      feedbackDraftProblem({ rating: 3, gotWhatNeeded: null, comment: "Nearly." }),
    ).toBeNull();
  });

  it("accepts a comment that is only whitespace, and the store writes null", () => {
    /*
     * Whitespace used to be the cheapest way past a required field. With
     * nothing to get past, it is simply an empty comment — and `saveFeedback`
     * trims it to null rather than storing a row of spaces.
     */
    expect(
      feedbackDraftProblem({ ...COMPLETE, comment: "   \n  " }),
    ).toBeNull();
  });

  it("still reports a too-long comment as too long", () => {
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
      ).toBe("Please choose a star rating.");
    }
  });
});

/* ------------------------------------------------------- the rating target -- */

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

/**
 * ============================================================================
 * WHICH TURN A CONVERSATION'S RATING ATTACHES TO
 * ============================================================================
 *
 * WHAT THIS SUITE REPLACES: `feedbackDueOn`, which answered "is a rating due?"
 * and was consulted by every send path before a question was allowed through.
 * Nothing consults this before sending. It decides one thing — which turn the
 * passive "Rate this conversation" control writes to — and the rules it keeps
 * are the ones that stop a rating landing on nothing or landing twice.
 */
describe("the conversation's rating attaches to one turn", () => {
  it("picks the newest completed, server-recorded answer", () => {
    const target = conversationRatingTarget([question(), answer()]);
    expect(target?.messageId).toBe("msg-a");
    expect(target?.turnId).toBe("11111111-1111-4111-8111-111111111111");
    expect(target?.saved).toBeUndefined();
  });

  it("offers nothing on a thread with no answer in it", () => {
    expect(conversationRatingTarget([])).toBeNull();
    expect(conversationRatingTarget([question()])).toBeNull();
  });

  it("skips a failed turn", () => {
    /*
     * A turn that errored is not an answer, and a rating attached to one would
     * name an `activity_events` row that records a failure rather than a reply.
     */
    expect(
      conversationRatingTarget([
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

  it("skips an answer the server did not record", () => {
    /*
     * No `turnId` means no row to attach a rating to. Analytics is best-effort
     * by design, so this really happens — and the control renders nothing
     * rather than a form that would fail on save.
     */
    expect(
      conversationRatingTarget([question(), answer({ turnId: undefined })]),
    ).toBeNull();
  });

  it("falls back to an older recorded answer when the newest has no turn", () => {
    const thread = [
      question(),
      answer({ id: "old", turnId: "22222222-2222-4222-8222-222222222222" }),
      question(),
      answer({ id: "new", turnId: undefined }),
    ];
    expect(conversationRatingTarget(thread)?.messageId).toBe("old");
  });

  /*
   * ==========================================================================
   * AN EDIT LANDS ON THE ROW THAT ALREADY EXISTS
   * ==========================================================================
   *
   * THE DUPLICATE THIS PREVENTS: rate a conversation, ask two more questions,
   * then change your mind. If the edit attached to the NEWEST turn it would
   * insert a second `ask_sunny_feedback` row — the unique key is
   * (activity_event_id, user_id), so a different event is a different row — and
   * the dashboard would report two opinions where one person had one.
   */
  it("prefers an already-rated turn over a newer unrated one", () => {
    const thread = [
      question(),
      answer({ id: "old", feedback: SAVED }),
      question(),
      answer({ id: "new", turnId: "33333333-3333-4333-8333-333333333333" }),
    ];
    const target = conversationRatingTarget(thread);
    expect(target?.messageId).toBe("old");
    expect(target?.turnId).toBe(SAVED.turnId);
    expect(target?.saved).toEqual(SAVED);
  });

  it("reports a conversation as rated, so nobody is asked about it twice", () => {
    expect(conversationIsRated([question(), answer()])).toBe(false);
    expect(conversationIsRated([question(), answer({ feedback: SAVED })])).toBe(true);
  });

  it("carries what was already said, so the control opens on it", () => {
    const target = conversationRatingTarget([question(), answer({ feedback: SAVED })]);
    expect(target?.saved?.rating).toBe(4);
    expect(target?.saved?.comment).toBe("Good.");
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
    /*
     * STATUS FALLS BACK TO ITS DEFAULT RATHER THAN TO "NO FILTER". The other
     * three have no meaningful default — "no rating filter" is the right
     * reading of a junk rating — but a junk status resolving to "show
     * everything" would silently reinstate the cluttered queue this replaced.
     */
    expect(parsed.status).toBe("open");
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

/* --------------------------------------------- open work is the default --- */

describe("the queue defaults to open work, and closes nothing", () => {
  it("defaults to open rather than every status", () => {
    /*
     * REPORTED: "i want the reviews gone if i resolved them". The queue listed
     * every status, so everything dealt with stayed on the page — and a work
     * queue that never empties is one people stop opening.
     */
    expect(EMPTY_FEEDBACK_FILTERS.status).toBe("open");
    expect(parseFeedbackFilters({}).status).toBe("open");
  });

  it("open means pending and in review, and nothing else", () => {
    expect(statusesFor("open")).toEqual(["pending", "in_review"]);
  });

  it("all means no status filter at all", () => {
    /* Null is what the query reads as "every status". */
    expect(statusesFor("all")).toBeNull();
  });

  it("a single status selects exactly itself", () => {
    for (const status of ["pending", "in_review", "resolved", "dismissed"] as const) {
      expect(statusesFor(status)).toEqual([status]);
    }
  });

  it("keeps the default out of the URL and every other choice in it", () => {
    expect(
      serializeFeedbackFilters({ ...EMPTY_FEEDBACK_FILTERS, status: "open" }),
    ).toBe("");
    expect(
      serializeFeedbackFilters({ ...EMPTY_FEEDBACK_FILTERS, status: "resolved" }),
    ).toBe("status=resolved");
    expect(serializeFeedbackFilters({ ...EMPTY_FEEDBACK_FILTERS, status: "all" })).toBe(
      "status=all",
    );
  });

  it("survives the round trip for every option", () => {
    for (const status of [
      "open",
      "all",
      "pending",
      "in_review",
      "resolved",
      "dismissed",
    ] as const) {
      const filters = { ...EMPTY_FEEDBACK_FILTERS, status };
      expect(
        parseFeedbackFilters(
          Object.fromEntries(new URLSearchParams(serializeFeedbackFilters(filters))),
        ).status,
      ).toBe(status);
    }
  });

  it("falls back to open on a junk status rather than showing everything", () => {
    /*
     * Failing OPEN rather than ALL: a hand-edited URL should land on the working
     * view, not silently reinstate the behaviour that was reported.
     */
    for (const junk of ["escalated", "", "OPEN", "null"]) {
      expect(parseFeedbackFilters({ status: junk }).status).toBe("open");
    }
  });

  it("counts a non-default status as an active filter", () => {
    expect(hasActiveFeedbackFilters(EMPTY_FEEDBACK_FILTERS)).toBe(false);
    expect(
      hasActiveFeedbackFilters({ ...EMPTY_FEEDBACK_FILTERS, status: "resolved" }),
    ).toBe(true);
    expect(hasActiveFeedbackFilters({ ...EMPTY_FEEDBACK_FILTERS, status: "all" })).toBe(
      true,
    );
  });

  it("changes what is LISTED and never what is COUNTED", () => {
    /*
     * THE PROPERTY THAT MAKES THIS SAFE. Resolved feedback leaving the list must
     * not take it out of the averages — a resolved complaint is still a
     * complaint that happened. The summary function takes no status argument at
     * all, so there is nowhere for a list filter to reach it.
     */
    const reads = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations",
        readdirSync(join(process.cwd(), "supabase/migrations"))
          .filter((name) => name.includes("ask_sunny_feedback_reads"))
          .sort()[0],
      ),
      "utf8",
    );
    const summary =
      reads.split("create or replace function public.analytics_feedback_summary")[1]
        ?.split("$$;")[0] ?? "";

    expect(summary.length).toBeGreaterThan(0);
    expect(summary).not.toContain("p_status");
    /* And it still counts every status, so the queue depths stay whole. */
    for (const status of ["pending", "in_review", "resolved", "dismissed"]) {
      expect(summary).toContain(`f.status = '${status}'`);
    }
  });

  it("treats an empty status array as no filter rather than as nothing", () => {
    /*
     * An empty queue that looks identical to a finished one is the worse of the
     * two failures, so the SQL reads `cardinality = 0` as "everything".
     */
    const migration = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations",
        readdirSync(join(process.cwd(), "supabase/migrations"))
          .filter((name) => name.includes("feedback_list_open_by_default"))
          .sort()[0],
      ),
      "utf8",
    );
    expect(migration).toContain("cardinality(p_statuses) > 0");
    expect(migration).toContain("f.status = any (p_statuses)");
    /*
     * AND THE DEPRECATED SINGLE VALUE IS STILL HONOURED, which is what makes
     * this migration safe to apply BEFORE the deploy: the build currently in
     * production passes `p_status` and keeps working unchanged. Without it,
     * applying and deploying become a coordinated pair and one of the two
     * orders breaks the Feedback tab for the length of a build.
     */
    expect(migration).toContain("p_status    public.feedback_status default null");
    expect(migration).toContain("then f.status = p_status");
    /*
     * And the old single-value signature is dropped rather than left standing:
     * two overloads reachable through defaults fail with "function is not
     * unique" at read time, on a live dashboard.
     */
    expect(migration).toContain("drop function if exists public.analytics_feedback_list");
  });
});
