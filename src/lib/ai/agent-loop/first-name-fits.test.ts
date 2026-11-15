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
    [["soren fairweather"], "soren fairweather"],
    [["Soren Fairweather"], "Soren Fairweather"],
    // The model searched the full name, found nobody, then the surname alone: the full name is still the one it asked for.
    [["soren fairweather", "fairweather"], "soren fairweather"],
  ])("the model asked for %j → someone else (%s)", (names, typed) => {
    expect(otherPersonTyped(context("write up soren fairweather for being late"), MARISOL, names)).toBe(typed);
  });

  it.each([
    [["marisal fairweather"]],
    [["mari fairweather"]],
    [["fairweather"]],
    [["soren smith"]],
    [["Marisol Fairweather"]],
  ])("the model asked for %j → not someone else", (names) => {
    expect(otherPersonTyped(context("write up her for being late"), MARISOL, names)).toBeNull();
  });

  /*
   * QA's review of #1008, finding 1: the word before the surname in the MESSAGE was read as a first name, so a verb or
   * a title was ("coach fairweather on punctuality" gave "Coach Fairweather isn't on your staff list"). The message is
   * never read; the model's lookup of the surname alone has no first name to check.
   */
  it.each([
    ["coach fairweather on punctuality"],
    ["warn fairweather"],
    ["document fairweather"],
    ["terminate fairweather"],
    ["discipline fairweather"],
    ["verbal fairweather"],
    ["write up Dr Fairweather"],
    ["write up Mx Fairweather for being late"],
  ])("%s → not someone else", (said) => {
    expect(otherPersonTyped(context(said), MARISOL, ["fairweather"])).toBeNull();
  });

  it("the manager's own correction to her first name is her", () => {
    expect(otherPersonTyped(context("sorry i meant marisol fairweather"), MARISOL, ["soren fairweather", "marisol fairweather"])).toBeNull();
  });

  /*
   * QA's review of #1008, finding 2: answering the chat's own question didn't clear it, and a later turn in the same
   * chat was refused too. The turn right after the question is read; once it takes her, she is accepted for the chat.
   */
  const asked = { role: "assistant" as const, content: otherPersonQuestion("soren fairweather", MARISOL) };
  const first = { role: "user" as const, content: "write up soren fairweather" };
  // QA's re-review of #1008 (15 Nov 2026): acceptance is a whitelist; a bare "her" is no longer on it (see below).
  it.each([["yes"], ["yeah"], ["correct"], ["that's her"], ["marisol"], ["yes, marisol"], ["yes marisol"], ["yeah that's her"], ["Marisol."]])(
    "%s, after the question → her",
    (answer) => {
      expect(otherPersonTyped(context(answer, [first, asked]), MARISOL, ["soren fairweather"])).toBeNull();
    },
  );

  it("once taken, a later \"write up marisol\" in the same chat is her too", () => {
    const history = [first, asked, { role: "user" as const, content: "yeah that's her" }, { role: "assistant" as const, content: "Done." }];
    expect(otherPersonTyped(context("write up marisol for being late again", history), MARISOL, ["soren fairweather"])).toBeNull();
  });

  it("a no, or another name, after the question is not her", () => {
    expect(otherPersonTyped(context("no", [first, asked]), MARISOL, ["soren fairweather"])).toBe("soren fairweather");
    expect(otherPersonTyped(context("someone else, soren", [first, asked]), MARISOL, ["soren fairweather"])).toBe("soren fairweather");
  });

  it("only the turn right after the question counts, not every turn", () => {
    // "her" in a later turn, after the manager said no, does not take her.
    const history = [first, asked, { role: "user" as const, content: "no" }, { role: "assistant" as const, content: "Who is it for?" }];
    expect(otherPersonTyped(context("her name is soren", history), MARISOL, ["soren fairweather"])).toBe("soren fairweather");
  });

  it("the question, in QA's words", () => {
    expect(otherPersonQuestion("soren Fairweather", MARISOL)).toBe("Soren Fairweather isn't on your staff list. Did you mean Marisol Fairweather, or someone else?");
  });
});

describe("QA's re-review of #1008 (15 Nov 2026)", () => {
  beforeEach(() => vi.stubEnv("FIRST_NAME_MUST_FIT_ENABLED", "true"));
  afterEach(() => vi.unstubAllEnvs());

  const asked = { role: "assistant" as const, content: otherPersonQuestion("soren fairweather", MARISOL) };
  const first = { role: "user" as const, content: "write up soren fairweather" };

  // (1) The model looked up only the surname: the manager's own words in this request still name someone else.
  it("\"write up soren fairweather for being late\", the model searched only \"fairweather\" → Soren Fairweather, asked", () => {
    expect(otherPersonTyped(context("write up soren fairweather for being late"), MARISOL, ["fairweather"])?.toLowerCase()).toBe("soren fairweather");
  });

  it("an earlier turn of the same request is read; a finished earlier request is not", () => {
    const sameRequest = [{ role: "user" as const, content: "write up soren fairweather" }, { role: "assistant" as const, content: "What happened?" }];
    expect(otherPersonTyped(context("she was late", sameRequest), MARISOL, ["fairweather"])?.toLowerCase()).toBe("soren fairweather");
    const earlier = [{ role: "user" as const, content: "write up soren fairweather" }, { role: "assistant" as const, content: "Done. The draft is open." }];
    expect(otherPersonTyped(context("now a coaching form for fairweather", earlier), MARISOL, ["fairweather"])).toBeNull();
  });

  it.each([
    ["coach fairweather on punctuality"],
    ["write up Dr. Fairweather"],
    ["a CA for Ms Fairweather"],
    ["write up marisol fairweather"],
    ["write up mari fairweather"],
  ])("%s, the model searched \"fairweather\" → not someone else", (said) => {
    expect(otherPersonTyped(context(said), MARISOL, ["fairweather"])).toBeNull();
  });

  it("any other word before the surname asks (a stray question is cheap)", () => {
    expect(otherPersonTyped(context("write up kestrel fairweather"), MARISOL, ["fairweather"])?.toLowerCase()).toBe("kestrel fairweather");
  });

  // (2) Acceptance is a whitelist.
  it.each([
    ["she's new"],
    ["Soren, not Marisol"],
    ["marisol is her sister, this is soren"],
    ["sure but it's soren"],
    ["right, it's someone else"],
    ["ok so who else is on the list?"],
    ["her"],
  ])("%s, after the question → not her", (answer) => {
    expect(otherPersonTyped(context(answer, [first, asked]), MARISOL, ["soren fairweather"])?.toLowerCase()).toBe("soren fairweather");
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
    expect(otherPersonTyped(context("write up rae fairweather for being late"), PREFERRED, ["rae fairweather"])).toBeNull();
  });
});

describe("FIRST_NAME_MUST_FIT_ENABLED off: as before", () => {
  it("nothing is refused", () => {
    expect(otherPersonTyped(context("write up soren fairweather for being late"), MARISOL, ["soren fairweather"])).toBeNull();
  });
});
