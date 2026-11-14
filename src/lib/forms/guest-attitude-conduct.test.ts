import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { specificTopic } from "./specific-policy-topics";

/* GUEST_ATTITUDE_CONDUCT_ENABLED. Pau's sf-b5 (4 Nov 2026), the manager's sentence verbatim. POLICY_SPECIFIC_TOPICS is on in production. */
beforeEach(() => {
  process.env.POLICY_SPECIFIC_TOPICS_ENABLED = "true";
});
afterEach(() => {
  delete process.env.POLICY_SPECIFIC_TOPICS_ENABLED;
  delete process.env.GUEST_ATTITUDE_CONDUCT_ENABLED;
});

const SAID = "The customer said she was giving her an attitude when she brought up that the register was charging for scent in her lotion refills and it has never done that before.";

describe("a guest who says the employee gave her an attitude", () => {
  it("is a guest treated rudely, the Standards of Conduct, with the flag on; as before off", () => {
    expect(specificTopic(SAID)?.id).not.toBe("guest_attitude");
    process.env.GUEST_ATTITUDE_CONDUCT_ENABLED = "true";
    expect(specificTopic(SAID)).toMatchObject({ id: "guest_attitude", cite: { kind: "heading", heading: "Standards of Conduct" } });
    expect(specificTopic("a client complained he had a bad attitude at the front desk")?.id).toBe("guest_attitude");
  });

  it("needs a guest in the sentence", () => {
    process.env.GUEST_ATTITUDE_CONDUCT_ENABLED = "true";
    expect(specificTopic("she had an attitude all shift on 11/2")?.id).not.toBe("guest_attitude");
    expect(specificTopic("The customer was happy. She had an attitude with me later.")?.id).not.toBe("guest_attitude");
  });
});
