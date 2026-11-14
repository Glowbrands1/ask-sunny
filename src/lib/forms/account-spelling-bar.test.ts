import { afterEach, describe, expect, it, vi } from "vitest";

import { noteAccountNames, withAccountNames } from "./account-names";
import { cardAccountText } from "./account-spelling";

/*
 * QA's bar (the sibling gate's #772 probe, 14 Nov 2026; ported), in the gate's wordings with this app's salons. The people are invented: a
 * coworker named Manuel Quellby (one letter from "manual") and a keyholder named Dariel.
 */
describe("ACCOUNT_TYPOS_FIXED_ENABLED: QA's bar", () => {
  afterEach(() => vi.unstubAllEnvs());
  const on = () => vi.stubEnv("ACCOUNT_TYPOS_FIXED_ENABLED", "true");

  it("a salon name is never edited, nor its case changed", () => {
    on();
    expect(cardAccountText("she was late at the kearny salon", "Brisa Talmadge")).toBe("she was late at the kearny salon");
    expect(cardAccountText("she was sent to Kearny", "Brisa Talmadge")).toBe("she was sent to Kearny");
    expect(cardAccountText("she covered a shift at Lincon", "Brisa Talmadge")).toBe("she covered a shift at Lincon");
  });

  it("a roster name is never edited — every person on the turn's roster, not only the employee", () => {
    on();
    withAccountNames(() => {
      noteAccountNames([{ firstName: "Manuel", lastName: "Quellby" }, { firstName: "Brisa", lastName: "Talmadge" }]);
      expect(cardAccountText("Manuel saw her leave the drawer open", "Brisa Talmadge")).toBe("Manuel saw her leave the drawer open");
      expect(cardAccountText("manuel saw her leave the drawer open", "Brisa Talmadge")).toBe("manuel saw her leave the drawer open");
      // A close typo of a roster name is a name too.
      expect(cardAccountText("manuell saw her leave the drawer open", "Brisa Talmadge")).toBe("manuell saw her leave the drawer open");
    });
  });

  it("a capitalised word is never edited, so no word changes case", () => {
    on();
    expect(cardAccountText("Keyhodler Dariel saw it", "Brisa Talmadge")).toBe("Keyhodler Dariel saw it");
  });

  it("nothing inside a quoted span of any kind is edited", () => {
    on();
    expect(cardAccountText(`she said "that is not my registr"`, null)).toBe(`she said "that is not my registr"`);
    expect(cardAccountText("she said 'that is not my registr'", null)).toBe("she said 'that is not my registr'");
    expect(cardAccountText("she said “i read the polcy”", null)).toBe("she said “i read the polcy”");
    expect(cardAccountText("she said ‘i read the polcy’", null)).toBe("she said ‘i read the polcy’");
  });

  it("the mending outside those still works", () => {
    on();
    expect(cardAccountText(`not doing th e10 minute sanitaion, she said "i dont care"`, "Brisa Talmadge")).toBe(`not doing the 10-minute sanitation, she said "i dont care"`);
    expect(cardAccountText("she didn't count the registr", null)).toBe("she didn't count the register");
  });
});

describe("ACCOUNT_TYPOS_FIXED_ENABLED: a quote left open", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("a quote open to the end of the account (its closing mark dropped) is still quoted", () => {
    vi.stubEnv("ACCOUNT_TYPOS_FIXED_ENABLED", "true");
    expect(cardAccountText("she told a guest 'that is not my registr", null)).toBe("she told a guest 'that is not my registr");
    expect(cardAccountText(`she said "i read the polcy`, null)).toBe(`she said "i read the polcy`);
    // An apostrophe in a word is not a quote.
    expect(cardAccountText("she didn't count the registr", null)).toBe("she didn't count the register");
  });
});

describe("ACCOUNT_TYPOS_FIXED_ENABLED: an apostrophe inside a quote (Gate-Sunny-2, #983)", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("an apostrophe between two letters does not end a single-quoted span", () => {
    vi.stubEnv("ACCOUNT_TYPOS_FIXED_ENABLED", "true");
    expect(cardAccountText("she told a guest 'that isn't my registr' and walked off", null)).toBe("she told a guest 'that isn't my registr' and walked off");
    expect(cardAccountText("she told a guest ‘that isn’t my registr’ and walked off", null)).toBe("she told a guest ‘that isn’t my registr’ and walked off");
  });
});

describe("ACCOUNT_TYPOS_FIXED_ENABLED: a real word is never mended (QA, Gate-Sunny-2's #983 wordings, 14 Nov 2026)", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("\"complained\" is not \"complaint\"", () => {
    vi.stubEnv("ACCOUNT_TYPOS_FIXED_ENABLED", "true");
    expect(cardAccountText("she complained to a guest", null)).toBe("she complained to a guest");
    expect(cardAccountText("The date she complained was Oct 31st", null)).toBe("The date she complained was Oct 31st");
    expect(cardAccountText("the guest complained", null)).toBe("the guest complained");
  });

  it("a misspelling is still mended, and \"manger\" is still the slip for manager", () => {
    vi.stubEnv("ACCOUNT_TYPOS_FIXED_ENABLED", "true");
    expect(cardAccountText("not doing th e10 minute sanitaion", null)).toBe("not doing the 10-minute sanitation");
    expect(cardAccountText("the customer made a complant", null)).toBe("the customer made a complaint");
    expect(cardAccountText("she was rude to her manger", null)).toBe("she was rude to her manager");
  });
});
