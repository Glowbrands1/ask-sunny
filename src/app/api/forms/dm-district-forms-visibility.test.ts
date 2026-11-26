import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PRODUCTION_DISTRICTS, PRODUCTION_REGIONS, PRODUCTION_SALONS } from "@/data/salons";
import type { AccessScope } from "@/types";

/**
 * ============================================================================
 * A DISTRICT MANAGER SEES THE FORMS THEIR SALONS' MANAGERS FILE
 * ============================================================================
 *
 * Pau, 25 Nov 2026: "are Dms able to see the forms that their managers are
 * submitting?" — and, told the code had no district-to-salon map, "there is in
 * sunny though?" / "i need this in sunny please".
 *
 * There is: `PRODUCTION_SALONS` (`src/data/salons.ts`) puts every salon in its
 * district and region, and Reporting already reads a district scope through it
 * (`reporting/scope/authorized-salons.ts`). Forms did not: a `district` or
 * `region` scope set in User Management named no salon, so a DM read only the
 * salons Woven assigns them, and could not FILE a form against any salon at
 * all ("Ask Sunny cannot yet verify which salons are in your district").
 *
 * Now a district scope reads, and files against, every salon of that district
 * on the roster, and a region scope every salon of that region. A stored
 * `global` scope still grants nothing beyond Woven (every account carries it),
 * and a district the roster does not know names no salon: fails closed.
 *
 * The salons are taken from the roster rather than typed here, so the test
 * names no real manager and survives a roster change.
 */

const ORIGINAL = { ...process.env };

const DISTRICT = PRODUCTION_DISTRICTS[0]!;
const IN_DISTRICT = PRODUCTION_SALONS.filter((salon) => salon.districtId === DISTRICT.id).map((salon) => salon.id);
const OUTSIDE_DISTRICT = PRODUCTION_SALONS.filter((salon) => salon.districtId !== DISTRICT.id).map((salon) => salon.id);
const REGION = PRODUCTION_REGIONS[0]!;
const IN_REGION = PRODUCTION_SALONS.filter((salon) => salon.regionId === REGION.id).map((salon) => salon.id);

const DM_SCOPE: AccessScope = { level: "district", primaryAreaId: DISTRICT.id, alsoCoversAreaIds: [] };
const RM_SCOPE: AccessScope = { level: "region", primaryAreaId: REGION.id, alsoCoversAreaIds: [] };
const GLOBAL: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

/** No designation row, no Woven person: only the stored scope (or the roster's name) can grant a salon. */
function mockNoWovenNoDesignation(account: { email: string; display_name: string } | null = null) {
  vi.doMock("@/lib/supabase/server", () => ({
    getSupabaseAdmin: () => ({
      from: (table: string) => {
        const builder = {
          select: () => builder,
          eq: () => builder,
          in: () => builder,
          is: () => builder,
          limit: async () => ({ data: [], error: null }),
          maybeSingle: async () => ({ data: table === "app_users" ? account : null, error: null }),
        };
        return builder;
      },
    }),
  }));
}

async function load(account: { email: string; display_name: string } | null = null) {
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  vi.resetModules();
  mockNoWovenNoDesignation(account);
  const { pageFormsAccess } = await import("@/lib/forms/page-scope");
  const { actorMaySeeInstance } = await import("@/lib/forms/instance-scope");
  const { authorizeLocation, authorizedSalonIds, proposeLocation } = await import("@/lib/forms/location-scope");
  return { pageFormsAccess, actorMaySeeInstance, authorizeLocation, authorizedSalonIds, proposeLocation };
}

const identity = (subject: string, role: string, scope: AccessScope) => ({
  subject,
  role: role as never,
  scope,
  verified: true,
  email: "x@example.com",
  displayName: "X",
});

/** A form filed by one of the salon's own managers — never by the DM reading it. */
const formAt = (locationId: string) =>
  ({
    id: `form-${locationId}`,
    templateKey: "coaching",
    locationId,
    createdBy: "the-salon-manager",
    createdByRole: "salon_director",
    status: "finalized",
  }) as never;

beforeEach(() => vi.resetModules());
afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.doUnmock("@/lib/supabase/server");
  vi.resetModules();
});

describe("the roster this rests on", () => {
  it("has a district with salons inside it and salons outside it", () => {
    expect(IN_DISTRICT.length).toBeGreaterThan(0);
    expect(OUTSIDE_DISTRICT.length).toBeGreaterThan(0);
  });
});

describe("are Dms able to see the forms that their managers are submitting?", () => {
  it("a DM with a district scope reads every salon of the district: Form Monitoring, the Overview queue, the badge and the chat", async () => {
    const { pageFormsAccess } = await load();
    const access = await pageFormsAccess(identity("dm", "district_manager", DM_SCOPE) as never);
    expect(access.noSalon).toBe(false);
    expect([...(access.locationIds ?? [])].sort()).toEqual([...IN_DISTRICT].sort());
  });

  it("sees a form a salon manager filed at each salon of the district, and none at a salon outside it", async () => {
    const { pageFormsAccess, actorMaySeeInstance } = await load();
    const { actor } = await pageFormsAccess(identity("dm", "district_manager", DM_SCOPE) as never);
    for (const id of IN_DISTRICT) expect(actorMaySeeInstance(actor, formAt(id)), id).toBe(true);
    for (const id of OUTSIDE_DISTRICT) expect(actorMaySeeInstance(actor, formAt(id)), id).toBe(false);
  });

  it("a Regional Manager with a region scope reads every salon of the region", async () => {
    const { pageFormsAccess } = await load();
    const access = await pageFormsAccess(identity("rm", "regional_manager", RM_SCOPE) as never);
    expect([...(access.locationIds ?? [])].sort()).toEqual([...IN_REGION].sort());
  });

  it("a stored global scope still grants no salon (every account carries it)", async () => {
    const { pageFormsAccess } = await load();
    const access = await pageFormsAccess(identity("dm", "district_manager", GLOBAL) as never);
    expect(access).toMatchObject({ locationIds: [], noSalon: true });
  });

  it("a district the roster does not know names no salon: fails closed, never to all", async () => {
    const { pageFormsAccess } = await load();
    const unknown: AccessScope = { level: "district", primaryAreaId: "dist-not-on-roster", alsoCoversAreaIds: [] };
    const access = await pageFormsAccess(identity("dm", "district_manager", unknown) as never);
    expect(access).toMatchObject({ locationIds: [], noSalon: true });
  });

  it("an extra salon an admin adds to a district scope is read too", async () => {
    const { pageFormsAccess } = await load();
    const extra = OUTSIDE_DISTRICT[0]!;
    const scope: AccessScope = { ...DM_SCOPE, alsoCoversAreaIds: [extra] };
    const access = await pageFormsAccess(identity("dm", "district_manager", scope) as never);
    expect(access.locationIds).toContain(extra);
    expect(access.locationIds).toContain(IN_DISTRICT[0]);
  });
});

describe("she should though: a DM left on \"whole company\" reads the district the roster names her on", () => {
  /** The account of the person the roster names on the district, from the roster's own "Last, First". */
  const [last, first] = DISTRICT.name.split(",").map((part) => part.trim());
  const manager = { email: `${first}.${last}@example.com`, display_name: first! };

  it("Form Monitoring, the queue, the badge and the chat read every salon of her district, with no setting changed", async () => {
    const { pageFormsAccess } = await load(manager);
    const access = await pageFormsAccess(identity("dm", "district_manager", GLOBAL) as never);
    expect([...(access.locationIds ?? [])].sort()).toEqual([...IN_DISTRICT].sort());
  });

  it("a DM the roster does not name still reads nothing extra", async () => {
    const { pageFormsAccess } = await load({ email: "someone.else@example.com", display_name: "Someone" });
    const access = await pageFormsAccess(identity("dm", "district_manager", GLOBAL) as never);
    expect(access).toMatchObject({ locationIds: [], noSalon: true });
  });

  it("a Salon Director with a matching name is not widened", async () => {
    const { pageFormsAccess } = await load(manager);
    const access = await pageFormsAccess(identity("sd", "salon_director", GLOBAL) as never);
    expect(access).toMatchObject({ locationIds: [], noSalon: true });
  });
});

describe("a DM files forms against the salons of their district", () => {
  it("authorizes a salon in the district and refuses one outside it", async () => {
    const { authorizeLocation } = await load();
    expect(authorizeLocation(DM_SCOPE, IN_DISTRICT[0]!)).toEqual({ kind: "authorized", locationId: IN_DISTRICT[0] });
    expect(authorizeLocation(DM_SCOPE, OUTSIDE_DISTRICT[0]!).kind).toBe("refused");
  });

  it("the chat asks which of the district's salons, instead of saying the district cannot be verified", async () => {
    const { proposeLocation } = await load();
    const proposal = proposeLocation(DM_SCOPE, "");
    if (IN_DISTRICT.length === 1) {
      expect(proposal).toEqual({ resolution: "resolved", locationId: IN_DISTRICT[0] });
    } else {
      expect(proposal.resolution).toBe("needs_selection");
      expect([...(proposal as { authorizedIds: string[] }).authorizedIds].sort()).toEqual([...IN_DISTRICT].sort());
    }
  });

  it("a district the roster does not know still files against nothing", async () => {
    const { authorizeLocation } = await load();
    const unknown: AccessScope = { level: "district", primaryAreaId: "dist-not-on-roster", alsoCoversAreaIds: [] };
    expect(authorizeLocation(unknown, IN_DISTRICT[0]!).kind).toBe("refused");
  });
});
