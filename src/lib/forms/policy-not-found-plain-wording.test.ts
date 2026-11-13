import { afterEach, describe, expect, it, vi } from "vitest";

import { caPolicyProposalLine, readCaPolicy } from "./ca-policy";

/*
 * POLICY_NOT_FOUND_PLAIN_WORDING (QA, 13 Nov 2026, from a live check: 'Woven does not see a section of the current policy
 * manual for "key holdr" …' reads oddly to a manager). Invented wording.
 */
afterEach(() => vi.unstubAllEnvs());

const MISSING = { phrase: "key holdr", lookup: "missing" } as const;
const line = () => caPolicyProposalLine(readCaPolicy("she left the back door unlocked last night"), MISSING) ?? "";

describe("POLICY_NOT_FOUND_PLAIN_WORDING", () => {
  it("flag off: 'Woven does not see …' for a phrase not about Woven (as on main)", () => {
    vi.stubEnv("POLICY_NOT_FOUND_PLAIN_WORDING_ENABLED", "");
    expect(line()).toMatch(/^\*\*Policy:\*\* Woven does not see a section of the current policy manual for "key holdr"/);
  });

  it("flag on: 'I don't see …' for every phrase, the rest of the line unchanged", () => {
    vi.stubEnv("POLICY_NOT_FOUND_PLAIN_WORDING_ENABLED", "true");
    expect(line()).toBe(
      `**Policy:** I don't see a section of the current policy manual for "key holdr" in the knowledge base, so I won't cite one. Tell me the policy as the manual names it, or tick Type of Offense and complete Direct policy on the form.`,
    );
  });
});
