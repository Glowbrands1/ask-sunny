import { afterEach, describe, expect, it, vi } from "vitest";

import { matchEmployeeName, type RosterEmployee } from "./employee-match";

/*
 * TYPO_FULL_NAME_TO_ROSTER_ENABLED (ported from the sibling app: QA's audit item 15.10, overnight scan sf-b5, 11 Nov 2026; invented names). The
 * manager typed "create a ca form for Delphine Marlwoe Ostrander" for the roster's Delphine Marlowe Ostrander.
 */
const person = (id: string, firstName: string, lastName: string) =>
  ({ id, firstName, lastName, preferredFirstName: null, locationIds: [] }) as unknown as RosterEmployee;
const ROSTER = [
  person("1", "Delphine", "Marlowe Ostrander"),
  person("2", "Tess", "Varga"),
  person("3", "Remy", "Calder"),
  person("4", "Corvin", "Ashby"),
  person("5", "Corvin", "Ashley"),
];

const on = () => {
  vi.stubEnv("ROSTER_COMPOUND_SURNAME_ENABLED", "true");
  vi.stubEnv("TYPO_FULL_NAME_TO_ROSTER_ENABLED", "true");
};

afterEach(() => vi.unstubAllEnvs());

describe("TYPO_FULL_NAME_TO_ROSTER_ENABLED", () => {
  it("off: \"Delphine Marlwoe Ostrander\" is a question, never the roster person", () => {
    on();
    vi.stubEnv("TYPO_FULL_NAME_TO_ROSTER_ENABLED", "false");
    expect(matchEmployeeName("Delphine Marlwoe Ostrander", ROSTER).kind).toBe("confirm");
  });

  it("on: \"Delphine Marlwoe Ostrander\" is the roster's Delphine Marlowe Ostrander", () => {
    on();
    expect(matchEmployeeName("Delphine Marlwoe Ostrander", ROSTER)).toMatchObject({ kind: "exact", name: "Delphine Marlowe Ostrander" });
    expect(matchEmployeeName("delphine marlowe ostrandr", ROSTER)).toMatchObject({ kind: "exact", name: "Delphine Marlowe Ostrander" });
    expect(matchEmployeeName("Tess Vagra", ROSTER)).toMatchObject({ kind: "exact", name: "Tess Varga" });
  });

  it("on, never: a different first name, a missing surname word, a surname too far off, or two close people", () => {
    on();
    expect(matchEmployeeName("Delphina Marlowe Ostrander", ROSTER).kind).not.toBe("exact");
    expect(matchEmployeeName("Delphine Ostrandr", ROSTER).kind).not.toBe("exact");
    expect(matchEmployeeName("Remy Caldwell", ROSTER).kind).not.toBe("exact");
    expect(matchEmployeeName("Remy Caldr", ROSTER)).toMatchObject({ kind: "exact", name: "Remy Calder" });
    expect(matchEmployeeName("Corvin Ashly", ROSTER).kind).not.toBe("exact");
  });
});
