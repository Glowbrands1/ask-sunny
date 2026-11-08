import { afterEach, describe, expect, it, vi } from "vitest";

import { nameBeforeAccountVerb } from "./not-a-name";
import { extractEmployeeNames } from "./proposal";

/**
 * ACCOUNT_VERB_NOT_A_NAME_ENABLED (QA round 5, sf-s38, 8 Nov 2026; Pau approved the forms/proposal.ts lines, "Ok
 * proposal.ts cut", 8 Nov 2026 ~12:10 PHT): the name reader cuts a candidate at the first account verb, never at any
 * other lower-case word. The people invented. The replay pack covers the route through Create
 * (`nov8-account-verb-not-a-name-cases.ts`).
 */
afterEach(() => vi.unstubAllEnvs());

function on() {
  vi.stubEnv("NOT_A_NAME_GUARD_ENABLED", "true");
  vi.stubEnv("ACCOUNT_VERB_NOT_A_NAME_ENABLED", "true");
}

describe("ACCOUNT_VERB_NOT_A_NAME_ENABLED", () => {
  it("off: the reader keeps the verb (the reported card)", () => {
    vi.stubEnv("NOT_A_NAME_GUARD_ENABLED", "true");
    expect(extractEmployeeNames("make me CA for rhea failing to complete shifts")).toEqual(["rhea failing"]);
    expect(nameBeforeAccountVerb("Rhea Calloway missing")).toBe("Rhea Calloway missing");
  });

  it.each([
    ["make me CA for rhea failing to complete shifts", ["rhea"]],
    ["make me CA for Rhea Calloway failing to complete shifts", ["Rhea Calloway"]],
    [
      "make me an CA for Rhea Calloway missing her saturday and sunday shifts due to wanting to go home for the weekend but failed to communicate proporley",
      ["Rhea Calloway"],
    ],
    ["make me a CA for Ines Varga-Lund missing her shift", ["Ines Varga-Lund"]],
  ])("on, fixed: %j → %j", (text, names) => {
    on();
    expect(extractEmployeeNames(text)).toEqual(names);
  });

  it.each([
    ["make me a CA for rhea calloway", ["rhea calloway"]],
    ["ca for rhea calloway being late on 11/2", ["rhea calloway"]],
    ["make me a CA for Mary-Jane O'Neil, she was late", ["Mary-Jane O'Neil"]],
    ["make me a CA for Caoimhe O'Dallagher, they were late opening the salon on 11/2", ["Caoimhe O'Dallagher"]],
    ["Make me a CA for Rhea Calloway not showing up to her shifts on  11/7 and 11/8", ["Rhea Calloway"]],
  ])("on, must not change: %j → %j", (text, names) => {
    vi.stubEnv("NOT_A_NAME_GUARD_ENABLED", "true");
    const before = extractEmployeeNames(text);
    on();
    expect(extractEmployeeNames(text)).toEqual(before);
    expect(before).toEqual(names);
  });

  it("only an account verb cuts; another lower-case word never does", () => {
    on();
    expect(nameBeforeAccountVerb("Maria de la Cruz")).toBe("Maria de la Cruz");
    expect(nameBeforeAccountVerb("Pieter van der Berg")).toBe("Pieter van der Berg");
    expect(nameBeforeAccountVerb("failing")).toBe("failing");
    expect(nameBeforeAccountVerb("Rhea not")).toBe("Rhea");
  });
});
