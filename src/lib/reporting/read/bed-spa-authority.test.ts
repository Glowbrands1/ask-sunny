import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  FAST_ADVISORY_NOTE,
  PERFORMANCE_BANDS,
  classifyVersusChain,
  classifyVersusPeers,
  isAdvisoryOnlyLevel,
} from "../performance/classification";
import { BED_SPA_BRIEFING_RULES } from "./bed-spa/briefing";
import { aggregateSpaConversion, computeSpaConversion } from "./bed-spa/spa-conversion";
import {
  spaPerUniquePercent,
  spaSessionsPerUniquePerBed,
} from "./bed-spa/spa-engagement-analytics";
import { REPORT_FAMILIES_BY_ID } from "./report-families";

/**
 * ============================================================================
 * THE DAILY STATS FRAMEWORK MAY NOT OVERRULE AN APPROVED BED OR SPA RULE
 * ============================================================================
 *
 * A generic coaching framework now travels on the same prompt as the bed and
 * spa figures, and that creates a specific risk worth designing against: the
 * framework's reasoning is broad and confident, and four of this family's rules
 * are counter-intuitive enough that a model reasoning "sensibly" would break
 * every one of them.
 *
 *   FAST DECLINE IS NOT A FAILURE. FAST units are being removed on purpose, so
 *   a FAST shortfall against the chain is a capacity and volume-migration
 *   signal. "Your worst-performing level is FAST, coach the team on it" is the
 *   obvious wrong answer.
 *
 *   ZERO USAGE MEANS NOT INSTALLED. A salon with no Hydromassage sessions does
 *   not have a Hydromassage. "This salon is underusing its equipment" is the
 *   obvious wrong answer.
 *
 *   PEER COMPARISON IS LIKE-FOR-LIKE. Both sides must have non-zero usage of
 *   the same equipment, or the "peer average" includes salons that do not own
 *   the machine.
 *
 *   ESTATE SPA CONVERSION IS SUMMED, NOT AVERAGED. The mean of per-salon rates
 *   weights a 400-tan salon the same as a 4,000-tan one.
 *
 * WHAT THIS SUITE PROVES. Two things, and both are needed:
 *
 *   THE CALCULATIONS ARE UNCHANGED by any of this milestone's work. The bands,
 *   the FAST exemption and the conversion arithmetic are exercised directly.
 *
 *   THE AUTHORITY IS DECLARED AND SEPARATED. The registry gives these three
 *   families NO reasoning framework and names the approved rule that decides
 *   their numbers instead, and the rules that reach the prompt say the same in
 *   words.
 */

/* ====================================================== the calculations == */

describe("the v-Chain ladder is unchanged", () => {
  it("keeps the four approved bands at the approved boundaries", () => {
    /*
     * >= +2% outperforming, -2% to +2% at market, -2% to -8% below market,
     * <= -8% significantly underperforming. Asserted at the boundaries, because
     * a ladder is only wrong at its edges.
     *
     * THE TWO BOUNDARIES CLOSE DIFFERENTLY, and that is the detail a rewrite
     * would get wrong: +2 and -2 are INCLUSIVE, so exactly -2% is at market,
     * while -8 is EXCLUSIVE, so exactly -8% is significantly underperforming
     * rather than below market. That matches the approved ladder's own reading
     * of "<= -8%".
     */
    expect(classifyVersusChain(5)).toBe("outperforming");
    expect(classifyVersusChain(2)).toBe("outperforming");
    expect(classifyVersusChain(1.9)).toBe("at_market");
    expect(classifyVersusChain(0)).toBe("at_market");
    expect(classifyVersusChain(-2)).toBe("at_market");
    expect(classifyVersusChain(-2.1)).toBe("below_market");
    expect(classifyVersusChain(-7.9)).toBe("below_market");
    expect(classifyVersusChain(-8)).toBe("significantly_underperforming");
    expect(classifyVersusChain(-30)).toBe("significantly_underperforming");
  });

  it("declines to classify a figure it does not have", () => {
    // Null rather than a band. A missing v-Chain is not "at market".
    expect(classifyVersusChain(null)).toBeNull();
    expect(classifyVersusPeers(null)).toBeNull();
    expect(classifyVersusChain(Number.NaN)).toBeNull();
  });

  it("still offers exactly the four bands", () => {
    expect(PERFORMANCE_BANDS).toHaveLength(4);
    expect(PERFORMANCE_BANDS.map((band) => band.id)).toEqual([
      "outperforming",
      "at_market",
      "below_market",
      "significantly_underperforming",
    ]);
  });
});

describe("the FAST rule is unchanged, and it is advisory", () => {
  it("marks FAST as advisory only", () => {
    expect(isAdvisoryOnlyLevel("FAST")).toBe(true);
    expect(isAdvisoryOnlyLevel("fast")).toBe(true);
  });

  it("does not mark any other level advisory", () => {
    for (const level of ["FASTER", "FASTEST", "INSTANT", "SUNLESS", "SPA"]) {
      expect(isAdvisoryOnlyLevel(level), level).toBe(false);
    }
  });

  it("still classifies FAST — the band is computed, the CONCLUSION is withheld", () => {
    /*
     * The distinction that makes this rule usable rather than a blind spot. The
     * figure is real and a manager may want it; what is forbidden is reading it
     * as a shortfall to coach. So the ladder is NOT special-cased for FAST —
     * the level is flagged advisory alongside it.
     */
    expect(classifyVersusChain(-30)).toBe("significantly_underperforming");
    expect(isAdvisoryOnlyLevel("FAST")).toBe(true);
  });

  it("keeps the note that travels with it", () => {
    expect(FAST_ADVISORY_NOTE.toLowerCase()).toContain("intentional");
  });
});

describe("the equipment-presence rule is unchanged", () => {
  it("is enforced where the comparison is BUILT, not in the ladder", () => {
    /*
     * `classifyVersusPeers` takes a percentage difference — by the time a
     * number reaches it, the like-for-like decision has already been made. So
     * the rule lives in `equipmentPerformance`, which is where the peer average
     * is assembled, and this asserts it is stated there.
     */
    const analytics = readFileSync(
      "src/lib/reporting/read/bed-spa/spa-wellness-analytics.ts",
      "utf8",
    );
    expect(analytics).toContain("equipmentPerformance");
    /*
     * The rule is enforced TWICE — at the parser, which writes no zero rows,
     * and again here as defence in depth for a period ingested by an older
     * version. Both averages are over installed salons only.
     */
    expect(analytics).toContain("installed-only rule is enforced twice");
    expect(analytics).toContain("OUR AVERAGE IS OVER OUR INSTALLED SALONS");
  });

  it("keeps the spa peer ladder distinct from the chain ladder", () => {
    /*
     * Spa uses >= +10% / -5% to +10% / -5% to -15% / <= -15%; the chain ladder
     * uses +2% / -2% / -8%. They are different ladders on purpose, and
     * collapsing them into one would move every spa classification.
     */
    expect(classifyVersusPeers(10)).toBe("outperforming");
    expect(classifyVersusPeers(5)).toBe("at_market");
    expect(classifyVersusPeers(-5)).toBe("at_market");
    expect(classifyVersusPeers(-10)).toBe("below_market");
    expect(classifyVersusPeers(-14.9)).toBe("below_market");
    expect(classifyVersusPeers(-15)).toBe("significantly_underperforming");

    /*
     * THE PROOF THEY ARE TWO LADDERS. At +5% the chain ladder says
     * outperforming and the peer ladder says at market. One ladder could not
     * give both answers.
     */
    expect(classifyVersusChain(5)).toBe("outperforming");
    expect(classifyVersusPeers(5)).toBe("at_market");
    expect(classifyVersusChain(5)).not.toBe(classifyVersusPeers(5));
  });
});

describe("Spa Conversion Rate is summed at every aggregated level", () => {
  const AUGUST = {
    grain: "mtd" as const,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    labelRaw: "Aug 2026",
    periodId: "p-aug",
  };

  /** One salon's conversion, through the real function. */
  const conversion = (salonNumber: string, spaSessions: number, totalTans: number) =>
    computeSpaConversion({
      salonNumber,
      spaSessions,
      totalTans,
      trafficPeriod: AUGUST,
      spaPeriod: AUGUST,
    });

  it("divides sessions by tans for one salon", () => {
    const big = conversion("0001", 100, 4000);
    expect(big.available).toBe(true);
    expect(big.available && big.rate).toBeCloseTo(0.025, 6);

    const small = conversion("0002", 100, 400);
    expect(small.available && small.rate).toBeCloseTo(0.25, 6);
  });

  it("sums both sides across salons rather than averaging their rates", () => {
    /*
     * THE ARITHMETIC THAT MAKES THIS RULE MATTER. Summed: 200 / 4400 = 4.5%.
     * The mean of the two rates is (2.5% + 25%) / 2 = 13.75% — more than three
     * times higher, and it comes from weighting a 400-tan salon exactly like a
     * 4,000-tan one.
     */
    const parts = [conversion("0001", 100, 4000), conversion("0002", 100, 400)];
    const aggregated = aggregateSpaConversion(parts);

    expect(aggregated.available).toBe(true);
    expect(aggregated.available && aggregated.rate).toBeCloseTo(200 / 4400, 6);

    const meanOfRates = (0.025 + 0.25) / 2;
    expect(aggregated.available && aggregated.rate).not.toBeCloseTo(meanOfRates, 3);
    expect(meanOfRates).toBeGreaterThan(
      (aggregated.available ? aggregated.rate : 0) * 2,
    );
  });

  it("refuses a rate it cannot compute rather than returning zero", () => {
    /*
     * Zero would be a business finding — "this salon converts nobody" — where
     * the truth is that a figure is missing. Each refusal carries its own
     * reason so a banner can say which.
     */
    expect(conversion("0001", 100, 0)).toMatchObject({
      available: false,
      reason: "traffic_zero",
    });
    expect(
      computeSpaConversion({
        salonNumber: "0001",
        spaSessions: null,
        totalTans: 400,
        trafficPeriod: AUGUST,
        spaPeriod: AUGUST,
      }),
    ).toMatchObject({ available: false, reason: "sessions_missing" });
    expect(
      computeSpaConversion({
        salonNumber: null,
        spaSessions: 100,
        totalTans: 400,
        trafficPeriod: AUGUST,
        spaPeriod: AUGUST,
      }),
    ).toMatchObject({ available: false, reason: "salon_unresolved" });
  });

  it("refuses across mismatched periods, for the whole view rather than per salon", () => {
    /*
     * A conversion computed across mismatched periods is wrong for EVERY
     * salon, so the period check runs first and no per-salon detail could
     * rescue it. This is the live case in the supplied deliveries: Bed Usage
     * covers August and the engagement report covers a single day in September.
     */
    const september = { ...AUGUST, periodStart: "2026-09-01", periodEnd: "2026-09-01" };
    expect(
      computeSpaConversion({
        salonNumber: "0001",
        spaSessions: 100,
        totalTans: 400,
        trafficPeriod: AUGUST,
        spaPeriod: september,
      }),
    ).toMatchObject({ available: false, reason: "period_mismatch" });
  });
});

describe("the two spa ratios stay different measures", () => {
  it("uses different denominators, so neither can stand in for the other", () => {
    /*
     * Spa Per Unique % is spa uniques over total uniques. Spa Sessions per
     * Unique Tanner per Spa Bed divides sessions by uniques and then by beds.
     * Collapsing them is the reporting mistake this family is most prone to,
     * because both are "spa per unique something".
     */
    /*
     * THE MODULE'S OWN WORKED EXAMPLE, so this test and the code agree about
     * what the two measures are: NE Grand Island on 1 September 2026 — 33
     * sessions, 74 unique tanners, 4 spa beds.
     *
     * Spa Per Unique % is 0.446. Sessions per Unique per Bed is 0.1115.
     * Labelling the second as the first reports a store converting 45% of its
     * customers as converting 11%, which is the exact sentence the two-measure
     * rule exists to prevent.
     */
    const perUnique = spaPerUniquePercent(33, 74);
    const perUniquePerBed = spaSessionsPerUniquePerBed(33, 74, 4);

    expect(perUnique).toBeCloseTo(0.446, 3);
    expect(perUniquePerBed).toBeCloseTo(0.1115, 4);

    // A quarter of the size on the same inputs: an error, not a rounding.
    expect(perUniquePerBed).toBeCloseTo((perUnique as number) / 4, 6);
    expect(perUnique).not.toBeCloseTo(perUniquePerBed as number, 2);
  });

  it("declares both, separately, in the catalog", () => {
    const metrics = REPORT_FAMILIES_BY_ID["spa-engagement"].metrics;
    expect(metrics).toContain("spa_per_unique_percent");
    expect(metrics).toContain("spa_sessions_per_unique_per_bed");
  });
});

/* ======================================================== the authority == */

describe("the framework shapes the action and the code decides the number", () => {
  it("applies the manager reasoning model to these three as well", () => {
    /*
     * THE CORRECTION THIS SUITE WAS WRONG ABOUT FIRST TIME. It asserted these
     * families had NO reasoning framework, which protected their formulas by
     * declaring something false: a manager asking why Spa is weak needs the
     * signal-to-behaviour-to-coaching model exactly as much as one asking about
     * revenue. What must not happen is the framework touching the numbers, and
     * that is the next three tests rather than this one.
     */
    for (const id of ["bed-usage", "spa-wellness", "spa-engagement"] as const) {
      expect(REPORT_FAMILIES_BY_ID[id].actionFramework, id).toBe(
        "daily_stats_interpretation_framework",
      );
    }
  });

  it("gives the metric authority to code, and the code is named", () => {
    expect(REPORT_FAMILIES_BY_ID["bed-usage"].metricAuthority).toContain(
      "performance/classification.ts",
    );
    expect(REPORT_FAMILIES_BY_ID["spa-wellness"].metricAuthority).toContain(
      "spa-wellness-analytics.ts",
    );
    expect(REPORT_FAMILIES_BY_ID["spa-engagement"].metricAuthority).toContain(
      "spa-conversion.ts",
    );
  });

  it("never names the framework as a metric authority, for any family", () => {
    /*
     * NO DUPLICATE AUTHORITY. If the framework appeared on either side of this
     * line there would be two answers to "what is this number", and the looser
     * one wins the moment they disagree.
     */
    for (const id of ["bed-usage", "spa-wellness", "spa-engagement"] as const) {
      expect(
        REPORT_FAMILIES_BY_ID[id].metricAuthority.toLowerCase(),
        id,
      ).not.toContain("framework");
    }
  });
});

describe("the action layer is instructed without being told a single rule", () => {
  const reasoning = readFileSync("src/lib/ai/prompts.ts", "utf8");
  const contract = reasoning.slice(
    reasoning.indexOf("export const DAILY_STATS_REASONING"),
    reasoning.indexOf("export const MANAGER_ANSWER_SHAPE"),
  );

  it("makes the report sections' own classifications final", () => {
    /*
     * THE INSTRUCTION THAT LETS THE FRAMEWORK APPLY SAFELY. Bed Usage says
     * FASTEST is outperforming and FAST is capacity-advisory; the model quotes
     * both exactly and reasons about the implication. Without this it would
     * re-band the figures it was given, because a generic reasoner has no
     * reason not to.
     */
    expect(contract).toContain("CLASSIFICATIONS ARE FINAL");
    expect(contract).toContain("Quote it as it stands");
    expect(contract).toContain("Do not re-derive it, re-band it, average it, soften it");
    expect(contract).toContain("the ACTION, not the arithmetic");
  });

  it("treats a withheld conclusion as the finding, not as a gap to fill", () => {
    /*
     * Covers the advisory marker, the not-installed zero and the unclassified
     * comparison in one generic rule — none of them named, all of them
     * protected. "Your worst level is the advisory one, coach it" is the answer
     * this prevents.
     */
    expect(contract).toContain("ALREADY WITHHELD A CONCLUSION HAS DECIDED THAT");
    expect(contract).toContain("Never turn one into a shortfall to coach");
    expect(contract).toContain("never describe it as underperformance");
  });

  it("says what the framework DOES add, and that it adds it to every report", () => {
    expect(contract).toContain("WHAT YOU ADD TO A CLASSIFIED FIGURE");
    for (const verb of ["inspect", "coach", "role-play", "follow up", "recognising"]) {
      expect(contract, verb).toContain(verb);
    }
    expect(contract).toContain("applies to every report equally");
  });

  it("explains in its own header why it names nothing", () => {
    /*
     * So the next person to "helpfully" paste the FAST rule in here reads the
     * argument against it first.
     *
     * Comment markers and line wrapping are normalised away, because the
     * sentence being asserted is prose that reflows whenever the file is
     * reformatted — pinning its line breaks would make a formatting change look
     * like a policy change.
     */
    const header = reasoning
      .slice(
        reasoning.indexOf("IT NAMES NO METRIC, NO BAND AND NO FORMULA"),
        reasoning.indexOf("export const DAILY_STATS_REASONING"),
      )
      .replace(/^\s*\*\s?/gm, "")
      .replace(/\s+/g, " ");

    expect(header).toContain("two statements of one rule is two authorities");
    expect(header).toContain("the looser one wins the moment they disagree");
    // And it names the four rules it is protecting WITHOUT stating any of them.
    expect(header).toContain("deliberate capacity decision rather than a failure");
    expect(header).toContain("a zero that means the equipment was never installed");
    expect(header).toContain("only valid like-for-like");
    expect(header).toContain("summed rather than averaged");
  });
});

describe("the rules that reach the prompt keep the family-specific ones in force", () => {
  it("states the FAST exemption in words, not just in code", () => {
    expect(BED_SPA_BRIEFING_RULES).toContain(FAST_ADVISORY_NOTE);
    expect(BED_SPA_BRIEFING_RULES).toContain(
      "Never present a FAST shortfall as a failure",
    );
  });

  it("states the equipment-presence rule", () => {
    expect(BED_SPA_BRIEFING_RULES).toContain("NOT INSTALLED");
    expect(BED_SPA_BRIEFING_RULES).toContain(
      "Never describe a salon as underusing equipment it does not have",
    );
  });

  it("states that the two spa ratios are different measures", () => {
    expect(BED_SPA_BRIEFING_RULES).toContain("DIFFERENT measures with different denominators");
    expect(BED_SPA_BRIEFING_RULES).toContain("never treat one as the other");
  });

  it("bars computing a new ratio from the figures given", () => {
    /*
     * Which is what stops a model averaging the per-salon conversion rates it
     * can see into an estate figure the data does not support.
     */
    expect(BED_SPA_BRIEFING_RULES).toContain("Do not compute a new ratio");
  });
});

describe("the Daily Stats layer is scoped to action, not to arithmetic", () => {
  const reasoning = readFileSync("src/lib/ai/prompts.ts", "utf8");

  it("tells the model to reason only from measures that are present", () => {
    expect(reasoning).toContain("REASON ONLY FROM MEASURES THAT ARE ACTUALLY PRESENT");
    expect(reasoning).toContain("If a measure is not in the report data, you do not have it");
  });

  it("never restates a band, a threshold or a formula", () => {
    /*
     * THE STRUCTURAL GUARD. If the Daily Stats rules ever quoted a percentage
     * boundary or a formula, there would be two authorities for one number and
     * the prompt would contain its own contradiction. The reasoning block is
     * about signal, behaviour, coaching and follow-up — and nothing else.
     */
    const contract = reasoning.slice(
      reasoning.indexOf("export const DAILY_STATS_REASONING"),
      reasoning.indexOf("export const MANAGER_ANSWER_SHAPE"),
    );
    for (const forbidden of [
      "+2%",
      "-2%",
      "-8%",
      "+10%",
      "-5%",
      "-15%",
      "divided by",
      "SUM(",
      "conversion rate =",
    ]) {
      expect(contract, `the reasoning contract must not restate "${forbidden}"`).not.toContain(
        forbidden,
      );
    }
  });

  it("does not mention FAST, spa equipment installation or peer averages at all", () => {
    // Those are the bed and spa family's own rules, and they travel with their
    // own block. A second, looser statement of them is how one gets softened.
    const contract = reasoning.slice(
      reasoning.indexOf("export const DAILY_STATS_REASONING"),
      reasoning.indexOf("export const MANAGER_ANSWER_SHAPE"),
    );
    for (const term of ["FAST", "NOT INSTALLED", "peer average", "v Chain"]) {
      expect(contract, `the reasoning contract must not discuss "${term}"`).not.toContain(term);
    }
  });

  it("keeps both rule blocks on the prompt together, each stating its own scope", () => {
    /*
     * They coexist rather than one replacing the other: the bed/spa block says
     * what the figures mean, the Daily Stats block says what to do about them.
     * `report-briefing.ts` places both, and neither is conditional on the other.
     */
    const composer = readFileSync("src/lib/reporting/read/report-briefing.ts", "utf8");
    expect(composer).toContain("sections.push(bedSpa.text)");
    expect(composer).toContain("The block brings its own rules with it");
  });
});
