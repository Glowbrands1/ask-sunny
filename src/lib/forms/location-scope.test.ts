import { describe, expect, it } from "vitest";

import { authorizeLocation, authorizedSalonIds, proposeLocation } from "./location-scope";
import type { AccessScope } from "@/types";

/**
 * ============================================================================
 * REQUIREMENTS 18–26 — WHICH SALON A FORM MAY NAME
 * ============================================================================
 *
 * THE GAP. `POST /api/forms/instances` accepted `locationId` and `locationName`
 * from the request body and stored them unchecked. The authenticated identity
 * carried an `AccessScope` the whole time; `authorizeForms` dropped it. Nothing
 * compared the salon on a disciplinary record against the salons the person
 * filing it actually covers.
 *
 * THE PART THAT LOOKS LIKE A BUG AND IS NOT. A district or regional manager is
 * REFUSED, not accepted-and-flagged. Their `primaryAreaId` is a district id and
 * no salon roster exists, so "is this salon in your district?" has no truthful
 * answer today. An accepted-but-unverified salon reads exactly like a verified
 * one to everybody who opens the record later, and the record outlives the
 * caveat.
 */

const salon = (primary: string | null, also: string[] = []): AccessScope => ({
  level: "salon",
  primaryAreaId: primary,
  alsoCoversAreaIds: also,
});

describe("18. a salon-scoped actor's authorized set is their own assignment", () => {
  it("is the primary area plus everything they also cover, de-duplicated", () => {
    expect(authorizedSalonIds(salon("loc-0101", ["loc-0102", "loc-0101"]))).toEqual([
      "loc-0101",
      "loc-0102",
    ]);
  });

  it("is empty for any scope level that is not a salon", () => {
    // A district id is not a salon id, and treating it as one would authorize a
    // salon that does not exist.
    for (const level of ["district", "region", "global"] as const) {
      expect(
        authorizedSalonIds({ level, primaryAreaId: "dist-01", alsoCoversAreaIds: [] }),
        level,
      ).toEqual([]);
    }
  });
});

describe("19. a salon on the actor's own assignment is authorized", () => {
  it.each([
    ["primary", salon("loc-0101"), "loc-0101"],
    ["also covers", salon("loc-0101", ["loc-0102"]), "loc-0102"],
  ])("%s", (_name, scope, requested) => {
    expect(authorizeLocation(scope, requested)).toEqual({
      kind: "authorized",
      locationId: requested,
    });
  });
});

describe("20. a salon they are not assigned to is REFUSED", () => {
  it("refuses, and does not quietly drop the salon instead", () => {
    const result = authorizeLocation(salon("loc-0101"), "loc-0999");

    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.reason).toMatch(/not one you are assigned to/i);
    // Never echoes the requested id back: it came from the caller, and naming
    // it confirms nothing while making the message noisier.
    expect(result.reason).not.toContain("loc-0999");
  });

  it("refuses a salon-shaped id that happens to look plausible", () => {
    // A valid-looking id is not an authorized one — the same lesson as the
    // knowledge corpus. Shape is not authority.
    expect(authorizeLocation(salon("loc-0101"), "loc-0102").kind).toBe("refused");
  });
});

describe("21. district and regional actors FAIL CLOSED", () => {
  it.each(["district", "region"] as const)("%s is refused, not accepted-and-flagged", (level) => {
    const result = authorizeLocation(
      { level, primaryAreaId: `${level}-01`, alsoCoversAreaIds: [] },
      "loc-0101",
    );

    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.reason).toMatch(/cannot yet verify/i);
  });

  it("does not authorize the district's own area id as if it were a salon", () => {
    expect(authorizeLocation(
      { level: "district", primaryAreaId: "dist-01", alsoCoversAreaIds: [] },
      "dist-01",
    ).kind).toBe("refused");
  });
});

describe("22. a global actor is not restricted by scope", () => {
  it("is authorized, because that is what global means", () => {
    expect(
      authorizeLocation(
        { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] },
        "loc-0101",
      ),
    ).toEqual({ kind: "authorized", locationId: "loc-0101" });
  });
});

describe("23. no location requested is not a refusal", () => {
  it.each([null, undefined, "", "   "])("%p", (requested) => {
    expect(authorizeLocation(salon("loc-0101"), requested)).toEqual({ kind: "no_location" });
  });
});

describe("24. a demo actor has no scope, so nothing is enforced against them", () => {
  it("is authorized, and that is stated rather than hidden", () => {
    /*
     * A scope the browser asserted about itself is not a security control.
     * Enforcing against one would be theatre and would break preview QA for
     * nothing; the demo screens already carry the standing synthetic-data
     * notice. `null` means "not enforced".
     */
    expect(authorizeLocation(null, "loc-0999")).toEqual({
      kind: "authorized",
      locationId: "loc-0999",
    });
  });
});

/* ================================================ what chat may fill in == */

describe("25. proposing a salon is narrower than authorizing one", () => {
  it("fills in exactly one authorized salon", () => {
    expect(proposeLocation(salon("loc-0101"))).toEqual({
      resolution: "resolved",
      locationId: "loc-0101",
    });
  });

  it("asks when there is more than one, rather than picking", () => {
    expect(proposeLocation(salon("loc-0101", ["loc-0102"]))).toEqual({
      resolution: "needs_selection",
      authorizedIds: ["loc-0101", "loc-0102"],
    });
  });

  it("fills in nothing for a salon account with no assignment", () => {
    const result = proposeLocation(salon(null));
    expect(result.resolution).toBe("unavailable");
  });

  it.each(["district", "region"] as const)("fills in nothing for a %s manager", (level) => {
    const result = proposeLocation({
      level,
      primaryAreaId: `${level}-01`,
      alsoCoversAreaIds: [],
    });
    expect(result.resolution).toBe("unavailable");
  });

  it("says a salon does not APPLY to a global actor, rather than asking for one", () => {
    /*
     * This asserted `needs_selection` with an empty list, and that one shape
     * made inline creation unreachable for every global account: not `ready`,
     * so no create action, and a question about a salon with nothing to pick.
     *
     * "No salon to fill in" is not "a missing answer" for somebody who is not
     * assigned to a salon — and `authorizeLocation` already permits them a form
     * that names none. Inventing one is still refused; there is no roster.
     */
    const result = proposeLocation({
      level: "global",
      primaryAreaId: null,
      alsoCoversAreaIds: [],
    });

    expect(result.resolution).toBe("not_applicable");
    expect(result.resolution === "not_applicable" && result.reason).toMatch(
      /covers every salon/i,
    );
  });

  it("fills in nothing in preview mode", () => {
    expect(proposeLocation(null).resolution).toBe("unavailable");
  });
});

describe("26. no salon id is ever invented", () => {
  it("returns only ids that came from the authenticated scope", () => {
    const scopes: (AccessScope | null)[] = [
      null,
      salon(null),
      salon("loc-0101"),
      salon("loc-0101", ["loc-0102"]),
      { level: "district", primaryAreaId: "dist-01", alsoCoversAreaIds: [] },
      { level: "region", primaryAreaId: "reg-01", alsoCoversAreaIds: [] },
      { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] },
    ];

    for (const scope of scopes) {
      const result = proposeLocation(scope);
      const produced =
        result.resolution === "resolved"
          ? [result.locationId]
          : result.resolution === "needs_selection"
            ? result.authorizedIds
            : [];
      const fromScope = scope ? authorizedSalonIds(scope) : [];
      for (const id of produced) expect(fromScope, JSON.stringify(scope)).toContain(id);
    }
  });
});
