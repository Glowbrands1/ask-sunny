import { describe, expect, it } from "vitest";

import {
  BED_USAGE_LADDER,
  classifyVersusChain,
  classifyVersusPeers,
  isAdvisoryOnlyLevel,
  isReportableFinding,
  PERFORMANCE_BANDS,
  percentDifference,
  percentFromRatio,
  SPA_PEER_LADDER,
} from "./classification";

describe("bed usage classification against the chain", () => {
  it("classifies the four approved bands", () => {
    expect(classifyVersusChain(12)).toBe("outperforming");
    expect(classifyVersusChain(0)).toBe("at_market");
    expect(classifyVersusChain(-5)).toBe("below_market");
    expect(classifyVersusChain(-20)).toBe("significantly_underperforming");
  });

  it("is deterministic on every boundary value", () => {
    /*
     * The approved table states the bands as OVERLAPPING ranges — "≥ +2%",
     * then "-2% to +2%", then "-2% to -8%" — so exactly +2 and exactly -2 each
     * belong to two of them. The ladder resolves that by precedence, and these
     * are the values a rounding step away from flipping a salon's colour.
     */
    expect(classifyVersusChain(2)).toBe("outperforming");
    expect(classifyVersusChain(1.999999)).toBe("at_market");
    expect(classifyVersusChain(-2)).toBe("at_market");
    expect(classifyVersusChain(-2.000001)).toBe("below_market");
    // The final row of the approved table reads "≤ -8%", so exactly -8 is the
    // worst band rather than the one above it.
    expect(classifyVersusChain(-7.999999)).toBe("below_market");
    expect(classifyVersusChain(-8)).toBe("significantly_underperforming");
  });

  it("leaves an absent comparison unclassified rather than negative", () => {
    // The absence of a comparison is not a bad comparison, and colouring it
    // red would invent a finding.
    expect(classifyVersusChain(null)).toBeNull();
    expect(classifyVersusChain(Number.NaN)).toBeNull();
    expect(classifyVersusChain(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("spa classification against installed peers", () => {
  it("classifies the four approved bands, which are wider than bed usage's", () => {
    expect(classifyVersusPeers(25)).toBe("outperforming");
    expect(classifyVersusPeers(0)).toBe("at_market");
    expect(classifyVersusPeers(-8)).toBe("below_market");
    expect(classifyVersusPeers(-30)).toBe("significantly_underperforming");
  });

  it("is deterministic on every boundary value", () => {
    expect(classifyVersusPeers(10)).toBe("outperforming");
    expect(classifyVersusPeers(9.999999)).toBe("at_market");
    expect(classifyVersusPeers(-5)).toBe("at_market");
    expect(classifyVersusPeers(-5.000001)).toBe("below_market");
    expect(classifyVersusPeers(-14.999999)).toBe("below_market");
    expect(classifyVersusPeers(-15)).toBe("significantly_underperforming");
  });

  it("does not share the bed usage thresholds", () => {
    // -8% is Below Market for spa and Significantly Underperforming for beds.
    // One shared ladder would have to be wrong about one of them.
    expect(classifyVersusPeers(-8)).toBe("below_market");
    expect(classifyVersusChain(-8)).toBe("significantly_underperforming");
    expect(BED_USAGE_LADDER).not.toEqual(SPA_PEER_LADDER);
  });

  it("leaves an absent comparison unclassified", () => {
    expect(classifyVersusPeers(null)).toBeNull();
  });
});

describe("converting the source's v Chain ratio", () => {
  it("turns a multiple into a percentage difference", () => {
    // Read as a percentage, the workbook's 2.0258 would say "+2%,
    // outperforming" about a salon running at twice the chain.
    expect(percentFromRatio(2.0258250307717316)).toBeCloseTo(102.5825, 4);
    expect(percentFromRatio(0.964809767796795)).toBeCloseTo(-3.519, 3);
    expect(percentFromRatio(1)).toBe(0);
  });

  it("treats a ratio of zero as a real answer", () => {
    // No usage against a chain that has some is -100%, not missing.
    expect(percentFromRatio(0)).toBe(-100);
  });

  it("refuses a value no well-formed report can produce", () => {
    expect(percentFromRatio(-0.5)).toBeNull();
    expect(percentFromRatio(Number.NaN)).toBeNull();
    expect(percentFromRatio(null)).toBeNull();
    expect(percentFromRatio(undefined)).toBeNull();
  });
});

describe("percentage differences", () => {
  it("computes a difference against a benchmark", () => {
    expect(percentDifference(110, 100)).toBeCloseTo(10, 10);
    expect(percentDifference(200, 500)).toBeCloseTo(-60, 10);
  });

  it("returns null rather than infinity for a zero benchmark", () => {
    // Undefined, not infinite. The caller shows "no comparison".
    expect(percentDifference(50, 0)).toBeNull();
  });

  it("returns null when either side is missing", () => {
    expect(percentDifference(null, 100)).toBeNull();
    expect(percentDifference(100, null)).toBeNull();
    expect(percentDifference(undefined, undefined)).toBeNull();
  });
});

describe("the FAST rule", () => {
  it("identifies FAST as the advisory-only level", () => {
    expect(isAdvisoryOnlyLevel("FAST")).toBe(true);
    expect(isAdvisoryOnlyLevel(" fast ")).toBe(true);
    for (const level of ["FASTER", "FASTEST", "INSTANT", "SUNLESS", "SPA", null, undefined]) {
      expect(isAdvisoryOnlyLevel(level)).toBe(false);
    }
  });

  it("suppresses a FAST shortfall as a finding", () => {
    // FAST removals are intentional and are not a negative KPI.
    expect(isReportableFinding("FAST", "below_market")).toBe(false);
    expect(isReportableFinding("FAST", "significantly_underperforming")).toBe(false);
  });

  it("does not suppress good news about FAST", () => {
    expect(isReportableFinding("FAST", "outperforming")).toBe(true);
    expect(isReportableFinding("FAST", "at_market")).toBe(true);
  });

  it("suppresses nothing for any other level", () => {
    for (const level of ["FASTER", "FASTEST", "INSTANT", "SUNLESS", "SPA"]) {
      expect(isReportableFinding(level, "significantly_underperforming")).toBe(true);
    }
  });

  it("treats an unclassified row as not reportable", () => {
    expect(isReportableFinding("SPA", null)).toBe(false);
  });
});

describe("the band vocabulary", () => {
  it("orders the bands best to worst, with distinct labels", () => {
    expect(PERFORMANCE_BANDS.map((band) => band.id)).toEqual([
      "outperforming",
      "at_market",
      "below_market",
      "significantly_underperforming",
    ]);
    expect(PERFORMANCE_BANDS.map((band) => band.order)).toEqual([1, 2, 3, 4]);
    expect(new Set(PERFORMANCE_BANDS.map((band) => band.label)).size).toBe(4);
  });

  it("uses the approved wording", () => {
    expect(PERFORMANCE_BANDS.map((band) => band.label)).toEqual([
      "Outperforming Peers",
      "At Market",
      "Below Market",
      "Significantly Underperforming",
    ]);
  });
});
