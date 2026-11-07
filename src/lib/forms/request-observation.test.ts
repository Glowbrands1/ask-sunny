import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { withoutRequestInObservation } = await import("./request-observation");

/*
 * QA, live, 4 Nov 2026 (CA_SALES_POLICY_ENABLED on): the draft's Observation
 * of Offense was the whole request, "CA for <name> due to under performance
 * in salon metrics". QA's wording, the person invented.
 */
const NAME = "Briony Fellwater";
const COPIED = `Observed:\nCA for ${NAME} due to under performance in salon metrics`;

function flag(on: boolean) {
  vi.stubEnv("CA_SALES_POLICY_ENABLED", on ? "true" : "false");
}
afterEach(() => vi.unstubAllEnvs());

describe("the request is not the Observation (CA_SALES_POLICY_ENABLED)", () => {
  it("QA's live wording: the request sentence becomes its reason", () => {
    flag(true);
    expect(withoutRequestInObservation({ observation: COPIED }, "observation", NAME)?.observation).toBe("Observed:\nUnder performance in salon metrics.");
  });

  it("\"for\" and \"because of\" read the same way; the rest of the Observation stays", () => {
    flag(true);
    expect(
      withoutRequestInObservation({ observation: `Observed:\nMSB CA for ${NAME} for underperformance in the month of October. She missed two huddles.` }, "observation", NAME)?.observation,
    ).toBe("Observed:\nUnderperformance in the month of October. She missed two huddles.");
    expect(withoutRequestInObservation({ observation: `Observed:\nCA for ${NAME} because of a register shortage on 10/20` }, "observation", NAME)?.observation).toBe(
      "Observed:\nA register shortage on 10/20.",
    );
  });

  it("an Observation that is an account is left as it is", () => {
    flag(true);
    expect(withoutRequestInObservation({ observation: `Observed:\n${NAME} did not meet her salon metrics in October.` }, "observation", NAME)).toBeNull();
  });

  it("a request with no reason to read is left as it is", () => {
    flag(true);
    expect(withoutRequestInObservation({ observation: `Observed:\nCA for ${NAME}` }, "observation", NAME)).toBeNull();
  });

  it("off: unchanged", () => {
    flag(false);
    expect(withoutRequestInObservation({ observation: COPIED }, "observation", NAME)).toBeNull();
  });
});
