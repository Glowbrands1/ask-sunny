import { describe, expect, it } from "vitest";

import { DEMO_DISTRICTS, DEMO_LOCATIONS, DEMO_REGIONS, areaLabel } from "./locations";
import { authorizedSalonNumbers, salonNumberOf } from "@/lib/reporting/scope/authorized-salons";

/**
 * ============================================================================
 * THE ROSTER IS AN AUTHORIZATION INPUT, SO IT GETS CHECKED LIKE ONE
 * ============================================================================
 *
 * `DEMO_LOCATIONS` keeps a name that stopped being true. It is the ONLY mapping
 * in the codebase from a district or region id to the salons inside it, so when
 * a District Manager's scope is resolved into an allowlist of salon numbers,
 * this file decides the answer. It is also what the non-production record guard
 * matches names against, and what the admin screens offer when somebody is
 * given a scope.
 *
 * A file that decides who sees which salon's figures cannot be a file that
 * anybody hand-edits without a check. These tests are that check.
 *
 * ============================================================================
 * WHAT A STALE ROSTER ACTUALLY DOES — the four cases, and which is dangerous
 * ============================================================================
 *
 *   A SALON-SCOPED USER IS NEVER AFFECTED. `salonNumberOf` parses the number
 *   out of the id (`loc-0306` -> `0306`) and does not consult this file at all,
 *   so a salon-scoped account is right even if the roster is missing that
 *   salon entirely. That is the scope the one non-admin account in the
 *   deployment holds today.
 *
 *   A SALON ADDED AND NOT LISTED IS HIDDEN, not exposed. Its number is absent
 *   from the district's allowlist, so its rows are never read. Wrong, and wrong
 *   in the safe direction.
 *
 *   A SALON CLOSED AND NOT REMOVED IS HARMLESS. The allowlist names a salon
 *   that has no rows; the `in` predicate matches nothing.
 *
 *   A SALON THAT MOVED DISTRICT AND WAS NOT UPDATED IS AN EXPOSURE. The
 *   manager of the district it LEFT keeps seeing it, and the manager of the
 *   district it joined does not. This is the only case where a stale roster
 *   shows somebody figures they should not have, and no test can detect it —
 *   the file is self-consistent and simply disagrees with the world. It is why
 *   the roster needs a named owner, which is a question for the stakeholder.
 *
 * So what IS testable is that the file cannot be internally broken: no district
 * that authorizes nothing, no id that resolves to no salon number, no
 * denormalized label that drifted from the record it copies. Each of those has
 * a silent authorization consequence, and each is exactly what a hand edit
 * produces.
 */

describe("the salon roster as an authorization input", () => {
  it("gives every salon an id the scope resolver can turn into a salon number", () => {
    /*
     * `salonNumberOf` is the whole salon-scope path. An id it cannot parse
     * yields no number, and a scope that yields no numbers is a scope that
     * authorizes NOTHING — a Salon Director locked out of their own salon.
     */
    for (const location of DEMO_LOCATIONS) {
      expect(location.id, `${location.name} has an unparseable id`).toMatch(/^loc-\d{4}$/);
      expect(salonNumberOf(location.id)).toBe(location.id.slice(4));
    }
  });

  it("has no duplicate id, salon number or name", () => {
    /*
     * A duplicate NAME matters as much as a duplicate id: the non-production
     * record guard matches records to the roster by name, and the admin screens
     * offer names for a human to pick a scope from.
     */
    const ids = DEMO_LOCATIONS.map((location) => location.id);
    const numbers = DEMO_LOCATIONS.map((location) => salonNumberOf(location.id));
    const names = DEMO_LOCATIONS.map((location) => location.name.trim().toLowerCase());

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it("points every salon at a district and a region that exist", () => {
    // An unknown districtId does not fail loudly — the district loop simply
    // matches nothing, and the salon silently belongs to no manager.
    const districts = new Set(DEMO_DISTRICTS.map((district) => district.id));
    const regions = new Set(DEMO_REGIONS.map((region) => region.id));

    for (const location of DEMO_LOCATIONS) {
      expect(districts, `${location.name} names an unknown district`).toContain(
        location.districtId,
      );
      expect(regions, `${location.name} names an unknown region`).toContain(location.regionId);
    }
  });

  it("keeps each salon's region agreeing with its district's region", () => {
    /*
     * The two are resolved by SEPARATE loops — a region scope reads
     * `location.regionId` and never goes via the district — so a salon can be
     * in a district belonging to Region A while claiming Region B, and the two
     * scopes would then disagree about who may see it.
     */
    const regionOfDistrict = new Map(
      DEMO_DISTRICTS.map((district) => [district.id, district.regionId]),
    );

    for (const location of DEMO_LOCATIONS) {
      expect(location.regionId, `${location.name} contradicts its district's region`).toBe(
        regionOfDistrict.get(location.districtId),
      );
    }
  });

  it("keeps the denormalized labels equal to the records they copy", () => {
    // Each location carries a COPY of its district and region name. A copy that
    // drifts is what puts one name on a report header and another in the admin
    // screen for the same area.
    const districtName = new Map(DEMO_DISTRICTS.map((d) => [d.id, d.name]));
    const regionName = new Map(DEMO_REGIONS.map((r) => [r.id, r.name]));

    for (const location of DEMO_LOCATIONS) {
      expect(location.districtName).toBe(districtName.get(location.districtId));
      expect(location.regionName).toBe(regionName.get(location.regionId));
    }
  });

  it("leaves no district or region that would authorize nothing", () => {
    /*
     * An area with no salons resolves to an EMPTY allowlist, which the read
     * layer treats as "restricted to nothing" — correct, and it means a manager
     * assigned to it sees a blank report with no explanation. Worth failing a
     * build over rather than discovering in support.
     */
    for (const district of DEMO_DISTRICTS) {
      const members = DEMO_LOCATIONS.filter((l) => l.districtId === district.id);
      expect(members.length, `${district.name} has no salons`).toBeGreaterThan(0);
    }
    for (const region of DEMO_REGIONS) {
      const members = DEMO_LOCATIONS.filter((l) => l.regionId === region.id);
      expect(members.length, `${region.name} has no salons`).toBeGreaterThan(0);
    }
  });

  it("resolves every area id to a name rather than echoing the id", () => {
    // `areaLabel` falls back to the raw id, so a missing record shows a reader
    // `dist-9` where a district name belongs.
    for (const id of [
      ...DEMO_LOCATIONS.map((l) => l.id),
      ...DEMO_DISTRICTS.map((d) => d.id),
      ...DEMO_REGIONS.map((r) => r.id),
    ]) {
      expect(areaLabel(id)).not.toBe(id);
    }
  });

  it("resolves a district scope to exactly that district's salons and no others", () => {
    // The end-to-end claim the rest of this file supports: the roster is what
    // turns an area id into the set of salons whose rows may be read.
    for (const district of DEMO_DISTRICTS) {
      const expected = DEMO_LOCATIONS.filter((l) => l.districtId === district.id)
        .map((l) => salonNumberOf(l.id))
        .sort();

      expect(
        authorizedSalonNumbers({
          level: "district",
          primaryAreaId: district.id,
          alsoCoversAreaIds: [],
        }),
      ).toEqual(expected);
    }
  });

  it("authorizes nothing for an area the roster does not know", () => {
    /*
     * FAIL CLOSED. An empty array means "restricted to nothing", which is not
     * the same as the `null` that means unrestricted — and getting those two
     * the wrong way round would turn an unknown district into full access.
     */
    expect(
      authorizedSalonNumbers({
        level: "district",
        primaryAreaId: "dist-does-not-exist",
        alsoCoversAreaIds: [],
      }),
    ).toEqual([]);
    expect(
      authorizedSalonNumbers({
        level: "region",
        primaryAreaId: "reg-does-not-exist",
        alsoCoversAreaIds: [],
      }),
    ).toEqual([]);
  });

  it("does not consult the roster for a salon scope", () => {
    /*
     * Stated as a test because it is the property that makes a stale roster
     * safe for the account type most likely to have one: a salon-scoped user
     * resolves through the id, not through this file.
     */
    expect(
      authorizedSalonNumbers({
        level: "salon",
        primaryAreaId: "loc-9999",
        alsoCoversAreaIds: [],
      }),
    ).toEqual(["9999"]);
  });
});
