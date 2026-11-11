import { afterEach, describe, expect, it, vi } from "vitest";

import { acceptsNearMissWithDetails } from "./near-miss-answer";

/**
 * NEAR_MISS_DETAILS_ACCEPT_ENABLED (ported from the sibling app: QA's gate there on 4d42c342, 7 Nov 2026). The
 * manager's words, in this app's setting; the people are invented (Corvina Vellacott, Delphine Marlowe Ostrander).
 */
const CORVINA_TYPED = ["i have an employee, Corvina Ashdown Vellacot that needs a corrective action form with a customer complaint"];
const DELPHINE_TYPED = ["create a ca form for Delphine Marlwoe Ostrander"];

describe("acceptsNearMissWithDetails", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off: never", () => {
    // Changed on purpose (the roster-set gate R16A, 10 Nov 2026): the flag is pinned off here, so the set's env (FORM_NAME and companions on) does not leak in.
    vi.stubEnv("NEAR_MISS_DETAILS_ACCEPT_ENABLED", "");
    expect(acceptsNearMissWithDetails("verbal warning, no payroll deduct, part-time tanning consultant,", "Corvina Vellacott", CORVINA_TYPED)).toBe(false);
  });

  describe("on", () => {
    const on = () => vi.stubEnv("NEAR_MISS_DETAILS_ACCEPT_ENABLED", "true");

    it("the form's details after a near-miss of a full name accept the asked name", () => {
      on();
      expect(acceptsNearMissWithDetails("verbal warning, no payroll deduct, part-time tanning consultant,", "Corvina Vellacott", CORVINA_TYPED)).toBe(true);
      expect(
        acceptsNearMissWithDetails(
          "verbal warning The date she complained was Oct 31st . The customer said she was giving her an attitude",
          "Delphine Marlowe Ostrander",
          DELPHINE_TYPED,
        ),
      ).toBe(true);
    });

    it("negatives: turned down, a question, no form detail, or a first name typed alone", () => {
      on();
      expect(acceptsNearMissWithDetails("no, verbal warning for someone else", "Corvina Vellacott", CORVINA_TYPED)).toBe(false);
      expect(acceptsNearMissWithDetails("nope. verbal warning", "Corvina Vellacott", CORVINA_TYPED)).toBe(false);
      expect(acceptsNearMissWithDetails("wrong person, written warning", "Corvina Vellacott", CORVINA_TYPED)).toBe(false);
      expect(acceptsNearMissWithDetails("is it a verbal warning?", "Corvina Vellacott", CORVINA_TYPED)).toBe(false);
      expect(acceptsNearMissWithDetails("she was rude to a guest", "Corvina Vellacott", CORVINA_TYPED)).toBe(false);
      expect(acceptsNearMissWithDetails("verbal warning, no payroll deduct", "Corvina Vellacott", ["corvina was late on 10/20, write her up"])).toBe(false);
    });
  });
});
