import { describe, expect, it } from "vitest";

import {
  AUTHORIZED_COMPANY,
  isAuthorizedCompany,
  normalizeCompany,
  resolveStoreAlias,
  storeNameKey,
  StoreResolver,
} from "./store-identity";

describe("company matching", () => {
  it("matches the authorized company however it is spaced or cased", () => {
    expect(isAuthorizedCompany("JB and Associates")).toBe(true);
    expect(isAuthorizedCompany("  jb  and   associates ")).toBe(true);
    expect(isAuthorizedCompany("JB AND ASSOCIATES")).toBe(true);
  });

  it("does not match a different company", () => {
    expect(isAuthorizedCompany("STC Consolidated")).toBe(false);
    expect(isAuthorizedCompany("JB and Associates Holdings")).toBe(false);
    expect(isAuthorizedCompany("")).toBe(false);
    expect(isAuthorizedCompany(null)).toBe(false);
  });

  it("does not treat `and` and `&` as the same company", () => {
    // Two companies whose names differ only by that would be merged, and
    // nothing in the observed exports needs the equivalence.
    expect(normalizeCompany("JB & Associates")).not.toBe(normalizeCompany(AUTHORIZED_COMPANY));
  });
});

describe("store name normalization", () => {
  it("ignores case and whitespace, including non-breaking spaces", () => {
    expect(storeNameKey("NE Omaha Pacific")).toBe(storeNameKey("  ne   omaha  pacific "));
    expect(storeNameKey("NE Omaha Pacific")).toBe(storeNameKey("NE Omaha Pacific"));
  });

  it("ignores the punctuation these exports differ on", () => {
    expect(storeNameKey("NE Lincoln O Street")).toBe(storeNameKey("NE Lincoln O. Street"));
    expect(storeNameKey("NE Omaha 144th and Center")).toBe(
      storeNameKey("NE Omaha 144th & Center"),
    );
    expect(storeNameKey("KS Shawnee Mission Pkwy")).toBe(storeNameKey("KS Shawnee-Mission Pkwy"));
  });

  it("keeps genuinely different stores apart", () => {
    // Eight characters and one real store apart.
    expect(storeNameKey("KS Lawrence")).not.toBe(storeNameKey("KS Lawrenceburg"));
    // A shared three-word prefix.
    expect(storeNameKey("MO Kansas City Liberty")).not.toBe(
      storeNameKey("MO Kansas City Wornall"),
    );
    // The `WC` prefix is a real distinction in this estate.
    expect(storeNameKey("WC PA Stroudsburg")).not.toBe(storeNameKey("PA Stroudsburg"));
    // The state prefix is part of the name.
    expect(storeNameKey("NE Lincoln O Street")).not.toBe(storeNameKey("MO Lincoln O Street"));
  });
});

describe("the alias mechanism", () => {
  it("passes an unaliased name through, tidied but unchanged", () => {
    expect(resolveStoreAlias("  NE  Omaha  Pacific ")).toEqual({
      canonicalName: "NE Omaha Pacific",
      viaAlias: false,
    });
  });

  it("ships with no aliases, because every observed name resolves without one", () => {
    // Recorded as a finding rather than left implicit: the mechanism exists so
    // the first genuine variation is a reviewed one-line addition instead of a
    // fuzzy matcher proposed under pressure.
    expect(resolveStoreAlias("NE Kearney").viaAlias).toBe(false);
  });
});

describe("resolving a source name to a canonical salon", () => {
  const canonical = [
    { salonNumber: "0468", storeName: "KS Lawrence" },
    { salonNumber: "0410", storeName: "NE Omaha Pacific" },
  ];
  const roster = [
    { salonNumber: "0495", storeName: "MO St Joseph" },
    { salonNumber: "0307", storeName: "NE Grand Island" },
  ];

  it("matches an existing canonical salon on its name", () => {
    const resolver = new StoreResolver(canonical, roster);
    expect(resolver.resolve("KS Lawrence")).toEqual({
      sourceName: "KS Lawrence",
      kind: "canonical_name",
      salonNumber: "0468",
      canonicalName: "KS Lawrence",
    });
  });

  it("matches through normalization without matching a different store", () => {
    const resolver = new StoreResolver(canonical, roster);
    expect(resolver.resolve("ne omaha pacific").salonNumber).toBe("0410");
    expect(resolver.resolve("KS Lawrenceburg").kind).toBe("unresolved");
  });

  it("falls through to the roster for a salon it has never seen", () => {
    const resolver = new StoreResolver(canonical, roster);
    expect(resolver.resolve("MO St Joseph")).toEqual({
      sourceName: "MO St Joseph",
      kind: "roster",
      salonNumber: "0495",
      canonicalName: "MO St Joseph",
    });
  });

  it("never lets the roster override a canonical salon's number", () => {
    // A franchise roster export is maintained by hand and is the least
    // trustworthy of the sources about identity.
    const resolver = new StoreResolver(canonical, [
      { salonNumber: "9999", storeName: "KS Lawrence" },
    ]);
    expect(resolver.resolve("KS Lawrence").salonNumber).toBe("0468");
    expect(resolver.resolve("KS Lawrence").kind).toBe("canonical_name");
  });

  it("refuses an ambiguous roster name rather than picking one", () => {
    // Two numbers for one name is a coin flip that would be recorded as a fact.
    const resolver = new StoreResolver([], [
      { salonNumber: "0100", storeName: "Twin Oaks" },
      { salonNumber: "0200", storeName: "twin  oaks" },
    ]);
    expect(resolver.resolve("Twin Oaks").kind).toBe("unresolved");
  });

  it("accepts a duplicate roster row that agrees with itself", () => {
    const resolver = new StoreResolver([], [
      { salonNumber: "0100", storeName: "Twin Oaks" },
      { salonNumber: "0100", storeName: "Twin Oaks" },
    ]);
    expect(resolver.resolve("Twin Oaks").salonNumber).toBe("0100");
  });

  it("never guesses at a name it cannot place", () => {
    const resolver = new StoreResolver(canonical, roster);
    for (const name of ["", "   ", "Unknown Store", "KS", "Lawrence"]) {
      expect(resolver.resolve(name)).toMatchObject({ kind: "unresolved", salonNumber: null });
    }
  });

  it("lists the names it could not place, de-duplicated and in order", () => {
    const resolver = new StoreResolver(canonical, roster);
    expect(
      resolver.unresolved(["KS Lawrence", "Ghost Town", "ghost  town", "Other Place"]),
    ).toEqual(["Ghost Town", "Other Place"]);
  });
});
