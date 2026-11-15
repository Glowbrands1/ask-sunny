import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { displayName } from "./employee-match";
import { matchRowsToQuestion } from "./chat-form-records";
import type { InstanceRow } from "./instances";
import { aliasForRosterPerson, installPreferredAliases, rosterAliasesOf, sameRosterPerson, withPreferredNameShown } from "./preferred-name-shown";
import { extractEmployeeNames, samePerson, tidyTypedName } from "./proposal";
import { readableName } from "./readable-name";
import { cleanPersonName } from "./roster-validated-name";
import type { AskResponse } from "@/lib/ai/types";

/** QA's independent review of #1013 (15 Nov 2026), findings 5–9, in the reviewer's wording. Invented names. */
beforeEach(() => vi.stubEnv("READABLE_NAMES_ENABLED", "true"));
afterEach(() => {
  installPreferredAliases(() => undefined);
  vi.unstubAllEnvs();
});

describe("5: the last word is the surname, never lowercased and never cut", () => {
  it.each([
    ["thanh le", "Thanh Le"],
    ["kim du", "Kim Du"],
    ["LINH DA", "Linh Da"],
    ["maria de la torre", "Maria de la Torre"],
    ["jose de la cruz jr", "Jose de la Cruz Jr."],
  ])("%s → %s", (typed, shown) => {
    expect(readableName(typed)).toBe(shown);
    expect(tidyTypedName(typed)).toBe(shown);
  });

  it("a roster row whose surname is a particle", () => {
    expect(displayName({ id: "x", firstName: "THANH", lastName: "LE", salonIds: [] })).toBe("Thanh Le");
    expect(displayName({ id: "x", firstName: "John", lastName: "Van", salonIds: [] })).toBe("John Van");
  });

  it.each([
    ["ca for kim le, she was late", "kim le"],
    ["kim le", "kim le"],
    ["create a ca for thanh le, she was late on 11/12", "thanh le"],
  ])("%s reads %s", (said, name) => {
    expect(extractEmployeeNames(said)).toEqual([name]);
  });
});

const LORRAINE = { legal: "Lorraine Fairweather", preferred: "Rae Fairweather" };
const OTHER_RAE = { legal: "Rae Fairweather", preferred: "Rae Fairweather" };

describe("6: two roster people are never merged — the check reads every roster person", () => {
  it("a legal Rae Fairweather with no preferred name blocks the merge, in every lookup", () => {
    installPreferredAliases(() => [LORRAINE, OTHER_RAE]);
    expect(rosterAliasesOf("Lorraine Fairweather")).toEqual(["Lorraine Fairweather"]);
    expect(rosterAliasesOf("Rae Fairweather")).toEqual(["Rae Fairweather"]);
    expect(sameRosterPerson("Lorraine Fairweather", "Rae Fairweather")).toBe(false);
    expect(samePerson("Lorraine Fairweather", "Rae Fairweather")).toBe(false);
  });

  it("the card for the other Rae is left as it is", () => {
    installPreferredAliases(() => [LORRAINE, OTHER_RAE]);
    const card = { content: "For **Rae Fairweather**.", formProposal: { employeeName: "Rae Fairweather" } } as unknown as AskResponse;
    expect(withPreferredNameShown(card, "write up rae fairweather")).toBe(card);
  });
});

describe("7: an all-caps roster row reads readable on both names", () => {
  it("LORRAINE FAIRWEATHER, preferred RAE", () => {
    const shown = (row: { firstName: string; lastName: string }) => displayName({ id: "x", salonIds: [], ...row });
    expect(aliasForRosterPerson({ firstName: "LORRAINE", lastName: "FAIRWEATHER", preferredFirstName: "RAE" }, shown)).toEqual({ legal: "Lorraine Fairweather", preferred: "Rae Fairweather" });
    expect(aliasForRosterPerson({ firstName: "LORRAINE", lastName: "FAIRWEATHER", preferredFirstName: "Rae" }, shown)).toEqual({ legal: "Lorraine Fairweather", preferred: "Rae Fairweather" });
  });
});

describe("8: forms on file named by the other name", () => {
  const row = (employeeName: string) => ({ id: "f1", employeeName }) as unknown as InstanceRow;
  it("a form saved as Rae Fairweather is named, not possible, when Lorraine Fairweather is asked — and back", () => {
    installPreferredAliases(() => [LORRAINE]);
    expect(matchRowsToQuestion([row("Rae Fairweather")], ["lorraine", "fairweather"]).named).toHaveLength(1);
    expect(matchRowsToQuestion([row("Lorraine Fairweather")], ["rae", "fairweather"]).named).toHaveLength(1);
  });
  it("never for another roster person with that name", () => {
    installPreferredAliases(() => [LORRAINE, OTHER_RAE]);
    expect(matchRowsToQuestion([row("Rae Fairweather")], ["lorraine", "fairweather"]).named).toHaveLength(0);
  });
});

describe("9: typed all-caps words are readable, particles lowercase", () => {
  it.each([
    ["MARIA DEL RIO", "Maria del Rio"],
    ["ANA LEE", "Ana Lee"],
  ])("%s → %s", (typed, shown) => {
    expect(cleanPersonName(typed, [])).toBe(shown);
  });
});
