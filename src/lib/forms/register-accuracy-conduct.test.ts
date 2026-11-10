import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isSalesPolicyReading, readCaPolicy } from "./ca-policy";

/*
 * REGISTER_ACCURACY_CONDUCT_ENABLED. QA's CA sales batch, case (c) (4 Nov 2026), the request verbatim; the person is
 * invented (Pell Arrowmere). The replay case `nov4-ca-sales-wrong-items-card` runs the chat. CA_SALES_POLICY_ENABLED
 * is on in production.
 */
beforeEach(() => {
  process.env.CA_SALES_POLICY_ENABLED = "true";
});
afterEach(() => {
  delete process.env.CA_SALES_POLICY_ENABLED;
  delete process.env.REGISTER_ACCURACY_CONDUCT_ENABLED;
});

const SAID = "create a corrective action for Pell Arrowmere for ringing up the wrong items on a guest's sale";

describe("a sale rung up inaccurately", () => {
  it("reads as the Standards of Conduct with the flag on; as before off", () => {
    expect(readCaPolicy(SAID).source).not.toBe("register");
    process.env.REGISTER_ACCURACY_CONDUCT_ENABLED = "true";
    const reading = readCaPolicy(SAID);
    expect(reading.source).toBe("register");
    expect(isSalesPolicyReading(reading)).toBe(true);
  });

  it.each([
    "she rang up the wrong products for a customer",
    "he rung up the incorrect price on a lotion",
    "rang the sale up wrong twice this week",
    "she mis-rang a package",
  ])("reads %s", (said) => {
    process.env.REGISTER_ACCURACY_CONDUCT_ENABLED = "true";
    expect(readCaPolicy(`write a CA for Pell Arrowmere, ${said}`).source).toBe("register");
  });

  it.each([
    "she was late to her shift on 11/2",
    "she rang the bell at the wrong time",
    "she gave the wrong answer to a guest's question",
  ])("leaves %s alone", (said) => {
    process.env.REGISTER_ACCURACY_CONDUCT_ENABLED = "true";
    expect(readCaPolicy(`write a CA for Pell Arrowmere, ${said}`).source).not.toBe("register");
  });
});
