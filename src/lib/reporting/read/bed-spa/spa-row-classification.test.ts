import { describe, expect, it } from "vitest";

import {
  equipmentPerformance,
  equipmentRowPerformance,
  isSmallPeerSample,
  smallPeerSampleNote,
  SMALL_PEER_SAMPLE_MAX,
} from "./spa-wellness-analytics";
import { worstPeerBandBySalon } from "./combined";
import type {
  SpaEquipmentBenchmarkRow,
  SpaEquipmentTypeRow,
  SpaEquipmentUseRow,
} from "./types";

/**
 * ============================================================================
 * THE REGRESSION THIS FILE EXISTS FOR
 * ============================================================================
 *
 * The stakeholder review of 14 September reported, from the live Spa Wellness
 * tab: "the status appears to be applied by equipment type instead of by
 * individual row", with two examples — a Beauty Shaper 127% ABOVE its peers
 * reading SIGNIFICANTLY UNDER, and a Poly RLT 76% BELOW its peers reading AT
 * MARKET. Both were true: the table computed each row's own delta and then took
 * the badge from the ESTATE's classification of that equipment type.
 *
 * The fixtures below reproduce exactly that shape — one equipment type, two
 * salons on opposite sides of the peer average, an estate average that lands in
 * a third band — because a test built from rows that happen to agree would pass
 * against the broken implementation.
 */

const TYPES: SpaEquipmentTypeRow[] = [
  {
    code: "poly_rlt",
    label: "Poly Red Light Therapy",
    shortLabel: "Poly RLT",
    isComparable: true,
    displayOrder: 1,
  },
  {
    code: "beauty_shaper",
    label: "Beauty Shaper",
    shortLabel: "Beauty Shaper",
    isComparable: true,
    displayOrder: 2,
  },
  {
    code: "other",
    label: "Other",
    shortLabel: "Other",
    isComparable: false,
    displayOrder: 99,
  },
];

const BENCHMARKS: SpaEquipmentBenchmarkRow[] = [
  {
    equipmentCode: "poly_rlt",
    chainSalonCount: 200,
    chainAverageSessions: 100,
    peerSalonCount: 185,
    peerAverageSessions: 100,
  },
  {
    equipmentCode: "beauty_shaper",
    chainSalonCount: 40,
    chainAverageSessions: 50,
    peerSalonCount: 38,
    peerAverageSessions: 50,
  },
  {
    // One peer salon: the Rejuve shape the review flagged.
    equipmentCode: "rejuve",
    chainSalonCount: 2,
    chainAverageSessions: 30,
    peerSalonCount: 1,
    peerAverageSessions: 30,
  },
];

function use(
  storeName: string,
  equipmentCode: string,
  sessions: number,
): SpaEquipmentUseRow {
  return {
    salonNumber: null,
    storeName,
    equipmentCode,
    sessions,
    firstUseDate: null,
    lastUseDate: null,
  };
}

describe("a row classifies on its own delta, not its equipment type's", () => {
  /*
   * Peer average 100. Omaha 144th ran 24 sessions — 76% below, the review's own
   * figure. Lincoln O Street ran 300 — 200% above. The ESTATE average across
   * the two is 162, which is +62% and classifies "outperforming": so if either
   * row took the type-level band, the under-performing one would read as
   * outperforming. That is the defect, inverted, and it must not pass.
   */
  const rows: SpaEquipmentUseRow[] = [
    use("NE Omaha 144th and Center", "poly_rlt", 24),
    use("NE Lincoln O Street", "poly_rlt", 300),
  ];

  it("puts two salons with the SAME equipment in DIFFERENT bands", () => {
    const classified = equipmentRowPerformance(TYPES, rows, BENCHMARKS);

    expect(classified).toHaveLength(2);
    expect(classified[0].versusPeers.deltaPercent).toBeCloseTo(-76, 6);
    expect(classified[0].versusPeers.band).toBe("significantly_underperforming");

    expect(classified[1].versusPeers.deltaPercent).toBeCloseTo(200, 6);
    expect(classified[1].versusPeers.band).toBe("outperforming");

    // The whole point: same equipment code, different verdicts.
    expect(classified[0].equipmentCode).toBe(classified[1].equipmentCode);
    expect(classified[0].versusPeers.band).not.toBe(classified[1].versusPeers.band);
  });

  it("does not inherit the estate's band for the type", () => {
    const estate = equipmentPerformance(TYPES, rows, BENCHMARKS);
    const polyEstate = estate.find((entry) => entry.equipmentCode === "poly_rlt")!;
    // The estate reads outperforming, because its average is 162 against 100.
    expect(polyEstate.versusPeers.band).toBe("outperforming");

    const classified = equipmentRowPerformance(TYPES, rows, BENCHMARKS);
    // And the salon at -76% does NOT take that band.
    expect(classified[0].versusPeers.band).not.toBe(polyEstate.versusPeers.band);
  });

  it("reproduces the review's Beauty Shaper case: above peers is never 'under'", () => {
    // 127% above a peer average of 50 is 113.5 sessions.
    const classified = equipmentRowPerformance(
      TYPES,
      [use("MO St Joseph", "beauty_shaper", 113.5)],
      BENCHMARKS,
    );
    expect(classified[0].versusPeers.deltaPercent).toBeCloseTo(127, 6);
    expect(classified[0].versusPeers.band).toBe("outperforming");
  });

  it("returns one entry per input row, in input order", () => {
    const classified = equipmentRowPerformance(TYPES, rows, BENCHMARKS);
    expect(classified.map((entry) => entry.storeName)).toEqual(
      rows.map((row) => row.storeName),
    );
  });

  it("withholds a comparison for the uncomparable bucket and for a missing peer", () => {
    const classified = equipmentRowPerformance(
      TYPES,
      [use("KS Lawrence", "other", 40), use("KS Lawrence", "unmapped", 40)],
      BENCHMARKS,
    );
    expect(classified[0].versusPeers.band).toBeNull();
    expect(classified[0].versusPeers.unavailableReason).toContain("Other");
    expect(classified[1].versusPeers.band).toBeNull();
    expect(classified[1].versusPeers.unavailableReason).toContain("no peer average");
  });
});

describe("the combined view's per-salon band", () => {
  /*
   * The review: "The Combined Operational View marks all 15 salons as
   * SIGNIFICANTLY UNDER". That happened because every salon was handed the
   * type's band. With per-row classification the two salons below must differ.
   */
  it("differs between salons that run the same machine differently", () => {
    const classified = equipmentRowPerformance(
      TYPES,
      [
        use("NE Omaha 144th and Center", "poly_rlt", 24),
        use("NE Lincoln O Street", "poly_rlt", 300),
      ],
      BENCHMARKS,
    );

    const bands = worstPeerBandBySalon(
      classified.map((row) => ({
        storeName: row.storeName,
        band: row.versusPeers.band,
        reportableFinding: row.versusPeers.reportableFinding,
      })),
    );

    expect(bands["NE Omaha 144th and Center"]).toBe("significantly_underperforming");
    expect(bands["NE Lincoln O Street"]).toBe("outperforming");
  });

  it("still takes the WORST of a salon's own units", () => {
    const classified = equipmentRowPerformance(
      TYPES,
      [
        use("KS Overland Park", "poly_rlt", 300),
        use("KS Overland Park", "beauty_shaper", 20),
      ],
      BENCHMARKS,
    );
    const bands = worstPeerBandBySalon(
      classified.map((row) => ({
        storeName: row.storeName,
        band: row.versusPeers.band,
        reportableFinding: row.versusPeers.reportableFinding,
      })),
    );
    // 20 against 50 is -60%: the worse of the two, and the one that shows.
    expect(bands["KS Overland Park"]).toBe("significantly_underperforming");
  });
});

describe("small peer samples are marked rather than silently trusted", () => {
  it("flags a benchmark drawn from one or two salons", () => {
    expect(isSmallPeerSample(1)).toBe(true);
    expect(isSmallPeerSample(2)).toBe(true);
    expect(isSmallPeerSample(SMALL_PEER_SAMPLE_MAX + 1)).toBe(false);
    expect(isSmallPeerSample(185)).toBe(false);
  });

  it("does not flag the ABSENCE of a peer group as a small one", () => {
    // Zero peers is "no comparison", which the band already reports as null.
    expect(isSmallPeerSample(0)).toBe(false);
    expect(isSmallPeerSample(null)).toBe(false);
  });

  it("carries the peer count on every classified row", () => {
    const classified = equipmentRowPerformance(
      TYPES,
      [use("MO Kansas City Wornall", "rejuve", 45)],
      BENCHMARKS,
    );
    expect(classified[0].peerSalonCount).toBe(1);
    expect(isSmallPeerSample(classified[0].peerSalonCount)).toBe(true);
    expect(smallPeerSampleNote(1)).toContain("1 peer salon");
  });

  it("states the count in the note so the reader can weigh it", () => {
    expect(smallPeerSampleNote(2)).toContain("2 peer salons");
  });
});
