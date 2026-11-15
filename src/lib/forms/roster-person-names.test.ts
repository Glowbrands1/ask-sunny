import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { sameEmployee } from "./draft-reopen";
import { installPreferredAliases, rosterAliasesOf, sameRosterPerson } from "./preferred-name-shown";
import { sameName } from "./prior-forms-lines";
import { samePerson } from "./proposal";

/**
 * QA, 15 Nov 2026 (with Pau's name ruling): form_instances holds only employee_name, so a form saved as "Rae
 * Fairweather" and one saved as "Lorraine Fairweather" are linked only by name. Every by-name lookup reads one roster
 * person's preferred and legal names as the same person — samePerson (edit-by-name, find_past_forms, the card and
 * request checks), sameEmployee (duplicate-draft reuse), sameName (the on-file lines and prior forms) — both ways, and
 * never merges two different roster people. Invented names.
 */
const RAE = { legal: "Lorraine Fairweather", preferred: "Rae Fairweather" };

afterEach(() => {
  installPreferredAliases(() => undefined);
  vi.unstubAllEnvs();
});

describe("READABLE_NAMES_ENABLED on", () => {
  beforeEach(() => vi.stubEnv("READABLE_NAMES_ENABLED", "true"));

  it.each([
    ["Rae Fairweather", "Lorraine Fairweather"],
    ["Lorraine Fairweather", "Rae Fairweather"],
    ["rae fairweather", "LORRAINE FAIRWEATHER"],
  ])("%s and %s are one person, in every lookup", (saved, asked) => {
    installPreferredAliases(() => [RAE]);
    expect(sameRosterPerson(saved, asked)).toBe(true);
    expect(samePerson(saved, asked)).toBe(true);
    expect(sameEmployee(saved, asked)).toBe(true);
    expect(sameName(saved, asked)).toBe(true);
  });

  it("the names a lookup reads for the person", () => {
    installPreferredAliases(() => [RAE]);
    expect(rosterAliasesOf("rae fairweather")).toEqual(["Lorraine Fairweather", "Rae Fairweather"]);
    expect(rosterAliasesOf("Tessa Holloway")).toEqual(["Tessa Holloway"]);
  });

  it("two different roster people are never merged: a legal Rae Fairweather is somebody else", () => {
    installPreferredAliases(() => [RAE, { legal: "Rae Fairweather", preferred: "Ray Fairweather" }]);
    expect(rosterAliasesOf("Lorraine Fairweather")).toEqual(["Lorraine Fairweather"]);
    expect(samePerson("Lorraine Fairweather", "Rae Fairweather")).toBe(false);
    expect(sameEmployee("Lorraine Fairweather", "Rae Fairweather")).toBe(false);
    expect(sameName("Lorraine Fairweather", "Rae Fairweather")).toBe(false);
  });

  it("another surname is another person", () => {
    installPreferredAliases(() => [RAE]);
    expect(samePerson("Rae Holloway", "Lorraine Fairweather")).toBe(false);
  });
});

describe("READABLE_NAMES_ENABLED off: as before", () => {
  it("the two names are not merged", () => {
    installPreferredAliases(() => [RAE]);
    expect(samePerson("Rae Fairweather", "Lorraine Fairweather")).toBe(false);
    expect(sameEmployee("Rae Fairweather", "Lorraine Fairweather")).toBe(false);
    expect(sameName("Rae Fairweather", "Lorraine Fairweather")).toBe(false);
    expect(rosterAliasesOf("Rae Fairweather")).toEqual(["Rae Fairweather"]);
  });
});
