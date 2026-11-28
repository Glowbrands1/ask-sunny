import { describe, expect, it } from "vitest";

import { fullNameFor } from "./person-name";

/*
 * Pau, 28 Nov 2026: "list all users per name and backfill it please not just by title". Accounts set up with a
 * first name only showed as "Sarah" and "Colene" in Most active leaders. Invented people throughout.
 */
describe("fullNameFor", () => {
  it("adds the surname from a first.last email whose first name agrees", () => {
    expect(fullNameFor("Norelle", "Norelle.Quist@example.com")).toBe("Norelle Quist");
    expect(fullNameFor("Brin", "brin.ashdown@example.com")).toBe("Brin Ashdown");
    expect(fullNameFor("TJ", "TJ.Varga@example.com")).toBe("TJ Varga");
    expect(fullNameFor("Odette", "odette.mc-fall@example.com")).toBe("Odette Mc-Fall");
  });

  it("keeps a name that already has a surname", () => {
    expect(fullNameFor("Norelle Quist", "nq@example.com")).toBe("Norelle Quist");
  });

  it("never guesses from an email that does not agree with the name", () => {
    expect(fullNameFor("Brin", "ops.lead@example.com")).toBe("Brin");
    expect(fullNameFor("Brin", "brin@example.com")).toBe("Brin");
    expect(fullNameFor("Brin", "brin.a.ashdown@example.com")).toBe("Brin");
    expect(fullNameFor("Brin", null)).toBe("Brin");
  });

  it("ignores a +tag in the email", () => {
    expect(fullNameFor("Brin", "brin.ashdown+qa@example.com")).toBe("Brin Ashdown");
  });
});
