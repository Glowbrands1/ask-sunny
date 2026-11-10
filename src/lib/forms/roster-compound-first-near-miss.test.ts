import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { matchEmployeeName } from "@/lib/forms/employee-match";

/**
 * ROSTER_COMPOUND_FIRST_NEAR_MISS_ENABLED (QA, 10 Nov 2026, coding 6's B1 triage sf-b5): "Delphine Marlwoe Ostrander"
 * (two letters swapped in the MIDDLE word) was not matched to the roster's "Delphine Marlowe" + "Ostrander" even with
 * every ROSTER_* flag on. Invented people.
 */
const row = (id: string, firstName: string, lastName: string) => ({ id, firstName, lastName, preferredFirstName: null }) as never;
const DELPHINE = row("e-delphine-marlowe-ostrander", "Delphine Marlowe", "Ostrander");
const NAMESAKE = row("e-delphine-ostrander", "Delphine", "Ostrander");
const offered = (typed: string, roster: readonly never[]) => {
  const match = matchEmployeeName(typed, roster);
  return { kind: match.kind, names: "candidates" in match ? match.candidates.map((c) => c.name) : "name" in match ? [match.name] : [] };
};

afterEach(() => vi.unstubAllEnvs());

describe("ROSTER_COMPOUND_FIRST_NEAR_MISS: a typo inside a two-word first name", () => {
  it("QA's wording: \"Delphine Marlwoe Ostrander\" is asked as Delphine Marlowe Ostrander, never filled", () => {
    vi.stubEnv("ROSTER_COMPOUND_FIRST_NEAR_MISS_ENABLED", "true");
    expect(offered("Delphine Marlwoe Ostrander", [DELPHINE])).toEqual({ kind: "confirm", names: ["Delphine Marlowe Ostrander"] });
    expect(offered("delphine marlwoe ostrandre", [DELPHINE])).toEqual({ kind: "confirm", names: ["Delphine Marlowe Ostrander"] });
  });

  it("a Delphine Ostrander on the roster too: both are offered, neither is filled by skipping the middle word", () => {
    vi.stubEnv("ROSTER_COMPOUND_FIRST_NEAR_MISS_ENABLED", "true");
    const read = offered("Delphine Marlwoe Ostrander", [DELPHINE, NAMESAKE]);
    expect(read.kind).toBe("confirm");
    expect([...read.names].sort()).toEqual(["Delphine Marlowe Ostrander", "Delphine Ostrander"]);
  });

  it("the exact name and an unrelated middle word are as before", () => {
    vi.stubEnv("ROSTER_COMPOUND_FIRST_NEAR_MISS_ENABLED", "true");
    expect(offered("Delphine Marlowe Ostrander", [DELPHINE])).toEqual({ kind: "exact", names: ["Delphine Marlowe Ostrander"] });
    expect(offered("Delphine Quist Ostrander", [DELPHINE]).kind).toBe("none");
  });

  it("off: as before (the bug), nobody", () => {
    vi.stubEnv("ROSTER_COMPOUND_FIRST_NEAR_MISS_ENABLED", "false");
    for (const name of ["ROSTER_COMPOUND_SURNAME_ENABLED", "ROSTER_NEAR_MISS_ENABLED", "ROSTER_NAME_IN_CANDIDATE_ENABLED"]) vi.stubEnv(name, "true");
    expect(offered("Delphine Marlwoe Ostrander", [DELPHINE]).kind).toBe("none");
  });
});
