import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { describesIncident } = await import("./corrective-action-intake");

/*
 * Port from Ask Bubbles. Coordinator via QA, Bubbles production, 5 Nov 2026,
 * the manager's words (store -> salon), the person invented: the card cited Animals
 * in the Workplace "from what you described" and also said "You haven't told
 * me what happened yet".
 */
const TURN = "create a ca for corwin hale at kearney. he brought his new kitten to the salon on 10-22-26. verbal. no payroll deduct";

beforeEach(() => {
  // Production has the specific topics on; the account reading is what this flag changes.
  vi.stubEnv("POLICY_SPECIFIC_TOPICS_ENABLED", "true");
  vi.stubEnv("DESCRIBED_TOPIC_IS_ACCOUNT_ENABLED", "");
});
afterEach(() => vi.unstubAllEnvs());
const on = () => vi.stubEnv("DESCRIBED_TOPIC_IS_ACCOUNT_ENABLED", "true");

describe("a specific policy topic in the manager's words is an account (DESCRIBED_TOPIC_IS_ACCOUNT_ENABLED)", () => {
  it("flag off: the kitten is not an account (the bug)", () => {
    expect(describesIncident(TURN)).toBe(false);
  });

  it("flag on: the kitten is an account", () => {
    on();
    expect(describesIncident(TURN)).toBe(true);
  });

  it("flag on: a name, salon, level and payroll answer alone are still no account", () => {
    on();
    expect(describesIncident("create a ca for corwin hale at kearney. verbal. no payroll deduct")).toBe(false);
  });

  it("flag on, specific topics off: unchanged", () => {
    on();
    vi.stubEnv("POLICY_SPECIFIC_TOPICS_ENABLED", "");
    expect(describesIncident(TURN)).toBe(false);
  });
});
