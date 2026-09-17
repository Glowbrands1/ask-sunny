import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PRODUCTION_SALONS, salonByNumber } from "@/data/salons";
import {
  ALLOWED_STORE_CODES,
  GOOGLE_REVIEW_LOCATIONS,
  isAllowedStoreCode,
  listingsNeedingVerification,
  locationForStoreCode,
  salonForStoreCode,
  STORE_CODE_PATTERN,
} from "./store-codes";

/**
 * THE ALLOWLIST EXISTS IN THREE RUNTIMES, AND THIS IS WHAT KEEPS THEM HONEST.
 *
 * TypeScript (the API route), SQL (the seed behind the foreign key) and plain
 * JavaScript (the browser extension) each need the list and none can import the
 * others. So the other two are read here AS TEXT and compared. A salon added to
 * one and forgotten in another is a failing test rather than a location that
 * quietly stops importing and is noticed a month later when somebody asks why
 * KS Lawrence has no reviews.
 *
 * The same technique `analytics.test.ts` already uses to keep the activity
 * enums in step with their migration.
 */

const repoRoot = process.cwd();

function readRepoFile(...parts: string[]): string {
  return readFileSync(join(repoRoot, ...parts), "utf8");
}

const migration = readRepoFile(
  "supabase",
  "migrations",
  "20260917002000_google_reviews.sql",
);
const extensionList = readRepoFile("extension", "store-codes.js");

/** The `('314', '0468', …)` rows of the migration's seed. */
function seededPairs(): { storeCode: string; salonNumber: string }[] {
  const seed = migration.split("insert into public.google_review_locations")[1] ?? "";
  return [...seed.matchAll(/\('(\d{1,8})',\s*'(\d{3,4})',/g)].map((match) => ({
    storeCode: match[1],
    salonNumber: match[2],
  }));
}

describe("the fifteen Google listings", () => {
  it("holds exactly fifteen store codes, each distinct", () => {
    expect(GOOGLE_REVIEW_LOCATIONS).toHaveLength(15);
    expect(new Set(ALLOWED_STORE_CODES).size).toBe(15);
  });

  it("maps every store code to a salon that exists in the production roster", () => {
    for (const entry of GOOGLE_REVIEW_LOCATIONS) {
      const salon = salonByNumber(entry.salonNumber);
      expect(salon, `store code ${entry.storeCode} names salon ${entry.salonNumber}`)
        .toBeDefined();
    }
  });

  it("covers every salon in the roster exactly once", () => {
    /*
     * FIFTEEN LISTINGS FOR FIFTEEN SALONS. A salon with two listings would be
     * double-counted in every weekly total; a salon with none would silently
     * never appear on the dashboard.
     */
    const mapped = GOOGLE_REVIEW_LOCATIONS.map((entry) => entry.salonNumber).sort();
    const roster = PRODUCTION_SALONS.map((salon) => salon.salonNumber).sort();
    expect(mapped).toEqual(roster);
  });

  it("every store code is digits only, as Google writes them", () => {
    for (const code of ALLOWED_STORE_CODES) {
      expect(STORE_CODE_PATTERN.test(code)).toBe(true);
    }
  });
});

describe("a store code is not a salon number", () => {
  /*
   * THE TRAP THIS WHOLE MODULE EXISTS FOR. Google's 306 is KS Manhattan; ASK
   * Sunny's 0306 is MO Kansas City Wornall. Zero-padding a store code compiles,
   * runs, and files three salons' reviews against the wrong salons — with
   * nothing on the dashboard looking broken.
   */
  const knownCollisions = [
    { storeCode: "306", googleSalon: "KS Manhattan", paddedWouldGive: "MO Kansas City Wornall" },
    { storeCode: "307", googleSalon: "KS Shawnee Mission Pkwy", paddedWouldGive: "NE Grand Island" },
    { storeCode: "314", googleSalon: "KS Lawrence", paddedWouldGive: "NE Omaha 144th and Center" },
  ];

  it.each(knownCollisions)(
    "store code $storeCode is $googleSalon, and padding it would give $paddedWouldGive",
    ({ storeCode, googleSalon, paddedWouldGive }) => {
      expect(salonForStoreCode(storeCode)?.name).toBe(googleSalon);
      /* The mistake, demonstrated rather than described. */
      expect(salonByNumber(`0${storeCode}`)?.name).toBe(paddedWouldGive);
    },
  );

  it("resolves store code 306 to KS Manhattan and its real district", () => {
    const salon = salonForStoreCode("306");
    expect(salon?.salonNumber).toBe("0462");
    expect(salon?.name).toBe("KS Manhattan");
    /* The district comes from the existing roster, never invented here. */
    expect(salon?.districtName).toBe("Patterson, Madeline");
  });
});

describe("the allowlist refuses everything else", () => {
  it("accepts a listed code and rejects an unlisted one", () => {
    expect(isAllowedStoreCode("306")).toBe(true);
    /* Buff City Soap and every other business on the same Google account. */
    expect(isAllowedStoreCode("881")).toBe(false);
    expect(isAllowedStoreCode("999")).toBe(false);
    expect(isAllowedStoreCode("")).toBe(false);
    expect(isAllowedStoreCode(undefined)).toBe(false);
  });

  it("does not accept a zero-padded salon number as a store code", () => {
    expect(isAllowedStoreCode("0306")).toBe(false);
    expect(locationForStoreCode("0306")).toBeUndefined();
  });
});

describe("the two listings Google marks as needing verification", () => {
  it("names KS Lawrence and MO Kansas City Wornall, and keeps both", () => {
    const flagged = listingsNeedingVerification();
    expect(flagged.map((entry) => entry.storeCode).sort()).toEqual(["140", "314"]);
    /*
     * KEPT, NOT REMOVED. A Google verification problem is a fact about the
     * listing; both salons are trading and stay in the roster, the leaderboard
     * and every total.
     */
    for (const entry of flagged) {
      expect(ALLOWED_STORE_CODES).toContain(entry.storeCode);
      expect(salonByNumber(entry.salonNumber)).toBeDefined();
    }
  });
});

describe("the three copies of the list agree", () => {
  it("matches the migration's seed, store code for store code", () => {
    const seeded = seededPairs();
    expect(seeded).toHaveLength(15);

    const fromSql = [...seeded].sort((a, b) => a.storeCode.localeCompare(b.storeCode));
    const fromTs = [...GOOGLE_REVIEW_LOCATIONS]
      .map((entry) => ({ storeCode: entry.storeCode, salonNumber: entry.salonNumber }))
      .sort((a, b) => a.storeCode.localeCompare(b.storeCode));

    expect(fromSql).toEqual(fromTs);
  });

  it("matches the migration on which listings need verification", () => {
    const seed = migration.split("insert into public.google_review_locations")[1] ?? "";
    const flaggedInSql = [
      ...seed.matchAll(/\('(\d{1,8})',\s*'\d{3,4}',[^)]*'verification_required'\)/g),
    ]
      .map((match) => match[1])
      .sort();

    expect(flaggedInSql).toEqual(
      listingsNeedingVerification()
        .map((entry) => entry.storeCode)
        .sort(),
    );
  });

  it("matches the extension's copy", () => {
    const block = extensionList.split("ALLOWED_STORE_CODES = Object.freeze([")[1] ?? "";
    const codes = [...block.split("]);")[0].matchAll(/"(\d{1,8})"/g)]
      .map((match) => match[1])
      .sort();

    expect(codes).toEqual([...ALLOWED_STORE_CODES].sort());
  });

  it("names the same fifteen locations in the extension as in the roster", () => {
    /*
     * The extension prints "Not observed: 314 — KS Lawrence" after a full feed
     * scan, so it carries a display name per code. A name that drifts from the
     * roster's would have somebody looking for a salon under two names — so the
     * two are compared here, where the roster is the authority.
     */
    const block = extensionList.split("STORE_CODE_NAMES = Object.freeze({")[1] ?? "";
    const named = [...block.split("});")[0].matchAll(/"(\d{1,8})":\s*"([^"]+)"/g)].map(
      (match) => ({ storeCode: match[1], name: match[2] }),
    );

    expect(named).toHaveLength(15);
    expect(named.map((entry) => entry.storeCode).sort()).toEqual(
      [...ALLOWED_STORE_CODES].sort(),
    );

    for (const entry of named) {
      const listing = locationForStoreCode(entry.storeCode);
      expect(listing, entry.storeCode).toBeDefined();
      /* "Sun Tan City - KS Manhattan" ends with "KS Manhattan". */
      expect(listing!.googleLabel, entry.storeCode).toContain(entry.name);
      /* And it is the salon's own name, not something invented for the popup. */
      expect(salonByNumber(listing!.salonNumber)?.name).toBe(entry.name);
    }
  });

  it("the extension holds no salon number, because it has no business knowing one", () => {
    /*
     * The extension reports a GOOGLE store code and nothing else. Which ASK
     * Sunny salon that is stays on the server, where the mapping table is the
     * authority — so a stale extension cannot misfile a review, it can only
     * fail to send one.
     */
    const rosterNumbers = PRODUCTION_SALONS.map((salon) => salon.salonNumber);
    const quoted = [...extensionList.matchAll(/"(\d{3,4})"/g)].map((match) => match[1]);
    for (const value of quoted) {
      if (ALLOWED_STORE_CODES.includes(value)) continue;
      expect(rosterNumbers).not.toContain(value);
    }
  });
});
