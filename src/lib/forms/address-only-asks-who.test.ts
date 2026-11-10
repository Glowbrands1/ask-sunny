import { afterEach, describe, expect, it } from "vitest";

import type { AskResponse } from "@/lib/ai/types";

import { formForAddressOnly, withAddressOnlyAsksWho } from "./address-only-asks-who";

/* ADDRESS_ONLY_ASKS_WHO_ENABLED. QA's words, 4 Nov 2026: "Corrective action for 123 Main Street". */
const ANSWER = { content: "A grounded answer from the policy manual.", citations: [], coverage: "answered", recommendedVideoIds: [] } as unknown as AskResponse;

afterEach(() => {
  delete process.env.ADDRESS_ONLY_ASKS_WHO_ENABLED;
});

describe("a form for a street address", () => {
  it("reads the form and the street, and never a person or a date", () => {
    expect(formForAddressOnly("Corrective action for 123 Main Street")).toEqual({ form: "Corrective Action Form", street: "Main Street" });
    expect(formForAddressOnly("coaching form for 45 Oak Ave")).toEqual({ form: "Coaching Form", street: "Oak Ave" });
    expect(formForAddressOnly("Corrective action for Jane Doe")).toBeNull();
    expect(formForAddressOnly("Corrective action for Jane Doe, she was late at 123 Main Street")).toBeNull();
  });

  it("asks who with the flag on; as before off, or when a card was made", () => {
    expect(withAddressOnlyAsksWho(ANSWER, "Corrective action for 123 Main Street")).toBe(ANSWER);
    process.env.ADDRESS_ONLY_ASKS_WHO_ENABLED = "true";
    expect(withAddressOnlyAsksWho(ANSWER, "Corrective action for 123 Main Street").content).toMatch(/^Who is this \*\*Corrective Action Form\*\* for\? "Main Street" reads as a street address/);
    const carded = { ...ANSWER, formProposal: { employeeName: null } } as unknown as AskResponse;
    expect(withAddressOnlyAsksWho(carded, "Corrective action for 123 Main Street")).toBe(carded);
  });
});
