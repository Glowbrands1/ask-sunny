import { describe, expect, it } from "vitest";

import { addressListEmails, mayListAllAddresses } from "./address-list-access";

/** Pau, 26 Nov 2026: "for my access only, please show all employe adress withouth cicking 'show address'". */
describe("every home address without clicking: the named account only", () => {
  const allowed = addressListEmails(" Owner@Example.test, other@example.test ");

  it("reads the server list, ignoring case and spaces", () => {
    expect(allowed).toEqual(["owner@example.test", "other@example.test"]);
    expect(addressListEmails(undefined)).toEqual([]);
  });

  it("answers yes only for a verified sign-in on the list", () => {
    expect(mayListAllAddresses({ email: "OWNER@example.test", verified: true }, allowed)).toBe(true);
    expect(mayListAllAddresses({ email: "manager@example.test", verified: true }, allowed)).toBe(false);
    // Demo / preview identities are never verified.
    expect(mayListAllAddresses({ email: "owner@example.test", verified: false }, allowed)).toBe(false);
    expect(mayListAllAddresses(null, allowed)).toBe(false);
    expect(mayListAllAddresses({ email: "owner@example.test", verified: true }, [])).toBe(false);
  });
});
