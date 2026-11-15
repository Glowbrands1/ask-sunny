import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { canonicalFormWording, installTerminationRosterNames } from "./template-intent";

/**
 * QA, 15 Nov 2026: "create a termination for <A>, …" gave a policy answer and no card. QA's re-review: a whitelist at the
 * start of a sentence, a "?" only when it ends that sentence, and a name that resolves (a roster person, a title and a
 * roster surname, or an off-roster full name). Invented names.
 */
const ROSTER = ["Marnie Holloway", "Remy Calder", "Juno Paxton"];
const CA = "termination corrective action";

describe("TERMINATION_REQUEST_IS_CA_ENABLED, with the roster read", () => {
  beforeEach(() => {
    vi.stubEnv("TERMINATION_REQUEST_IS_CA_ENABLED", "true");
    installTerminationRosterNames(() => ROSTER);
  });
  afterEach(() => {
    installTerminationRosterNames(() => undefined);
    vi.unstubAllEnvs();
  });

  it.each([
    ["create a termination for Marnie Holloway", `create a ${CA} for Marnie Holloway`],
    ["create a termination for Marnie Holloway, she no call no showed", `create a ${CA} for Marnie Holloway, she no call no showed`],
    // QA's re-review: real requests the blacklist refused.
    ["can you create a termination for Marnie Holloway", `can you create a ${CA} for Marnie Holloway`],
    ["could you make a termination for marnie holloway", `could you make a ${CA} for marnie holloway`],
    ["need a termination for Marnie Holloway", `need a ${CA} for Marnie Holloway`],
    ["create a termination for Marnie Holloway. Is the DM on today?", `create a ${CA} for Marnie Holloway. Is the DM on today?`],
    // QA's second re-review: the title is stripped before the name resolves and from the request read on.
    ["do a termination for Ms. Holloway", `do a ${CA} for Holloway`],
    ["do a termination for Mrs. Holloway, she walked out", `do a ${CA} for Holloway, she walked out`],
    ["make a termination for Dr Holloway", `make a ${CA} for Holloway`],
    ["create a termination for Mx. Holloway", `create a ${CA} for Holloway`],
    ["create a termination for Mr. Marnie Holloway", `create a ${CA} for Marnie Holloway`],
    ["please create a termination CA for Remy Calder", `please create a ${CA} for Remy Calder`],
    ["create a termination for Zebulon Marchbanks, he walked out", `create a ${CA} for Zebulon Marchbanks, he walked out`],
  ])("on: %s", (said, read) => {
    expect(canonicalFormWording(said)).toBe(read);
  });

  it.each([
    ["create termination paperwork for Marnie Holloway"],
    // QA's second re-review: "form" is not in the suffix; the Exit form stays the Exit form, as on main.
    ["create a termination form for Marnie Holloway"],
    ["do a termination form for Remy Calder"],
    ["need a termination paperwork for Marnie Holloway"],
    ["what is the termination policy for no call no shows"],
    ["termination for Marnie Holloway"],
    // Questions (QA's review of #1014), and the re-review's two that passed as requests.
    ["how do i do a termination for Marnie Holloway?"],
    ["Do I need a termination for Marnie Holloway or just a written?"],
    ["should I do a termination for Marnie Holloway"],
    ["what do I need to do a termination for Marnie Holloway"],
    ["do we need a termination for job abandonment"],
    ["can you create a termination for Marnie Holloway?"],
    ["So do I create a termination for Marnie Holloway or not"],
    ["I think we should do a termination for Marnie Holloway"],
    // No person after "for".
    ["create a termination for no call no show"],
    ["create a termination for job abandonment"],
    ["create a termination for her"],
    // A first name alone resolves to no full name (QA: a name that resolves).
    ["I need to do a termination for Marnie"],
  ])("on, unchanged: %s", (said) => {
    expect(canonicalFormWording(said)).toBe(said);
  });

  it("a title never leaves \"Ms\" as the name for the reader that follows", () => {
    for (const said of ["do a termination for Ms. Holloway", "do a termination for Mrs. Holloway", "do a termination for Dr. Holloway"]) {
      expect(canonicalFormWording(said)).not.toMatch(/\b(?:ms|mrs|dr)\b/i);
    }
  });

  it("a title with a surname two roster people have does not resolve", () => {
    installTerminationRosterNames(() => [...ROSTER, "Cash Holloway"]);
    expect(canonicalFormWording("do a termination for Ms. Holloway")).toBe("do a termination for Ms. Holloway");
  });

  it("\"Cash\" is a roster first name, never an offense word", () => {
    installTerminationRosterNames(() => [...ROSTER, "Cash Holloway"]);
    expect(canonicalFormWording("create a termination for Cash Holloway")).toBe(`create a ${CA} for Cash Holloway`);
  });
});

describe("TERMINATION_REQUEST_IS_CA_ENABLED, no roster (a pure caller)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("a name-shaped full name only", () => {
    vi.stubEnv("TERMINATION_REQUEST_IS_CA_ENABLED", "true");
    expect(canonicalFormWording("make a termination for marnie holloway")).toBe(`make a ${CA} for marnie holloway`);
    expect(canonicalFormWording("create a termination for no call no show")).toBe("create a termination for no call no show");
    expect(canonicalFormWording("create a termination for Marnie")).toBe("create a termination for Marnie");
  });
});

describe("TERMINATION_REQUEST_IS_CA_ENABLED off", () => {
  it("unchanged", () => {
    expect(canonicalFormWording("create a termination for Marnie Holloway")).toBe("create a termination for Marnie Holloway");
  });
});
