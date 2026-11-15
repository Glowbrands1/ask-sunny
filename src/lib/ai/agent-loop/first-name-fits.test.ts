import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { firstNameFits, matchEmployeeName, sameSurnameOtherFirstName, type RosterEmployee } from "@/lib/forms/employee-match";

import { otherPersonQuestion, otherPersonTyped } from "./first-name-fits";
import { rosterMatches, type ToolContext } from "./tools";

/**
 * QA, 15 Nov 2026, from Ask Bubbles: the manager typed "Salem Pool" and the form switched to the roster's "Melanie
 * Pool". A shared last name with a different first name is never a strong or close match. Every name is invented.
 */
const MELANIE: RosterEmployee = { id: "e-melanie", firstName: "Melanie", lastName: "Pool", salonIds: ["loc-0309"] };
/** QA, 15 Nov 2026: in the report the typed first name was the employee's preferred first name in Woven. */
const PREFERRED: RosterEmployee = { id: "e-rae", firstName: "Lorraine", preferredFirstName: "Rae", lastName: "Pool", salonIds: ["loc-0309"] };
const ROSTER = [MELANIE];

function context(question: string, history: { role: "user" | "assistant"; content: string }[] = []): ToolContext {
  return { question, history, actor: {} as never, request: {} as never, scopeId: "s", today: "2026-11-14" } as unknown as ToolContext;
}

describe("the shared matcher: the first name must fit", () => {
  it.each([
    ["salem pool", "none"],
    ["Salem Pool", "none"],
    ["melany pool", "confirm"],
    ["melanie pool", "exact"],
  ])("matchEmployeeName(%s) is %s", (typed, kind) => {
    expect(matchEmployeeName(typed, ROSTER).kind).toBe(kind);
  });

  it.each([
    ["melanie", true],
    ["melany", true],
    ["mel", true],
    ["salem", false],
    ["sal", false],
  ])("firstNameFits(%s, Melanie) is %s", (typed, fits) => {
    expect(firstNameFits(typed, MELANIE)).toBe(fits);
  });

  it("a shared surname with another first name is someone else; another surname is not this check", () => {
    expect(sameSurnameOtherFirstName("salem pool", MELANIE)).toBe(true);
    expect(sameSurnameOtherFirstName("melany pool", MELANIE)).toBe(false);
    expect(sameSurnameOtherFirstName("salem smith", MELANIE)).toBe(false);
    expect(sameSurnameOtherFirstName("pool", MELANIE)).toBe(false);
  });

  it("find_staff's own word match finds nobody for salem pool (the surname alone still finds her)", () => {
    expect(rosterMatches("salem pool", ROSTER)).toEqual([]);
    expect(rosterMatches("pool", ROSTER)).toEqual([MELANIE]);
  });
});

describe("FIRST_NAME_MUST_FIT_ENABLED on: the loop never seats Melanie for Salem", () => {
  beforeEach(() => vi.stubEnv("FIRST_NAME_MUST_FIT_ENABLED", "true"));
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["write up salem pool for being late", "salem Pool"],
    ["Create a CA for Salem Pool, she was late", "Salem Pool"],
  ])("%s → someone else (%s)", (said, typed) => {
    expect(otherPersonTyped(context(said), MELANIE)?.toLowerCase()).toBe(typed.toLowerCase());
  });

  it.each([
    ["write up melany pool for being late"],
    ["write up mel pool for being late"],
    ["write up pool for being late"],
    ["write up salem smith for being late"],
  ])("%s → not someone else", (said) => {
    expect(otherPersonTyped(context(said), MELANIE)).toBeNull();
  });

  it("the manager's own correction to her first name is her", () => {
    expect(otherPersonTyped(context("sorry i meant melanie pool", [{ role: "user", content: "write up salem pool" }]), MELANIE)).toBeNull();
  });

  it("a yes to this chat's own question naming her is the manager choosing her", () => {
    const asked = { role: "assistant" as const, content: `${otherPersonQuestion("salem pool", MELANIE)} Did you mean **Melanie Pool**?` };
    expect(otherPersonTyped(context("yes", [{ role: "user", content: "write up salem pool" }, asked]), MELANIE)).toBeNull();
  });

  it("the question, in QA's words", () => {
    expect(otherPersonQuestion("salem Pool", MELANIE)).toBe("Salem Pool isn't on your staff list. Did you mean Melanie Pool, or someone else?");
  });
});

describe("the preferred first name typed is that person, with no question", () => {
  beforeEach(() => vi.stubEnv("FIRST_NAME_MUST_FIT_ENABLED", "true"));
  afterEach(() => vi.unstubAllEnvs());

  it("\"rae pool\" is Lorraine Pool (preferred Rae): exact, and the loop never treats her as someone else", () => {
    const found = matchEmployeeName("rae pool", [PREFERRED]);
    expect(found.kind).toBe("exact");
    expect(found.kind === "exact" ? found.employee.id : null).toBe("e-rae");
    expect(firstNameFits("rae", PREFERRED)).toBe(true);
    expect(otherPersonTyped(context("write up rae pool for being late"), PREFERRED)).toBeNull();
  });
});

describe("FIRST_NAME_MUST_FIT_ENABLED off: as before", () => {
  it("nothing is refused", () => {
    expect(otherPersonTyped(context("write up salem pool for being late"), MELANIE)).toBeNull();
  });
});
