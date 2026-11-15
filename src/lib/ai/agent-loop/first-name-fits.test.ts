import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { firstNameFits, matchEmployeeName, sameSurnameOtherFirstName, type RosterEmployee } from "@/lib/forms/employee-match";

import { otherPersonQuestion, otherPersonTyped } from "./first-name-fits";
import { rosterMatches, type ToolContext } from "./tools";

/**
 * QA, 15 Nov 2026, from Ask Bubbles: the manager typed "Soren Fairweather" and the form switched to the roster's "Marisol
 * Fairweather". A shared last name with a different first name is never a strong or close match. Every name is invented.
 */
const MARISOL: RosterEmployee = { id: "e-marisol", firstName: "Marisol", lastName: "Fairweather", salonIds: ["loc-0309"] };
/** QA, 15 Nov 2026: in the report the typed first name was the employee's preferred first name in Woven. */
const PREFERRED: RosterEmployee = { id: "e-rae", firstName: "Lorraine", preferredFirstName: "Rae", lastName: "Fairweather", salonIds: ["loc-0309"] };
const ROSTER = [MARISOL];

function context(question: string, history: { role: "user" | "assistant"; content: string }[] = []): ToolContext {
  return { question, history, actor: {} as never, request: {} as never, scopeId: "s", today: "2026-11-14" } as unknown as ToolContext;
}

describe("the shared matcher: the first name must fit", () => {
  it.each([
    ["soren fairweather", "none"],
    ["Soren Fairweather", "none"],
    ["marisal fairweather", "confirm"],
    ["marisol fairweather", "exact"],
  ])("matchEmployeeName(%s) is %s", (typed, kind) => {
    expect(matchEmployeeName(typed, ROSTER).kind).toBe(kind);
  });

  it.each([
    ["marisol", true],
    ["marisal", true],
    ["mari", true],
    ["soren", false],
    ["sor", false],
  ])("firstNameFits(%s, Marisol) is %s", (typed, fits) => {
    expect(firstNameFits(typed, MARISOL)).toBe(fits);
  });

  it("a shared surname with another first name is someone else; another surname is not this check", () => {
    expect(sameSurnameOtherFirstName("soren fairweather", MARISOL)).toBe(true);
    expect(sameSurnameOtherFirstName("marisal fairweather", MARISOL)).toBe(false);
    expect(sameSurnameOtherFirstName("soren smith", MARISOL)).toBe(false);
    expect(sameSurnameOtherFirstName("fairweather", MARISOL)).toBe(false);
  });

  it("find_staff's own word match finds nobody for soren fairweather (the surname alone still finds her)", () => {
    expect(rosterMatches("soren fairweather", ROSTER)).toEqual([]);
    expect(rosterMatches("fairweather", ROSTER)).toEqual([MARISOL]);
  });
});

describe("FIRST_NAME_MUST_FIT_ENABLED on: the loop never seats Marisol for Soren", () => {
  beforeEach(() => vi.stubEnv("FIRST_NAME_MUST_FIT_ENABLED", "true"));
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["write up soren fairweather for being late", "soren Fairweather"],
    ["Create a CA for Soren Fairweather, she was late", "Soren Fairweather"],
  ])("%s → someone else (%s)", (said, typed) => {
    expect(otherPersonTyped(context(said), MARISOL)?.toLowerCase()).toBe(typed.toLowerCase());
  });

  it.each([
    ["write up marisal fairweather for being late"],
    ["write up mari fairweather for being late"],
    ["write up fairweather for being late"],
    ["write up soren smith for being late"],
  ])("%s → not someone else", (said) => {
    expect(otherPersonTyped(context(said), MARISOL)).toBeNull();
  });

  it("the manager's own correction to her first name is her", () => {
    expect(otherPersonTyped(context("sorry i meant marisol fairweather", [{ role: "user", content: "write up soren fairweather" }]), MARISOL)).toBeNull();
  });

  it("a yes to this chat's own question naming her is the manager choosing her", () => {
    const asked = { role: "assistant" as const, content: `${otherPersonQuestion("soren fairweather", MARISOL)} Did you mean **Marisol Fairweather**?` };
    expect(otherPersonTyped(context("yes", [{ role: "user", content: "write up soren fairweather" }, asked]), MARISOL)).toBeNull();
  });

  it("the question, in QA's words", () => {
    expect(otherPersonQuestion("soren Fairweather", MARISOL)).toBe("Soren Fairweather isn't on your staff list. Did you mean Marisol Fairweather, or someone else?");
  });
});

describe("the preferred first name typed is that person, with no question", () => {
  beforeEach(() => vi.stubEnv("FIRST_NAME_MUST_FIT_ENABLED", "true"));
  afterEach(() => vi.unstubAllEnvs());

  it("\"rae fairweather\" is Lorraine Fairweather (preferred Rae): exact, and the loop never treats her as someone else", () => {
    const found = matchEmployeeName("rae fairweather", [PREFERRED]);
    expect(found.kind).toBe("exact");
    expect(found.kind === "exact" ? found.employee.id : null).toBe("e-rae");
    expect(firstNameFits("rae", PREFERRED)).toBe(true);
    expect(otherPersonTyped(context("write up rae fairweather for being late"), PREFERRED)).toBeNull();
  });
});

describe("FIRST_NAME_MUST_FIT_ENABLED off: as before", () => {
  it("nothing is refused", () => {
    expect(otherPersonTyped(context("write up soren fairweather for being late"), MARISOL)).toBeNull();
  });
});
