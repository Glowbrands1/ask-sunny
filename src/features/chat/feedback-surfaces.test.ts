import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ACTIVITY_SURFACES } from "@/lib/analytics/taxonomy";

/**
 * ============================================================================
 * FEEDBACK REACHES EVERY ASK SUNNY SURFACE
 * ============================================================================
 *
 * Nine places in this application can answer a question. The brief's first
 * requirement is that EVERY one of them collects feedback, and the failure this
 * suite exists to catch is the quiet one: a tenth surface added next quarter
 * that draws an ask bar, answers questions, and never asks how it did.
 *
 * ASSERTED AGAINST THE SOURCE rather than by rendering nine screens, because
 * what matters is a property of every host — including the one somebody adds
 * next month — and a DOM test only covers the hosts it was written for. The
 * behaviour of the control itself is proved once, in
 * `answer-feedback.dom.test.tsx`; this proves it is wired up everywhere.
 *
 * THE THREE RENDER HOSTS. `AnswerSheet` draws the answer for the Overview band,
 * all five report tabs and the Google Reviews bar; `MessageBubble` draws it in
 * the chat tab; the Sales Totals panel draws its own. Those three, plus the
 * send paths that gate on feedback, are the whole surface area.
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
  { file: "src/features/reviews/reviews-screen.tsx", surface: "google_reviews" },
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
  "src/features/dashboard/answer-sheet.tsx",
  "src/features/chat/message-bubble.tsx",
  "src/features/reports/sales-totals/ask-sunny-panel.tsx",
];

describe("every render host draws the shared feedback panel", () => {
  it.each(RENDER_HOSTS)("%s mounts AnswerFeedback", (file) => {
    const source = code(read(file));
    expect(source).toContain("<AnswerFeedback");
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
        /import \{ AnswerFeedback \} from "(@\/features\/chat\/answer-feedback|\.\/answer-feedback)"/,
      );
    }
  });
});

/* -------------------------------------------------------------- the gate -- */

const GATED = [
  "src/features/chat/chat-screen.tsx",
  "src/features/chat/use-inline-ask.ts",
  "src/features/reports/sales-totals/ask-sunny-panel.tsx",
];

describe("every send path gates the next question on the previous answer", () => {
  it.each(GATED)("%s refuses to send while feedback is due", (file) => {
    const source = code(read(file));
    /*
     * The two hosts that hold a `ChatMessage` thread use the shared predicate;
     * the Sales Totals panel holds its own transcript of a different shape and
     * applies the same rule to it, which is asserted by name below.
     */
    expect(source).toMatch(/feedbackDueOn|blocked/);
  });

  it("uses one shared predicate rather than three opinions about the rule", () => {
    for (const file of [
      "src/features/chat/chat-screen.tsx",
      "src/features/chat/use-inline-ask.ts",
    ]) {
      expect(code(read(file))).toContain("feedbackDueOn");
    }
  });

  it("the Sales Totals panel applies the same rule to its own transcript", () => {
    /*
     * It cannot import the predicate — it keeps `SalesTotalsAnalysisResponse`
     * transcripts rather than `ChatMessage` threads, and discards them when the
     * view moves. So the rule is restated in its terms and asserted here:
     * newest answer only, released when there is no turn id to rate.
     */
    const source = code(read("src/features/reports/sales-totals/ask-sunny-panel.tsx"));
    expect(source).toContain("const newest = exchanges[exchanges.length - 1]");
    expect(source).toContain("Boolean(newestTurnId) && !feedback[newestTurnId!]");
    expect(source).toContain("if (busy || blocked) return;");
  });

  it("never blocks anything but sending the next question", () => {
    /*
     * THE BOUNDARY THE BRIEF ASKED FOR, and the one that keeps this from being
     * a product people close rather than rate. Nothing may run on unload, on a
     * route change, or as an inescapable dialog — a manager with a salon
     * waiting on them must always be able to leave.
     */
    for (const file of [...GATED, "src/lib/feedback/gate.ts"]) {
      const source = code(read(file));
      expect(source, `${file} intercepts navigation`).not.toContain("beforeunload");
      expect(source, `${file} blocks unload`).not.toContain("onbeforeunload");
      expect(source, `${file} preventsPageUnload`).not.toContain("returnValue =");
    }
  });
});

/* ------------------------------------------------------- the panel itself -- */

describe("the feedback panel", () => {
  const source = code(read("src/features/chat/answer-feedback.tsx"));

  it("renders nothing without a server-recorded turn", () => {
    /*
     * An answer whose activity insert did not land has nothing to attach a
     * rating to. Rendering a form that would fail on save, with nothing the
     * person could do about it, is worse than rendering none.
     */
    expect(source).toContain("if (!turnId) return null;");
  });

  it("never disables its own save button", () => {
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
