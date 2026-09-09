import { describe, expect, it } from "vitest";

import {
  chatReportContextFromParams,
  chatReportContextToParams,
  parseChatReportContext,
  REPORT_CONTEXT_LIST_MAX,
  REPORT_CONTEXT_PARAMS,
  REPORT_CONTEXT_TOKEN_MAX,
} from "./chat-report-context";

/**
 * ============================================================================
 * THE CONTEXT IS POINTERS, AND THESE TESTS ARE MOSTLY ABOUT WHAT IT CANNOT DO
 * ============================================================================
 *
 * The value of "Ask Sunny about this report" is not that it is convenient. It
 * is that a manager can press it and the answer is still grounded in what
 * Postgres says rather than in what their browser rendered. That property lives
 * in the SHAPE of this type — there is nowhere to put a figure — so the tests
 * that matter most are the ones asserting a figure cannot get through.
 */

const FULL = {
  family: "bed-usage",
  period: "mtd:2026-08-31",
  window: "mtd",
  salons: ["0123", "0456"],
  districts: ["Cotton, Sarah"],
  metric: "vChain",
  view: "HYDRO",
};

describe("only the five families are accepted", () => {
  it("accepts each of the five", () => {
    for (const family of [
      "sales-totals",
      "salon-performance",
      "bed-usage",
      "spa-wellness",
      "spa-engagement",
    ]) {
      expect(parseChatReportContext({ family })?.family).toBe(family);
    }
  });

  it("returns null for anything else, including a missing family", () => {
    /*
     * NULL RATHER THAN A DEFAULT. A context without a valid family names no
     * rows, so there is nothing for the server to reload and nothing honest to
     * say about it. Defaulting to a family here would mean a malformed link
     * silently briefing on the wrong report.
     */
    expect(parseChatReportContext({})).toBeNull();
    expect(parseChatReportContext({ family: "bonus-viewer" })).toBeNull();
    expect(parseChatReportContext({ family: "sales_totals" })).toBeNull();
    expect(parseChatReportContext({ family: "" })).toBeNull();
    expect(parseChatReportContext(null)).toBeNull();
    expect(parseChatReportContext(undefined)).toBeNull();
    expect(parseChatReportContext("bed-usage")).toBeNull();
    expect(parseChatReportContext(42)).toBeNull();
    expect(parseChatReportContext([])).toBeNull();
  });
});

describe("there is nowhere for a figure to travel", () => {
  it("keeps only the seven pointer fields, whatever else was sent", () => {
    /*
     * THE ASSERTION THAT PROTECTS THE WHOLE FEATURE. A browser sending a
     * grand total, a conversion rate or a salon's tans must find its values
     * simply gone — not ignored-for-now, gone, so that no future server edit
     * has a field sitting there waiting to be trusted.
     */
    const parsed = parseChatReportContext({
      ...FULL,
      grandTotal: 11838.81,
      tans: 1975,
      conversionRate: 0.132,
      values: { ppta: 2.38 },
      figures: [1, 2, 3],
    });

    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed!).sort()).toEqual([
      "districts",
      "family",
      "metric",
      "period",
      "salons",
      "view",
      "window",
    ]);
    expect(JSON.stringify(parsed)).not.toContain("11838");
    expect(JSON.stringify(parsed)).not.toContain("0.132");
  });
});

describe("every pointer is bounded, and a malformed one selects nothing", () => {
  it("trims and keeps a usable token", () => {
    const parsed = parseChatReportContext({ family: "bed-usage", period: "  mtd:2026-08-31 " });
    expect(parsed?.period).toBe("mtd:2026-08-31");
  });

  it("drops a token that is too long rather than truncating it", () => {
    // Truncating would produce a DIFFERENT pointer that might resolve to real
    // rows. Dropping it selects nothing, which is the honest outcome.
    const parsed = parseChatReportContext({
      family: "bed-usage",
      period: "x".repeat(REPORT_CONTEXT_TOKEN_MAX + 1),
    });
    expect(parsed?.period).toBeNull();
  });

  it("drops a non-string token", () => {
    const parsed = parseChatReportContext({
      family: "bed-usage",
      period: 20260831,
      metric: { code: "vChain" },
      view: true,
    });
    expect(parsed?.period).toBeNull();
    expect(parsed?.metric).toBeNull();
    expect(parsed?.view).toBeNull();
  });

  it("accepts a single string where a list is expected", () => {
    // Next's `searchParams` gives a string for a single occurrence and an array
    // for a repeated one; both have to work.
    expect(parseChatReportContext({ family: "bed-usage", salons: "0123" })?.salons).toEqual([
      "0123",
    ]);
  });

  it("drops unusable entries from a list rather than the whole list", () => {
    const parsed = parseChatReportContext({
      family: "bed-usage",
      salons: ["0123", "", null, 456, "x".repeat(200), "0789"],
    });
    expect(parsed?.salons).toEqual(["0123", "0789"]);
  });

  it("caps a list far above any real selection", () => {
    const parsed = parseChatReportContext({
      family: "bed-usage",
      salons: Array.from({ length: REPORT_CONTEXT_LIST_MAX + 50 }, (_, i) => `s${i}`),
    });
    expect(parsed?.salons).toHaveLength(REPORT_CONTEXT_LIST_MAX);
    // Far above the fifteen a delivery carries: the cap bounds a hand-made
    // request, it does not constrain a real one.
    expect(REPORT_CONTEXT_LIST_MAX).toBeGreaterThan(100);
  });

  it("defaults every optional pointer to null or empty, never to a guess", () => {
    const parsed = parseChatReportContext({ family: "spa-wellness" });
    expect(parsed).toEqual({
      family: "spa-wellness",
      period: null,
      window: null,
      salons: [],
      districts: [],
      metric: null,
      view: null,
    });
  });
});

describe("the URL round trip", () => {
  it("survives a full context intact", () => {
    const context = parseChatReportContext(FULL)!;
    const round = chatReportContextFromParams(chatReportContextToParams(context));
    expect(round).toEqual(context);
  });

  it("repeats the parameter for a list instead of joining it", () => {
    /*
     * THE COMMA IS NOT AN OPTION. District and region values in these reports
     * are MANAGER NAMES written surname-first — "Cotton, Sarah" — so every one
     * of them contains a comma. A joined list parses back into halves that
     * match nothing, the filter comes back empty, and the dashboard silently
     * widens to every salon. `bed-spa/filter-state.ts` records the same bug.
     */
    const params = chatReportContextToParams(parseChatReportContext(FULL)!);
    expect(params.getAll(REPORT_CONTEXT_PARAMS.district)).toEqual(["Cotton, Sarah"]);
    expect(params.getAll(REPORT_CONTEXT_PARAMS.salon)).toEqual(["0123", "0456"]);

    const round = chatReportContextFromParams(params);
    expect(round?.districts).toEqual(["Cotton, Sarah"]);
  });

  it("omits an absent pointer rather than writing an empty parameter", () => {
    const params = chatReportContextToParams(parseChatReportContext({ family: "bed-usage" })!);
    expect([...params.keys()]).toEqual([REPORT_CONTEXT_PARAMS.family]);
  });

  it("reads nothing from a URL with no report parameter", () => {
    expect(chatReportContextFromParams(new URLSearchParams("q=hello"))).toBeNull();
    expect(chatReportContextFromParams(new URLSearchParams(""))).toBeNull();
  });

  it("preserves a zero-padded salon number", () => {
    // These reports identify a salon by a zero-padded text key; coercing it to
    // a number would select a different salon or none.
    const round = chatReportContextFromParams(
      new URLSearchParams("report=bed-usage&salon=0123&salon=0007"),
    );
    expect(round?.salons).toEqual(["0123", "0007"]);
  });
});
