import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { besidesTheName } from "@/lib/ai/first-name-suggest";
import { outsideRequestSlot } from "@/lib/forms/request-slot";

/**
 * QA's round-22 eval check (10 Nov 2026): with the roster-name set on, two cards lost what the manager gave. The
 * wording is the eval's (evals/replay_set.json sf-s4 and s14; names invented there).
 */
afterEach(() => vi.unstubAllEnvs());

describe("sf-s4: a lower-case surname typed after the request's \"for\" is part of the name", () => {
  const SAID = "make me a CA for Odalys merriwether for being late to opening this morning";

  it("FORM_NAME_FROM_ROSTER on: \"Odalys Merriwether\" is in the request slot, not ruled out (nobody on the roster)", () => {
    vi.stubEnv("FORM_NAME_FROM_ROSTER_ENABLED", "true");
    expect(outsideRequestSlot("Odalys Merriwether", SAID)).toBe(false);
    expect(outsideRequestSlot("Odalys", SAID)).toBe(false);
  });

  it("an account verb after the name is still not part of it", () => {
    vi.stubEnv("FORM_NAME_FROM_ROSTER_ENABLED", "true");
    vi.stubEnv("ACCOUNT_VERB_NOT_A_NAME_ENABLED", "true");
    expect(outsideRequestSlot("Rhea Calloway Failing", "make me CA for Rhea Calloway failing to complete shifts")).toBe(true);
  });
});

describe("s14: \"Oops, it's <name>\" answering \"Is this for <name>?\" says nothing besides the name", () => {
  it("ROSTER_NEAR_MISS on: the correction words before the name are dropped", () => {
    vi.stubEnv("ROSTER_NEAR_MISS_ENABLED", "true");
    expect(besidesTheName("Oops, it's Rozlyn quellmar", "Rozlyn Quellmar")).toBe("");
    expect(besidesTheName("sorry, it is Rozlyn Quellmar", "Rozlyn Quellmar")).toBe("");
    // What the answer says after the name is kept, as before.
    expect(besidesTheName("Rozlyn Quellmar 11/7 and 11/8", "Rozlyn Quellmar")).toBe(" 11/7 and 11/8");
  });

  it("off: as before (the lead-in was kept)", () => {
    vi.stubEnv("ROSTER_NEAR_MISS_ENABLED", "false");
    expect(besidesTheName("Oops, it's Rozlyn quellmar", "Rozlyn Quellmar")).toBe(" Oops, it's");
  });
});
