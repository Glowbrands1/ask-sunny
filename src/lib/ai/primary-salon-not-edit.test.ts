import { afterEach, describe, expect, it } from "vitest";

import { salonSetInTurn } from "./edit-date-rules";

/**
 * PRIMARY_SALON_NOT_EDIT_ENABLED (replay set s21, 3 Nov 2026): "primary salon
 * is Omaha Center" states the employee's home salon; it is not an edit of the
 * form's salon. A real edit still is.
 */
const FLAG = "PRIMARY_SALON_NOT_EDIT_ENABLED";
const S21 =
  "Put together a written CA for Sloane Wexford, primary salon is Omaha Center. But on Monday 10/05/2026 Sloane was working a shift at Omaha Pacific and did not complete the 10 minute disenfect";

afterEach(() => {
  delete process.env[FLAG];
});

describe("a primary salon is not a salon edit", () => {
  it("off: today's reading — the primary salon is taken as the edit", () => {
    expect(salonSetInTurn(S21)).toBe("loc-0314");
  });

  it("on: the primary salon is not an edit", () => {
    process.env[FLAG] = "true";
    expect(salonSetInTurn(S21)).toBeNull();
  });

  it("on: a real edit of the salon still is one", () => {
    process.env[FLAG] = "true";
    expect(salonSetInTurn("change the salon to Omaha Pacific")).toBe("loc-0410");
    expect(salonSetInTurn("the salon is Omaha Pacific")).toBe("loc-0410");
  });
});
