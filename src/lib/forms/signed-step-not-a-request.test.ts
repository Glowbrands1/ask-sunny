import { afterEach, describe, expect, it, vi } from "vitest";

import { readFormRequests } from "./form-requests";

/**
 * SIGNED_STEP_NOT_A_REQUEST_ENABLED (QA's Bubbles live tester, round 4, 8 Nov 2026; the employee invented). The replay
 * pack covers the route (`nov8-s35-signed-coaching-is-history-cases.ts`).
 */
const SAID =
  "Can you draw me up a CA for Tamsin Vale for being late on 10/23/26. Tamsin Vale has signed a coaching document for being late on 10/14/26. I need you to make sure the policy is on this CA.";

afterEach(() => vi.unstubAllEnvs());

describe("SIGNED_STEP_NOT_A_REQUEST_ENABLED", () => {
  it("off: the signed coaching reads as a second request (the reported two cards)", () => {
    expect(readFormRequests(SAID)?.requests.map((request) => request.templateKey)).toEqual(["dpoa", "coaching"]);
  });

  it("on: one request, the CA", () => {
    vi.stubEnv("SIGNED_STEP_NOT_A_REQUEST_ENABLED", "true");
    expect(readFormRequests(SAID)).toBeNull();
  });

  it.each([
    "make a CA for Tamsin Vale for being late on 10/23/26 and a coaching form for Tamsin Vale for her phone use",
    "coaching form for Tamsin Vale and a CA for Juno Paxton",
  ])("on, negative: %j is still two requests", (text) => {
    vi.stubEnv("SIGNED_STEP_NOT_A_REQUEST_ENABLED", "true");
    expect(readFormRequests(text)?.requests.length).toBe(2);
  });
});
