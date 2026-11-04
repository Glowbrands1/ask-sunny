import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { managerAccount } = await import("./remap-incident");

/*
 * CA_SALES_POLICY_ENABLED (QA, this app's live chat, 4 Nov 2026, 13:23 UTC,
 * CHAT_GLOSSARY_ENABLED on): "MSB CA for <name> for underperformance in the
 * month of October" put the whole request on the card as the Observation of
 * Offense. The glossary term in front hid the request from the request
 * reader. The manager's words, the person invented.
 */
const SAID = "MSB CA for Osric Vantablade for underperformance in the month of October";
const NAME = "Osric Vantablade";

function flags(on: boolean) {
  vi.stubEnv("CA_SALES_POLICY_ENABLED", on ? "true" : "false");
  vi.stubEnv("CHAT_GLOSSARY_ENABLED", "true");
}
afterEach(() => vi.unstubAllEnvs());

describe("a glossary term before the request is not the account (CA_SALES_POLICY_ENABLED)", () => {
  it("QA's words: the card's Observation holds no request words, as without the glossary term", () => {
    flags(true);
    const account = managerAccount(SAID, NAME);
    expect(account).not.toMatch(/\bMSB\s+CA\b|\bCA\s+for\b/i);
    /*
     * The same account "CA for <name> for …" gives today (the name before
     * "for" is kept for every request worded so; not this change's).
     */
    expect(account).toBe(managerAccount(SAID.replace(/^MSB\s+/, ""), NAME));
    expect(account).toMatch(/underperformance in the month of October$/);
  });

  it("a glossary term that is the account stays: \"MSB was not followed\"", () => {
    flags(true);
    expect(managerAccount("MSB was not followed on the floor", NAME)).toBe("MSB was not followed on the floor");
  });

  it("off: the clause is as on main", () => {
    flags(false);
    expect(managerAccount(SAID, NAME)).toBe(SAID);
  });
});
