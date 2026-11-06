import { afterEach, describe, expect, it, vi } from "vitest";

import { caPolicyProposalLine, readCaPolicy } from "./ca-policy";
import { namedPolicies } from "./named-policy-section";

/*
 * WOVEN_TRAINING_CONDUCT_ENABLED (Pau's ruling, 6 Nov 2026). The sibling app's three live chats, word for word,
 * with the employee swapped for an invented one; this app gave two tentative answers and one with no policy. Each got a different answer; each must read as the Standards of Conduct.
 */
const NOT_SIGNING =
  "start a corrective action for rowan kestrel for not signing the woven policies by 10-30-26 and she signed the jba policy manual on 10-15-26";
const FAILED_TO_MEET =
  "create verbal ca for rowan kestrel. on 10-16-26 Rowan was assigned to complete policy acknowledgements in Woven by 10-31-26. Rowan failed to meet the 10-31-26 deadline.";
const DID_NOT_COMPLETE =
  "create a verbal warning for Rowan Kestrel. previous coaching: JBA Policy Manual 10-15-26. Rowan did not complete the assigned policy acknowledgements in Woven by the 10-31-26 deadline.";

afterEach(() => vi.unstubAllEnvs());

describe("WOVEN_TRAINING_CONDUCT_ENABLED off: what this app says for the sibling app's three live wordings", () => {
  it("\"not signing the woven policies\" reads as no policy: the card has no Policy line", () => {
    expect(readCaPolicy(NOT_SIGNING).suggestion).toBeNull();
    expect(caPolicyProposalLine(readCaPolicy(NOT_SIGNING))).toBeNull();
  });

  it.each([
    ["failed to meet", FAILED_TO_MEET],
    ["did not complete", DID_NOT_COMPLETE],
  ])("%s: only a tentative suggestion", (_, said) => {
    const reading = readCaPolicy(said);
    expect(reading.source).toBe("incident");
    expect(caPolicyProposalLine(reading)).toMatch(/this reads as \*\*Standards of Conduct\*\*.*if the manual doesn't support it/);
  });

  it("a section the manual lacks is said with Woven as the subject", () => {
    expect(caPolicyProposalLine(readCaPolicy("ca for rowan kestrel for violating visitors at work policy"), { phrase: "visitors at work", lookup: "missing" })).toMatch(
      /^\*\*Policy:\*\* Woven does not see a section/,
    );
  });
});

describe("WOVEN_TRAINING_CONDUCT_ENABLED on", () => {
  const on = () => vi.stubEnv("WOVEN_TRAINING_CONDUCT_ENABLED", "true");

  it.each([
    ["not signing", NOT_SIGNING, "not signing the woven policies by 10-30-26"],
    ["failed to meet", FAILED_TO_MEET, "policy acknowledgements"],
    ["did not complete", DID_NOT_COMPLETE, "did not complete the assigned policy acknowledgements in woven by the 10-31-26 deadline"],
  ])("%s: the Standards of Conduct, settled, with the manager's words", (_, said, woven) => {
    on();
    const reading = readCaPolicy(said);
    expect(reading).toMatchObject({ suggestion: "standards_of_conduct", source: "woven", stated: null, ambiguous: null, woven });
  });

  it("\"woven\" in a Woven account names no policy", () => {
    on();
    expect(namedPolicies(NOT_SIGNING)).toEqual([]);
  });

  it("with no manual section read, the card still says the Standards of Conduct, not tentatively", () => {
    on();
    const line = caPolicyProposalLine(readCaPolicy(DID_NOT_COMPLETE)) ?? "";
    expect(line).toMatch(/^\*\*Policy:\*\* Standards of Conduct — required Woven policy acknowledgements or training not completed\./);
    expect(line).not.toMatch(/reads as|doesn't support/);
  });

  it("training and acknowledgements in other words", () => {
    on();
    expect(readCaPolicy("write a ca for rowan kestrel, she never completed her woven training modules").source).toBe("woven");
    expect(readCaPolicy("CA for rowan kestrel for not acknowledging the policies in woven by friday").source).toBe("woven");
    expect(readCaPolicy("ca for rowan kestrel, she missed the woven training").source).toBe("woven");
  });

  it("leaves alone: a policy the manager named, Woven named in passing, an account with no Woven", () => {
    on();
    expect(readCaPolicy(`${DID_NOT_COMPLETE} use the attendance policy`).stated).toBe("attendance");
    expect(readCaPolicy("ca for rowan kestrel, she is in woven as a team member. she was rude to a guest").source).not.toBe("woven");
    expect(readCaPolicy("ca for rowan kestrel, she did not complete her closing checklist").source).toBe("incident");
    expect(readCaPolicy("ca for rowan kestrel for missing the monthly meeting").stated).toBe("attendance");
  });

  it("a section the manual lacks is said in the app's own voice, not with Woven as the subject", () => {
    on();
    const line = caPolicyProposalLine(readCaPolicy("ca for rowan kestrel for violating visitors at work policy"), {
      phrase: "visitors at work",
      lookup: "missing",
    });
    expect(line).toMatch(/^\*\*Policy:\*\* I don't see a section of the current policy manual for "visitors at work"/);
    expect(line).not.toMatch(/Woven does not see/);
  });
});
