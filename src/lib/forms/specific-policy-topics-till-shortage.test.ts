import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ManualChunk } from "./official-policy-manual";
import { conductLineCitation, specificTopic } from "./specific-policy-topics";

/**
 * QA's live test (24 Nov 2026): "Draft a corrective action form for a till shortage for Test Employee" is the manual's
 * Standards of Conduct line "Register / Bank shortages". The owner, the same day: "till" is the cash register, and
 * managers also spell it "til"; every way of saying the register came up short is that line, and "til" / "till" / "until"
 * as a time word ("til tomorrow", "till next week") never is. The loop card's citation is covered by the replay pack
 * (`nov24-agent-loop-conduct-line-on-card-cases.ts`).
 */
beforeEach(() => vi.stubEnv("POLICY_SPECIFIC_TOPICS_ENABLED", "true"));
afterEach(() => vi.unstubAllEnvs());

describe("the cash rule reads the register's shortage, however it is spelled", () => {
  it.each([
    "Draft a corrective action form for a till shortage for Test Employee",
    "ca for Test Employee, til shortage on 11/22",
    "ca for Test Employee, her till short $12",
    "ca for Test Employee, she was short in the til by $20",
    "ca for Test Employee, cash register short $15",
    "ca for Test Employee, drawer short again",
    "ca for Test Employee, the register was short $8 at close",
    "ca for Test Employee, her til was short $5",
    /* The owner, 24 Nov 2026: "missing till" is a shortage too. */
    "ca for Test Employee, missing till on 11/22",
    "ca for Test Employee, till missing $40",
    "ca for Test Employee, $20 missing from the till",
    "ca for Test Employee, money missing from the til",
    "ca for Test Employee, the till was missing $25",
    "ca for Test Employee, the til was missing $10",
    "ca for Test Employee, missing money from the register",
  ])("%s → Register / Bank shortages", (said) => {
    expect(specificTopic(said)?.id).toBe("cash");
  });

  it.each([
    "ca for Test Employee, she said she is off til tomorrow and we were short staffed",
    "ca for Test Employee, she is out till next week, we are short handed",
    "ca for Test Employee, she stayed until close and was missing her name tag",
    "ca for Test Employee, she did not clock out til 10 and her break was off",
    "ca for Test Employee, she was off till monday",
    "ca for Test Employee, she stayed till close, short staffed again",
    "ca for Test Employee, she is out til monday short a closer",
    "ca for Test Employee, missing shift on saturday",
    "ca for Test Employee, missing inventory in the back room",
  ])("%s → not a shortage (til / till / until as a time word, or missing something else)", (said) => {
    expect(specificTopic(said)?.id).not.toBe("cash");
  });
});

describe("conductLineCitation", () => {
  const chunks: ManualChunk[] = [
    { chunkIndex: 39, chunkId: "c39", locator: "Page 12 — Standards of Conduct", page: 13, content: "Standards of Conduct\nEmployees are expected to …", section: "Standards of Conduct", printedPage: 12, sections: [{ page: 12, heading: "Standards of Conduct" }] },
    { chunkIndex: 40, chunkId: "c40", locator: "Page 13 — Standards of Conduct", page: 14, content: "o Insubordination -the refusal to follow the directions of the manager.\no Register / Bank shortages\no Theft, inappropriate removal or possession of company or customer property", section: "Standards of Conduct", printedPage: 13, sections: [] },
    { chunkIndex: 41, chunkId: "c41", locator: "Page 14 — Disciplinary Action", page: 15, content: "Disciplinary Action\n…", section: "Disciplinary Action", printedPage: 14, sections: [{ page: 14, heading: "Disciplinary Action" }] },
  ] as unknown as ManualChunk[];

  it("a till shortage names the Register / Bank shortages line at its printed page 13", () => {
    expect(conductLineCitation("Draft a corrective action form for a till shortage for Test Employee", chunks)).toMatchObject({ heading: "Standards of Conduct", line: "Register / Bank shortages", page: 13 });
  });

  it.each([
    ["she refused to do what I asked", "Insubordination"],
    ["he stole $40 from the register", "Theft"],
  ])("%s → %s, p.13", (said, line) => {
    expect(conductLineCitation(said, chunks)).toMatchObject({ line, page: 13 });
  });

  it("no listed line, or the flag off → null", () => {
    expect(conductLineCitation("she was late opening the salon", chunks)).toBeNull();
    vi.stubEnv("POLICY_SPECIFIC_TOPICS_ENABLED", "false");
    expect(conductLineCitation("Draft a corrective action form for a till shortage for Test Employee", chunks)).toBeNull();
  });
});
