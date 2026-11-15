import { describe, expect, it } from "vitest";

import { saysAmountUnknown } from "./amount-unknown-ack";

/* QA, batch J (15 Nov 2026): the shared reader reads the not-known amount after the payroll answer in one message. */
describe("the amount the manager says is not known", () => {
  it("reads a message that is only that", () => {
    expect(saysAmountUnknown("i dont know the amount")).toBe(true);
    expect(saysAmountUnknown("not sure of the amount")).toBe(true);
  });
  it("reads it after the payroll answer: \"but\", a comma or a semicolon", () => {
    expect(saysAmountUnknown("yes payroll but I don't know the amount")).toBe(true);
    expect(saysAmountUnknown("yes payroll, idk the amount")).toBe(true);
    expect(saysAmountUnknown("payroll deduct yes; not sure about the amount")).toBe(true);
  });
  it("a clause that is not about the amount is not", () => {
    expect(saysAmountUnknown("yes payroll but only for the shift")).toBe(false);
    expect(saysAmountUnknown("yes payroll, $15")).toBe(false);
    expect(saysAmountUnknown("she said she doesn't know but the amount is $15")).toBe(false);
  });
});
