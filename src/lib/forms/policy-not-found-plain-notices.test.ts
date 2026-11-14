import { afterEach, describe, expect, it, vi } from "vitest";

import {
  POLICY_ACKNOWLEDGEMENT_MESSAGE,
  POLICY_ACKNOWLEDGEMENT_TITLE,
  policyAcknowledgementWording,
} from "./policy-verification";

/* POLICY_NOT_FOUND_PLAIN_WORDING for the Finalize dialog (QA, 14 Nov 2026). */
afterEach(() => vi.unstubAllEnvs());

const BLANK = [{ key: "policy_language", filled: false }];

describe("POLICY_NOT_FOUND_PLAIN_WORDING: the Finalize dialog", () => {
  it("off: \"Woven does not see this policy …\" (as on main)", () => {
    vi.stubEnv("POLICY_NOT_FOUND_PLAIN_WORDING_ENABLED", "");
    expect(policyAcknowledgementWording(BLANK, [])).toEqual({ title: POLICY_ACKNOWLEDGEMENT_TITLE, message: POLICY_ACKNOWLEDGEMENT_MESSAGE });
  });

  it("on: \"I don't see this policy …\", the rest unchanged", () => {
    vi.stubEnv("POLICY_NOT_FOUND_PLAIN_WORDING_ENABLED", "true");
    const wording = policyAcknowledgementWording(BLANK, []);
    expect(wording.title).toBe("I don't see this policy in the knowledge base");
    expect(wording.message).toBe(POLICY_ACKNOWLEDGEMENT_MESSAGE.replace(/^Woven does not see/, "I don't see"));
  });
});
