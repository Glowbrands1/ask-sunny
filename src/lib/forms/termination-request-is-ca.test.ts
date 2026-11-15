import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { statesTermination } from "./termination-stated";
import { canonicalFormWording, detectTemplateIntent, installTerminationRosterNames } from "./template-intent";

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
    // QA round 3: a lone first name or a title and a shared surname are requests too; the card asks who.
    ["I need to do a termination for Marnie", `I need to do a ${CA} for Marnie`],
    ["create a termination for Marnie", `create a ${CA} for Marnie`],
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
    // QA round 3: a question in ANY clause or sentence makes the message a question; a dot inside a date ends nothing.
    ["create a termination for Marnie Holloway. Is the DM on today?"],
    ["create a termination for Marnie Holloway, she no call no showed 11.12, is that enough?"],
    ["create a termination for Marnie Holloway. Is that enough?"],
    ["create a termination for Marnie Holloway, she no call no showed. is that enough to terminate?"],
    // A first name that is nobody's on the roster is no name.
    ["create a termination for Zed"],
  ])("on, unchanged: %s", (said) => {
    expect(canonicalFormWording(said)).toBe(said);
  });

  it("a title never leaves \"Ms\" as the name for the reader that follows", () => {
    for (const said of ["do a termination for Ms. Holloway", "do a termination for Mrs. Holloway", "do a termination for Dr. Holloway"]) {
      expect(canonicalFormWording(said)).not.toMatch(/\b(?:ms|mrs|dr)\b/i);
    }
  });

  it("a title with a surname two roster people have is a request too (QA round 3): the title goes and the card asks who", () => {
    installTerminationRosterNames(() => [...ROSTER, "Cash Holloway"]);
    expect(canonicalFormWording("do a termination for Ms. Holloway")).toBe(`do a ${CA} for Holloway`);
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

describe("QA round 3: detectTemplateIntent rewrites from the original-case text (production lower-cases it first)", () => {
  beforeEach(() => {
    vi.stubEnv("TERMINATION_REQUEST_IS_CA_ENABLED", "true");
    installTerminationRosterNames(() => ROSTER);
  });
  afterEach(() => {
    installTerminationRosterNames(() => undefined);
    vi.unstubAllEnvs();
  });

  it("an off-roster full name in capitals is a Corrective Action request", () => {
    expect(detectTemplateIntent("create a termination for Zebulon Marchbanks, he no call no showed on 11/12").kind).not.toBe("none");
  });
  it("lower case off the roster is not", () => {
    expect(detectTemplateIntent("create a termination for zebulon marchbanks").kind).toBe("none");
  });
});

describe("QA round 3: the request phrase IS a stated termination (the existing stated path ticks it)", () => {
  beforeEach(() => {
    vi.stubEnv("TERMINATION_STATED_TICKS_ENABLED", "true");
    vi.stubEnv("TERMINATION_REQUEST_IS_CA_ENABLED", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    "create a termination for Marnie Holloway, she no call no showed on 11/12",
    "make a termination CA for Marnie Holloway, she no call no showed",
    "can you write up a termination for Marnie Holloway",
    "I need to do a termination for Marnie",
  ])("ticks: %s", (said) => {
    expect(statesTermination(said)).toBe(true);
  });

  it.each([
    "create a termination for no call no show",
    "should we create a termination for Marnie Holloway?",
    "if she does it again create a termination for Marnie Holloway",
    "don't create a termination for Marnie Holloway, just document it",
  ])("does not tick: %s", (said) => {
    expect(statesTermination(said)).toBe(false);
  });

  it("with the flag off the request phrase ticks nothing, as built", () => {
    vi.stubEnv("TERMINATION_REQUEST_IS_CA_ENABLED", "false");
    expect(statesTermination("create a termination for Marnie Holloway, she no call no showed on 11/12")).toBe(false);
  });
});

describe("TERMINATION_REQUEST_IS_CA_ENABLED off", () => {
  it("unchanged", () => {
    expect(canonicalFormWording("create a termination for Marnie Holloway")).toBe("create a termination for Marnie Holloway");
  });
});
