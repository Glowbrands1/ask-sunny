import { afterEach, describe, expect, it, vi } from "vitest";

import { addressFormAsk, withAddressFormAsk } from "./address-asks-who";

// QA, 4 Nov 2026: "Corrective action for 123 Main Street".
const POLICY_ANSWER = { content: "Here is what the policy says about corrective actions …", citations: [{ id: "x" }], recommendedVideoIds: ["v"] };

describe("ADDRESS_ASKS_WHO_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off: the answer is left as it is", () => {
    expect(withAddressFormAsk(POLICY_ANSWER, "Corrective action for 123 Main Street")).toEqual(POLICY_ANSWER);
  });

  it("on: a form request for a street address, with no card, asks who it is for", () => {
    vi.stubEnv("ADDRESS_ASKS_WHO_ENABLED", "true");
    const asked = withAddressFormAsk(POLICY_ANSWER, "Corrective action for 123 Main Street");
    expect(asked.content).toMatch(/^Who is this \*\*Corrective Action Form\*\* for\?/);
    expect(asked.content).toContain('"123 Main Street" reads as a street address');
    expect(asked.citations).toEqual([]);
  });

  it("on: a card, a person, or no form request is left as it is", () => {
    vi.stubEnv("ADDRESS_ASKS_WHO_ENABLED", "true");
    const card = { ...POLICY_ANSWER, formProposal: { employeeName: null } };
    expect(withAddressFormAsk(card, "Corrective action for 123 Main Street")).toEqual(card);
    expect(addressFormAsk("Corrective action for Jane Doe")).toBeNull();
    expect(addressFormAsk("what is the policy for 123 Main Street parking?")).toBeNull();
  });
});
