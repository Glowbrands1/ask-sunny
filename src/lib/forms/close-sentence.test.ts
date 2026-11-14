import { describe, expect, it } from "vitest";

import { closeSentence } from "./close-sentence";

const norm = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const close = (a: string, b: string) => closeSentence(norm(a), norm(b));

describe("closeSentence (ACCOUNT_REPLACED_CLOSE_SENTENCE_KEPT_ENABLED)", () => {
  it("a typo fix is the same sentence (QA, 13 Nov 2026)", () => {
    expect(close("Nell Orrin was on her phone the whole shfit.", "Nell Orrin was on her phone the whole shift.")).toBe(true);
    expect(close("Nell Orrin was lte on October 20, 2026.", "Nell Orrin was late on October 20, 2026.")).toBe(true);
    expect(close("Not doing the 10 minute sanitaion in the morning.", "Not doing the 10 minute sanitation in the morning.")).toBe(true);
  });

  it("a pronoun or article the saved Observation reworded is the same word", () => {
    expect(close("Nell Orrin was on the cell phone the whole shfit.", "Nell Orrin was on her cell phone the whole shift.")).toBe(true);
    expect(close("She was on the phone.", "She was on a phone.")).toBe(true);
    expect(close("She was on the phone.", "She was on the register.")).toBe(false);
  });

  it("a spacing typo is the same sentence", () => {
    expect(close("Not doing th e10 minute sanitaion.", "Not doing the 10 minute sanitaion.")).toBe(true);
  });

  it("a date fix is the same sentence", () => {
    expect(close("Nell Orrin was late on October 20, 2026.", "Nell Orrin was late on October 21, 2026.")).toBe(true);
    expect(close("Nell Orrin was late on 10/20/26.", "Nell Orrin was late on 10/21/26.")).toBe(true);
    expect(close("Nell Orrin was late on October 20, 2026.", "Nell Orrin was late on November 3, 2026.")).toBe(true);
    expect(close("Nell Orrin was late on Monday.", "Nell Orrin was late on Tuesday.")).toBe(true);
  });

  it("a date rewritten in another form is one difference (Gate-Bubbles-5's probe on #876, 14 Nov 2026)", () => {
    const account = "Ottoline Ormsworth was texting on the cell phone the whole shift on 11/3/26.";
    expect(close(account, "Ottoline Ormsworth was texting on the cell phone the whole shift on November 4, 2026.")).toBe(true);
    expect(close(account, "Ottoline Ormsworth was texting on the cell phone the whole shift on Nov 4th.")).toBe(true);
    expect(close(account, "Ottoline Ormsworth was texting on the cell phone the whole shift on the 4th.")).toBe(true);
    expect(close(account, "Ottoline Ormsworth was texting on the cell phone the whole shift on 4th of November 2026.")).toBe(true);
    expect(close("She was late on November 3, 2026.", "She was late on 11/4/26.")).toBe(true);
    // A date fix and a typo fix together are still close.
    expect(close(account, "Ottoline Ormsworth was texting on the cell phone the whole shfit on November 4, 2026.")).toBe(true);
  });

  it("Gate-Bubbles-5's other date shapes are one difference (14 Nov 2026)", () => {
    const at = (date: string) => `Odalys Quenby was texting on the cell phone the whole shift on ${date}.`;
    expect(close(at("11/3/26"), at("Nov 4th"))).toBe(true);
    expect(close(at("11/3/26"), at("11/4"))).toBe(true);
    expect(close(at("Tuesday, 11/3/26"), at("Wednesday, November 4th"))).toBe(true);
    expect(close(at("Tuesday"), at("Wednesday"))).toBe(true);
    expect(close(at("the 3rd"), at("the 4th"))).toBe(true);
    expect(close(at("3rd"), at("4th"))).toBe(true);
  });

  it("a date read as one word never hides a changed account", () => {
    expect(close("She was late on 11/3/26.", "She was rude to a customer on November 4, 2026.")).toBe(false);
    expect(close("She skipped the 10 minute sanitation on 11/3/26.", "She skipped the 10 minute sanitation and the floors on 11/3/26.")).toBe(false);
  });

  it("a changed account is a new sentence", () => {
    expect(close("Nell Orrin was late on October 20, 2026.", "Nell Orrin was on her phone on October 20, 2026.")).toBe(false);
    expect(close("Nell Orrin was late on October 20, 2026.", "Nell Orrin was rude on October 20, 2026.")).toBe(false);
    expect(close("She did not do the 10 minute sanitation.", "She did not do the opening checklist.")).toBe(false);
    expect(close("She left the safe open.", "She left the store early.")).toBe(false);
  });

  it("a word added or dropped is not a typo", () => {
    expect(close("She was late.", "She was not late.")).toBe(false);
    expect(close("She was not late.", "She was late.")).toBe(false);
  });

  it("a date word never pairs with a word that is not one, and short words are not read as typos", () => {
    expect(close("She was late on 10 20.", "She was late on the 20.")).toBe(false);
    expect(close("She was on her own.", "She was on her pho.")).toBe(false);
  });
});
