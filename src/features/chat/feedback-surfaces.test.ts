import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ACTIVITY_SURFACES } from "@/lib/analytics/taxonomy";

/**
 * ============================================================================
 * FEEDBACK REACHES EVERY ASK SUNNY SURFACE — AND GATES NONE OF THEM
 * ============================================================================
 *
 * Nine places in this application can answer a question. Two properties have to
 * hold across all of them, and the second one is new:
 *
 *   1. EVERY SURFACE CAN COLLECT A RATING. The failure this catches is the
 *      quiet one — a tenth surface added next quarter that draws an ask bar,
 *      answers questions, and offers no way to say how it did.
 *
 *   2. NO SURFACE REQUIRES ONE. Ask Sunny used to hold the next question until
 *      the last answer was rated, on every send path. In the Forms flow that
 *      was not a nag but a dead end: "Which form do you need?" is an answer, so
 *      the cards under it and the composer beside it were both held until
 *      somebody rated the question they had just been asked. The suite below
 *      exists so that rule cannot come back by accident, on any surface.
 *
 * ASSERTED AGAINST THE SOURCE rather than by rendering nine screens, because
 * what matters is a property of every host — including the one somebody adds
 * next month — and a DOM test only covers the hosts it was written for. The
 * behaviour of the control itself is proved once, in
 * `conversation-rating.dom.test.tsx`; this proves it is wired up everywhere and
 * that nothing waits on it.
 *
 * THE HOSTS. `ChatScreen` draws it under the chat thread; the Overview band,
 * the five report ask bars and the Google Reviews bar draw it under their
 * inline threads; the Sales Totals panel draws its own. One control per
 * conversation, never one per answer.
 */

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

/** Source with its comments removed, so prose cannot satisfy an assertion. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

/* -------------------------------------------------------- the send paths -- */

/**
 * Every place a question can be sent, and the surface it must declare.
 *
 * `useInlineAsk` is not listed: it takes the surface as a required option and
 * has no value of its own, which is the point — its three hosts are below.
 */
const SEND_PATHS: { file: string; surface: string }[] = [
  { file: "src/features/chat/chat-screen.tsx", surface: "main_chat" },
  { file: "src/features/dashboard/ask-band.tsx", surface: "overview" },
  { file: "src/features/reviews/reviews-ask-bar.tsx", surface: "google_reviews" },
  {
    file: "src/app/api/reporting/sales-totals/analyze/route.ts",
    surface: "sales_totals",
  },
];

describe("every send path declares where it is", () => {
  it.each(SEND_PATHS)("$file sends surface $surface", ({ file, surface }) => {
    expect(code(read(file))).toContain(`surface: "${surface}"`);
  });

  it("the five report tabs derive their surface from the family", () => {
    /*
     * A TOTAL MAPPING, not a lookup with a fallback, so a sixth report family
     * is a type error rather than a silent `unknown` on a live dashboard.
     */
    const source = code(read("src/features/reports/ask-sunny-about-report.tsx"));
    expect(source).toContain("surface: SURFACE_FOR_REPORT_FAMILY[context.family]");
  });

  it("useInlineAsk requires a surface rather than defaulting one", () => {
    /*
     * A default would file every future surface under whichever one was
     * convenient the day this was written, and nobody would notice until the
     * chart was wrong.
     */
    const source = code(read("src/features/chat/use-inline-ask.ts"));
    expect(source).toMatch(/surface: ActivitySurface;/);
    expect(source).not.toMatch(/surface\?: ActivitySurface/);
    expect(source).toContain("surface,");
  });

  it("names a real surface in every case", () => {
    for (const { surface } of SEND_PATHS) {
      expect(ACTIVITY_SURFACES as readonly string[]).toContain(surface);
    }
  });
});

/* ------------------------------------------------------ the render hosts -- */

const RENDER_HOSTS = [
  "src/features/chat/chat-screen.tsx",
  "src/features/dashboard/ask-band.tsx",
  "src/features/reports/ask-sunny-about-report.tsx",
  "src/features/reviews/reviews-ask-bar.tsx",
  "src/features/reports/sales-totals/ask-sunny-panel.tsx",
];

describe("every render host draws the shared rating control", () => {
  it.each(RENDER_HOSTS)("%s mounts ConversationRating", (file) => {
    const source = code(read(file));
    expect(source).toContain("<ConversationRating");
    expect(source).toMatch(/turnId=\{/);
  });

  it("uses one component rather than a copy per surface", () => {
    /*
     * A control that differs by surface produces ratings that are not
     * comparable, and the dashboard's whole premise is that a 2 from the Spa
     * Engagement bar means what a 2 from the chat tab means. `useInlineAsk`
     * exists in this codebase because the same mistake was made once with the
     * send path; this is the assertion that stops it being made again.
     */
    for (const file of RENDER_HOSTS) {
      expect(code(read(file))).toMatch(
        /import \{ ConversationRating \} from "(@\/features\/chat\/conversation-rating|\.\/conversation-rating)"/,
      );
    }
  });

  it("draws one control per conversation rather than one per answer", () => {
    /*
     * THE TWO COMPONENTS THAT USED TO DRAW A PANEL PER ANSWER. `AnswerSheet`
     * drew one under every answer on the band, the five report bars and the
     * Google Reviews bar; `MessageBubble` drew one under every answer in the
     * chat thread. A thread of six answers carried six standing demands.
     *
     * Rating belongs to the conversation now, so it is mounted by the hosts
     * that own the thread — and these two must not grow one back.
     */
    for (const file of [
      "src/features/dashboard/answer-sheet.tsx",
      "src/features/chat/message-bubble.tsx",
    ]) {
      const source = code(read(file));
      expect(source, `${file} draws its own rating control`).not.toContain(
        "<ConversationRating",
      );
      expect(source, `${file} still imports the old panel`).not.toContain(
        "AnswerFeedback",
      );
    }
  });
});

/* ----------------------------------------------------------- no gate at all -- */

/**
 * Every file that can send a question, open a form, or draw the composer.
 *
 * The Sales Totals panel is here for the same reason it was in the old suite:
 * it holds its own transcript rather than a `ChatMessage` thread, so it used to
 * restate the gating rule in its own terms — which means it is the one place a
 * gate could come back without anybody importing anything.
 */
const SEND_AND_ACTION_PATHS = [
  "src/features/chat/chat-screen.tsx",
  "src/features/chat/use-inline-ask.ts",
  "src/features/chat/composer.tsx",
  "src/features/chat/message-bubble.tsx",
  "src/features/chat/form-picker.tsx",
  "src/features/chat/context-panel.tsx",
  "src/features/dashboard/ask-band.tsx",
  "src/features/reviews/reviews-ask-bar.tsx",
  "src/features/reports/ask-sunny-about-report.tsx",
  "src/features/reports/sales-totals/ask-sunny-panel.tsx",
];

describe("no send path and no form action waits on a rating", () => {
  it("the gate module is gone rather than merely unused", () => {
    /*
     * A file nobody imports is a file somebody imports again. `feedbackDueOn`
     * and `FEEDBACK_DUE_MESSAGE` were the whole rule; deleting them is what
     * makes "reviews never gate anything" a property of the codebase instead of
     * a convention.
     */
    expect(existsSync(join(process.cwd(), "src/lib/feedback/gate.ts"))).toBe(false);
  });

  it.each(SEND_AND_ACTION_PATHS)("%s consults no feedback state", (file) => {
    const source = code(read(file));

    for (const forbidden of [
      "feedbackDueOn",
      "FEEDBACK_DUE_MESSAGE",
      "feedbackDue",
      "ratingRequired",
      "reviewRequired",
      "pendingReview",
      "mustRate",
    ]) {
      expect(source, `${file} reads ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("nothing is disabled or returned early because of a rating", () => {
    /*
     * THE SHAPES THE GATE ACTUALLY TOOK, named so a re-introduction has to be
     * deliberate: a `blocked` flag threaded into `disabled`, and an early
     * return in a send handler.
     */
    for (const file of SEND_AND_ACTION_PATHS) {
      const source = code(read(file));
      expect(source, `${file} still threads a blocked flag`).not.toMatch(
        /busy \|\| blocked/,
      );
      expect(source, `${file} returns early on feedback`).not.toMatch(
        /if \(feedback[A-Za-z]*\) return/,
      );
    }
  });

  it("the rating target is derived for the control, and gates nothing", () => {
    /*
     * `conversationRatingTarget` replaced `feedbackDueOn`, and the difference
     * is what it is used for: it names the turn a rating attaches to. If a send
     * handler ever consults it, this is the assertion that says so.
     */
    for (const file of [
      "src/features/chat/chat-screen.tsx",
      "src/features/chat/use-inline-ask.ts",
    ]) {
      const source = code(read(file));
      expect(source).toContain("conversationRatingTarget");
      expect(source, `${file} gates a send on the rating target`).not.toMatch(
        /if \(ratingTarget\) return/,
      );
    }
  });

  it("the Sales Totals panel sends on nothing but the in-flight turn", () => {
    /*
     * It cannot import the shared predicate — it keeps
     * `SalesTotalsAnalysisResponse` transcripts rather than `ChatMessage`
     * threads — so the rule is restated in its terms and asserted here.
     */
    const source = code(read("src/features/reports/sales-totals/ask-sunny-panel.tsx"));
    expect(source).toContain("if (busy) return;");
    expect(source).not.toContain("if (busy || blocked) return;");
  });

  it("still blocks nothing on unload or navigation", () => {
    /*
     * THE BOUNDARY THE ORIGINAL BRIEF ASKED FOR, kept now that the rest of the
     * gating is gone. Nothing may run on unload, on a route change, or as an
     * inescapable dialog — a manager with a salon waiting on them must always
     * be able to leave.
     */
    for (const file of [
      ...SEND_AND_ACTION_PATHS,
      "src/features/chat/conversation-rating.tsx",
      "src/lib/feedback/conversation.ts",
    ]) {
      const source = code(read(file));
      expect(source, `${file} intercepts navigation`).not.toContain("beforeunload");
      expect(source, `${file} blocks unload`).not.toContain("onbeforeunload");
      expect(source, `${file} prevents page unload`).not.toContain("returnValue =");
    }
  });
});

/* ------------------------------------------------------ the forms pathway -- */

describe("the forms pathway is reachable without rating anything", () => {
  it("a form card sends its request through the ordinary composer path", () => {
    /*
     * REPORTED: the form cards "have no action tied to them when clicked".
     * They always had one — `onChoose` sends the request as an ordinary turn —
     * and the turn was being dropped by the gate in `send`. The card's contract
     * is asserted here; that `send` no longer drops it is asserted above.
     */
    const picker = code(read("src/features/chat/form-picker.tsx"));
    expect(picker).toContain("onClick={() => onChoose(formRequestPhrase(choice.templateName))}");

    /*
     * THE CARD'S HANDLER IS A COMPOSER CALLBACK, WHICHEVER ONE IS WIRED.
     *
     * `onChooseForm` was added so the next turn can tell a card click from a
     * follow-up chip — a click is a decision about which document, and a
     * proposal that comes back ready then creates itself rather than asking
     * again. Both callbacks send through `send`; what must never appear here
     * is the picker reaching for an API of its own.
     */
    const bubble = code(read("src/features/chat/message-bubble.tsx"));
    expect(bubble).toMatch(/<FormPicker[\s\S]*onChoose=\{onChooseForm \?\? onSuggestion\}/);
    expect(picker).not.toContain("fetch(");
    expect(picker).not.toContain("/api/");

    const screen = code(read("src/features/chat/chat-screen.tsx"));
    expect(screen).toContain("chosenFromPicker.current = true;");
    expect(screen).toContain("void send(phrase);");
  });

  it("'Create a form from this conversation' sends immediately", () => {
    const screen = code(read("src/features/chat/chat-screen.tsx"));
    /*
     * The only thing between the click and the turn is an in-flight check. It
     * used to be that plus the gate, which is why the button appeared dead
     * whenever the previous answer was unrated.
     */
    expect(screen).toContain(
      "const createFormFromConversation = useCallback(() => { if (busy) return; void send(CREATE_FORM_FROM_CONVERSATION); }",
    );
  });
});

/* ------------------------------------------------------- the panel itself -- */

describe("the rating control", () => {
  const source = code(read("src/features/chat/conversation-rating.tsx"));

  it("renders nothing without a server-recorded turn", () => {
    /*
     * An answer whose activity insert did not land has nothing to attach a
     * rating to. Rendering a form that would fail on save, with nothing the
     * person could do about it, is worse than rendering none.
     */
    expect(source).toContain("if (!turnId) return null;");
  });

  it("never disables its own submit button", () => {
    /*
     * A disabled button with no explanation is the commonest accessibility
     * failure in a required form: a screen reader announces nothing and nobody
     * learns what is missing by clicking something that does nothing. It stays
     * enabled and SAYS what is missing.
     */
    expect(source).toContain('role="alert"');
    expect(source).not.toMatch(/disabled=\{[^}]*feedbackDraftProblem/);
  });

  it("uses real radios so the star scale is one choice, not five buttons", () => {
    expect(source).toContain('role="radiogroup"');
    expect(source).toContain('type="radio"');
    /*
     * `sr-only` rather than `hidden` or `display: none`: the latter take the
     * input out of the tab order and the accessibility tree, which is the bug
     * this pattern is usually written with.
     */
    expect(source).toContain('className="sr-only"');
  });

  it("validates with the same predicate the route validates with", () => {
    /*
     * A form that enables its own save by one rule and is refused by another is
     * the worst version of this feature: a person fills everything in and is
     * told they did not.
     */
    expect(source).toContain("feedbackDraftProblem");
    expect(code(read("src/app/api/chat/feedback/route.ts"))).toContain(
      "isFeedbackRating",
    );
  });
});
