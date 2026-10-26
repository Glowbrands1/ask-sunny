import { afterEach, describe, expect, it, vi } from "vitest";

import { NOTHING_LEFT, withoutOtherBrands } from "./brand-reply-guard";

/**
 * ============================================================================
 * A REPLY SPEAKS FOR SUN TAN CITY ONLY (BRAND_REPLY_GUARD_ENABLED)
 * ============================================================================
 *
 * Ported from the sibling app (QA, 25 Oct 2026, testers G21/U1/U6): the JBA
 * manual's company-wide text lists every brand, and the model's prose carried
 * that list into an answer. Here the other company is the sibling one; Sun
 * Tan City's own wording, JB & Associates and the shared tanning sections stay.
 * Questions in the managers' register: "what does our policy say about
 * attendance?", "late opening policy", "whats policy say about changing
 * availabilty".
 */

afterEach(() => vi.unstubAllEnvs());
const on = () => vi.stubEnv("BRAND_REPLY_GUARD_ENABLED", "true");

const REPLIES = {
  attendance:
    "The attendance policy applies across all brands (Buff City Soap, Crunch, Sun Tan City, JB & Associates office) [p.14]. A no call no show for a scheduled shift may result in immediate termination [p.14].",
  availability:
    "Submit availability changes two weeks ahead in MyGlow for Sun Tan City, or MyGlow for Buff City Soap [p.37].",
  onlyOther: "Late Opening applies to the salon [p.15]. Buff City Soap stores follow the same rule.",
  slash: "If you can't open the salon/store on time, notify your manager [p.15].",
};

describe("flag off: the reply as written", () => {
  it.each(Object.entries(REPLIES))("%s", (_name, reply) => {
    expect(withoutOtherBrands(reply)).toBe(reply);
  });
});

describe("flag on: Sun Tan City only, citations kept", () => {
  it("attendance: the list loses its sibling-company item only", () => {
    on();
    const out = withoutOtherBrands(REPLIES.attendance);
    expect(out).not.toMatch(/buff city/i);
    expect(out).toContain("A no call no show for a scheduled shift may result in immediate termination [p.14].");
  });

  it("availability: Sun Tan City's own system is kept", () => {
    on();
    expect(withoutOtherBrands(REPLIES.availability)).toBe(
      "Submit availability changes two weeks ahead in MyGlow for Sun Tan City [p.37].",
    );
  });

  it("a sentence only about the sibling company is dropped", () => {
    on();
    expect(withoutOtherBrands(REPLIES.onlyOther)).toBe("Late Opening applies to the salon [p.15].");
  });

  it('"salon/store" is "salon"', () => {
    on();
    expect(withoutOtherBrands(REPLIES.slash)).toBe("If you can't open the salon on time, notify your manager [p.15].");
  });
});

describe("flag on: Sun Tan City's own wording stays", () => {
  it.each([
    "For Sun Tan City and Crunch tanning rooms specifically, service animals are allowed in the tanning room [p.50].",
    "JB & Associates office staff follow the same attendance policy [p.14].",
    "Cite the JBA Policy Manual, Late Opening, p.15.",
    "Ask your salon director to approve the change.",
  ])("%s", (reply) => {
    on();
    expect(withoutOtherBrands(reply)).toBe(reply);
  });
});

/* QA-2 review, 26 Oct 2026: never an empty reply; quoted titles kept as written. */
describe("flag on: QA-2 review", () => {
  it.each(["Buff City Soap applies this to its stores.", "Policy: Buff City Soap Policy Manual [p.14]."])(
    "never empties a reply: %s",
    (reply) => {
      on();
      expect(withoutOtherBrands(reply)).toBe(NOTHING_LEFT);
      expect(NOTHING_LEFT).toContain("Sun Tan City");
      expect(NOTHING_LEFT).not.toMatch(/buff city/i);
    },
  );

  it.each(['See "Salon/Store Opening" on the card [p.15].', "Cite the Salon Director Manual, Late Opening [p.15]."])(
    "keeps quoted text and manual titles: %s",
    (reply) => {
      on();
      expect(withoutOtherBrands(reply)).toBe(reply);
    },
  );
});
