import { afterEach, describe, expect, it, vi } from "vitest";

import { extractEmployeeNames } from "./proposal";

/*
 * SURNAME_PARTICLES_ENABLED (QA's audit item 17b, 10 Nov 2026): a typed surname that opens with a particle was cut
 * at it ("maria de la cruz" → "maria de"). The people here are invented. The reader's own lines are in the protected
 * forms/proposal.ts (Pau, "ok surname particles", 10 Nov 2026; docs/patches/surname-particles.patch).
 */
describe("SURNAME_PARTICLES_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());
  const on = (value: boolean) => vi.stubEnv("SURNAME_PARTICLES_ENABLED", value ? "true" : "");

  it.each([
    ["create a ca for marisol de la vega, she was late on 11/3", "marisol de la vega"],
    ["I need a CA for marisol de la vega", "marisol de la vega"],
    ["create a coaching form for marisol van der vega, she was late", "marisol van der vega"],
  ])("on: %s → %s", (said, name) => {
    on(true);
    expect(extractEmployeeNames(said)).toEqual([name]);
  });

  // A one-particle surname is three words, which the reader already keeps whole; flag on, it still is.
  it.each([
    ["create a coaching form for teodor von halle, he was late 11/3", "teodor von halle"],
    ["create a ca for renata del prado she was late", "renata del prado"],
  ])("on and off: %s → %s", (said, name) => {
    on(false);
    expect(extractEmployeeNames(said)).toEqual([name]);
    on(true);
    expect(extractEmployeeNames(said)).toEqual([name]);
  });

  it.each([
    "create a ca for marisol de la vega, she was late on 11/3",
    "create a coaching form for marisol van der vega, she was late",
  ])("off: %s is read as before", (said) => {
    on(false);
    expect(extractEmployeeNames(said)[0]).toMatch(/^marisol (?:de|van)$/);
  });

  it.each([
    // No surname word after the particle: nothing is joined.
    ["create a ca for marisol de, she was late", "marisol de"],
    // A form word after the particle is not a surname.
    ["create a ca for marisol de la salon", null],
    // Ordinary names are untouched.
    ["create a ca for tess varga, she was late on 11/3", "tess varga"],
  ])("on, unchanged: %s", (said, name) => {
    on(true);
    const off = (on(false), extractEmployeeNames(said));
    on(true);
    const read = extractEmployeeNames(said);
    expect(read).toEqual(off);
    if (name) expect(read[0]).toBe(name);
  });
});
