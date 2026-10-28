import { describe, expect, it } from "vitest";

import { requestedForm } from "./form-type-switch";

describe("requestedForm", () => {
  it("reads a short request for the other form", () => {
    expect(requestedForm("change to coaching")).toBe("coaching");
    expect(requestedForm("CHANGE TO CORRECTIVE ACTION")).toBe("ca");
    expect(requestedForm("coaching form instead of ca")).toBe("coaching");
    expect(requestedForm("ca instead of coaching")).toBe("ca");
    expect(requestedForm("can this be a ca instead")).toBe("ca");
  });

  it("never reads an ordinary turn as a switch", () => {
    for (const turn of [
      "change the date to 10/19/2026",
      "This is a written warning.",
      "she was coached on 10-16 and late again today",
      "make sure she knows the attendance policy",
      "Change: Payroll deduct no. Salon: KS Lawrence.",
      "she was coached instead of written up last time",
      "change to coaching or ca",
    ]) {
      expect(requestedForm(turn), turn).toBeNull();
    }
  });
});
