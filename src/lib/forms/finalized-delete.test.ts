import { describe, expect, it } from "vitest";
import { finalizedDeleteEmails, mayDeleteFinalizedForm } from "./finalized-delete";

/*
 * Pau, 26 Nov 2026: "pls allow delete for finalized form in my account only". The email here is invented; the real
 * one lives only in the server variable FINALIZED_FORM_DELETE_EMAILS.
 */
describe("pls allow delete for finalized form in my account only", () => {
  const list = finalizedDeleteEmails(" Owner@Example.test , ");

  it("reads the list trimmed and case-insensitive", () => {
    expect(list).toEqual(["owner@example.test"]);
  });

  it("allows the named, verified account", () => {
    expect(mayDeleteFinalizedForm({ email: "OWNER@example.test", verified: true }, list)).toBe(true);
  });

  it("refuses everyone else, administrators included (the list, not the role, decides)", () => {
    expect(mayDeleteFinalizedForm({ email: "admin@example.test", verified: true }, list)).toBe(false);
  });

  it("fails closed: unverified, no email, signed out, or the variable unset", () => {
    expect(mayDeleteFinalizedForm({ email: "owner@example.test", verified: false }, list)).toBe(false);
    expect(mayDeleteFinalizedForm({ email: "", verified: true }, list)).toBe(false);
    expect(mayDeleteFinalizedForm(null, list)).toBe(false);
    expect(mayDeleteFinalizedForm({ email: "owner@example.test", verified: true }, finalizedDeleteEmails(undefined))).toBe(false);
  });
});
