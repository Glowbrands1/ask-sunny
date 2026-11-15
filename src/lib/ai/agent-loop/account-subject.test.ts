import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { accountSubjectChanged } = await import("./tools");

/* Batch G (G15, the tester's live re-test, names invented): the Observation changed who did it. */
describe("who did it, in the account", () => {
  const said = "ca for wren halloway, Wren Halloway failed to have Nell Prior complete required policy acknowledgements during her onboarding";
  it("names the other person when the account makes them the subject", () => {
    expect(accountSubjectChanged(said, "Nell Prior did not complete required policy acknowledgements in Woven during her onboarding.", "Wren Halloway")).toBe("Nell Prior");
  });
  it("is null when the account keeps the employee as the one responsible", () => {
    expect(accountSubjectChanged(said, "Wren Halloway failed to have Nell Prior complete required policy acknowledgements during her onboarding.", "Wren Halloway")).toBeNull();
  });
  it("is null when the manager never had the employee acting (nothing moved)", () => {
    expect(accountSubjectChanged("Nell Prior was rude to a guest", "Nell Prior was rude to a guest.", "Wren Halloway")).toBeNull();
  });
});
