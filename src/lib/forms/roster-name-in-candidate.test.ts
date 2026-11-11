import { afterEach, describe, expect, it, vi } from "vitest";

import { couldBeOnRoster } from "./roster-shape";

/**
 * ROSTER_NAME_IN_CANDIDATE_ENABLED (QA, 5 Nov 2026, R2 checked in this app).
 * The story's words, people invented: "When Odalys spoke with District manager
 * Thessaly Brookhart …" reads the candidate "When Odalys". With
 * FORM_NAME_FROM_ROSTER_ENABLED it was set aside as shaped like nobody, and the
 * card went to the district manager.
 */
const ROSTER = ["Marnie Holloway", "Remy Calder", "Odalys Prewett Vansickle", "Thessaly Brookhart"];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ROSTER_NAME_IN_CANDIDATE_ENABLED: a candidate ending in a roster person's name could be them", () => {
  it("off: \"When Odalys\" is shaped like nobody (as before)", () => {
    // Changed on purpose (QA's #741 gate R16A, 10 Nov 2026): the flag is pinned off here, so the set's env does not leak in.
    vi.stubEnv("ROSTER_NAME_IN_CANDIDATE_ENABLED", "");
    expect(couldBeOnRoster("When Odalys", ROSTER)).toBe(false);
  });

  it("on: \"When Odalys\" (a sentence word, then her first name) could be Odalys Prewett Vansickle", () => {
    vi.stubEnv("ROSTER_NAME_IN_CANDIDATE_ENABLED", "true");
    expect(couldBeOnRoster("When Odalys", ROSTER)).toBe(true);
    expect(couldBeOnRoster("Then Odalys Prewett", ROSTER)).toBe(true);
  });

  it("on: metrics and offenses are still nobody (Pau, 4 Nov 2026)", () => {
    vi.stubEnv("ROSTER_NAME_IN_CANDIDATE_ENABLED", "true");
    for (const phrase of ["Club Close", "Under", "Club Average", "Spa", "Under Performance"]) {
      expect(couldBeOnRoster(phrase, ROSTER), phrase).toBe(false);
    }
  });

  it("on: a roster last name alone at the end is not enough (\"Club Calder\")", () => {
    vi.stubEnv("ROSTER_NAME_IN_CANDIDATE_ENABLED", "true");
    expect(couldBeOnRoster("Club Calder", ROSTER)).toBe(false);
  });
});
