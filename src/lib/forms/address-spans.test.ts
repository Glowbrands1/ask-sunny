import { describe, expect, it } from "vitest";

import { typedAddressSpans, withoutAddressLines } from "./address-spans";

/* Port of Ask Bubbles 4f9f706c (its QA, the u22 live run): an address given as the employee's never names the card's salon. */
describe("typed addresses, for the salon readers", () => {
  it("reads an address line and blanks it, keeping the rest", () => {
    const text = "address: 456 Elm Ave, Manhattan, KS. 00000";
    expect(typedAddressSpans(text).map((span) => span.address)).toEqual(["456 Elm Ave, Manhattan, KS. 00000"]);
    expect(withoutAddressLines(text).trim()).toBe("address:");
    expect(withoutAddressLines(text)).toHaveLength(text.length);
  });

  it("a salon named outside the address stays", () => {
    const text = "this is for the manhattan, ks salon. address: 456 Elm Ave, Kearney, NE 68847";
    expect(withoutAddressLines(text)).toMatch(/^this is for the manhattan, ks salon\. address:\s+$/);
  });

  it("no address label, nothing blanked", () => {
    const text = "she worked at 456 Elm Ave in Manhattan";
    expect(withoutAddressLines(text)).toBe(text);
  });
});
