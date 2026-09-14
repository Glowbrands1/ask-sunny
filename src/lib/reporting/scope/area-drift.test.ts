import { beforeEach, describe, expect, it, vi } from "vitest";

import { districtIdOf, regionIdOf } from "./area-ids";

/**
 * ============================================================================
 * THE FAILURE MODE: A SALON MOVES DISTRICT AND THE CHECKED-IN FILE DOES NOT
 * ============================================================================
 *
 * This is the one kind of staleness that fails OPEN rather than closed, and it
 * is why district and region scopes stopped resolving through the roster.
 *
 * The old shape: `authorizedSalonNumbers` iterated the checked-in roster to
 * find a district's members. Reporting moves salon 0495 from Cotton to
 * Patterson; nobody edits the file; the Cotton manager keeps matching 0495 and
 * keeps receiving its protected rows. No test over the file could catch it —
 * the file is internally consistent and simply disagrees with production.
 *
 * The new shape, pinned here: membership comes from `salon_period_attributes`,
 * so the move takes effect with the delivery that carries it.
 */

interface Row {
  period_id: string;
  district_label: string | null;
  region_label: string | null;
  salons: { salon_number: string } | null;
}

let rows: Row[] = [];
let failQuery = false;

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = self;
      chain.is = self;
      chain.order = () => chain;
      chain.then = (resolve: (r: { data: unknown; error: unknown }) => unknown) =>
        resolve(
          failQuery
            ? { data: null, error: { message: "connection refused" } }
            : { data: rows, error: null },
        );
      return chain;
    },
  }),
}));

const { areaSalonNumbersFromReporting } = await import("./reporting-areas");

function row(period: string, salonNumber: string, district: string): Row {
  return {
    period_id: period,
    district_label: district,
    region_label: "Patterson, Madeline",
    salons: { salon_number: salonNumber },
  };
}

beforeEach(() => {
  failQuery = false;
  rows = [];
});

describe("a salon that moved district", () => {
  it("stops being reachable by the district it LEFT", async () => {
    /*
     * Two periods for 0495: the newer one has it under Patterson, the older
     * under Cotton. Rows arrive newest-first, as the query orders them.
     */
    rows = [
      row("2026-09", "0495", "Patterson, Madeline"),
      row("2026-08", "0495", "Cotton, Sarah"),
      row("2026-09", "0313", "Cotton, Sarah"),
    ];

    const cotton = await areaSalonNumbersFromReporting("district", [
      districtIdOf("Cotton, Sarah"),
    ]);

    // The exposure this closes: 0495 must NOT still be Cotton's.
    expect(cotton).not.toContain("0495");
    expect(cotton).toEqual(["0313"]);
  });

  it("becomes reachable by the district it JOINED, with no deploy", async () => {
    rows = [
      row("2026-09", "0495", "Patterson, Madeline"),
      row("2026-08", "0495", "Cotton, Sarah"),
      row("2026-09", "0306", "Patterson, Madeline"),
    ];

    const patterson = await areaSalonNumbersFromReporting("district", [
      districtIdOf("Patterson, Madeline"),
    ]);

    expect(patterson).toEqual(["0306", "0495"]);
  });

  it("takes the CURRENT period, never a union across periods", async () => {
    // A union would hand the old district the salon forever, which is the bug.
    rows = [
      row("2026-09", "0495", "Patterson, Madeline"),
      row("2026-07", "0495", "Cotton, Sarah"),
      row("2026-06", "0495", "Dugan, Rachael"),
    ];

    expect(await areaSalonNumbersFromReporting("district", [districtIdOf("Cotton, Sarah")])).toEqual([]);
    expect(await areaSalonNumbersFromReporting("district", [districtIdOf("Dugan, Rachael")])).toEqual([]);
    expect(
      await areaSalonNumbersFromReporting("district", [districtIdOf("Patterson, Madeline")]),
    ).toEqual(["0495"]);
  });
});

describe("every way this can go wrong fails CLOSED", () => {
  it("returns nothing — not the roster, not everything — when the query fails", async () => {
    /*
     * THE MOST IMPORTANT ONE. Falling back to the checked-in roster on an error
     * would reinstate the exposure at the least observable moment. An empty
     * allowlist means an empty report, which somebody notices and reports.
     */
    rows = [row("2026-09", "0306", "Patterson, Madeline")];
    failQuery = true;

    const result = await areaSalonNumbersFromReporting("district", [
      districtIdOf("Patterson, Madeline"),
    ]);

    expect(result).toEqual([]);
  });

  it("returns nothing for a district that no longer exists under that name", async () => {
    rows = [row("2026-09", "0306", "Patterson, Madeline")];

    expect(await areaSalonNumbersFromReporting("district", ["dist-district-1"])).toEqual([]);
    expect(await areaSalonNumbersFromReporting("district", ["dist-does-not-exist"])).toEqual([]);
  });

  it("returns nothing for an empty assignment", async () => {
    rows = [row("2026-09", "0306", "Patterson, Madeline")];

    expect(await areaSalonNumbersFromReporting("district", [])).toEqual([]);
  });

  it("never returns null, because null means unrestricted", async () => {
    /*
     * The contract that must not blur: `null` is unrestricted and belongs to a
     * global scope decided before this runs. An area lookup returning null
     * would turn a district manager into an administrator.
     */
    failQuery = true;
    const result = await areaSalonNumbersFromReporting("region", [
      regionIdOf("Patterson, Madeline"),
    ]);

    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("area ids are derived, not looked up", () => {
  it("slugs the label reporting actually reports", () => {
    expect(districtIdOf("Patterson, Madeline")).toBe("dist-patterson-madeline");
    expect(districtIdOf("Cotton, Sarah")).toBe("dist-cotton-sarah");
    expect(regionIdOf("Patterson, Madeline")).toBe("reg-patterson-madeline");
  });

  it("is stable across spacing and case, so a tidied label still matches", () => {
    expect(districtIdOf("  patterson,   madeline  ")).toBe("dist-patterson-madeline");
  });

  it("keeps districts and regions in separate namespaces", () => {
    // The same person runs a district and the region. Their ids must differ, or
    // a district scope would silently widen to the region.
    expect(districtIdOf("Patterson, Madeline")).not.toBe(regionIdOf("Patterson, Madeline"));
  });
});
