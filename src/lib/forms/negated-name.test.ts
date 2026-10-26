import { describe, expect, it } from "vitest";

import { firstNonNegatedName, isNegatedName, onlyNegatedMentions } from "./negated-name";

/** QA-6, 26 Oct 2026. The same file, byte for byte, in both apps. */
const at = (text: string, name: string) => isNegatedName(text, text.toLowerCase().indexOf(name.toLowerCase()));
const registers = (text: string) => [text.toLowerCase(), text.charAt(0).toUpperCase() + text.slice(1), text.toUpperCase()];

describe("isNegatedName", () => {
  it.each(
    [
      ["do not create a CA for test employee at Kearney", "test employee"],
      ["never write up test employee at Kearney", "test employee"],
      ["this is not for test employee, it is for the new hire", "test employee"],
      ["without test employee", "test employee"],
      ["everyone except test employee", "test employee"],
      ["Okay let's restart. Not Test Employee, Team Member.", "test employee"],
      ["never one for Rowan Pell", "rowan pell"],
      ["do not make one for Rowan Pell", "rowan pell"],
      ["don't write a verbal for Rowan Pell", "rowan pell"],
      ["no, not for Rowan Pell, for Corvin Mallow", "rowan pell"],
      ["one for Rowan Pell, not Corvin Mallow", "corvin mallow"],
      ["one for Corvin Mallow instead of Rowan Pell", "rowan pell"],
    ].flatMap(([text, name]) => registers(text!).map((typed) => [typed, name!] as const)),
  )("%s: %s is negated", (text, name) => {
    expect(at(text, name)).toBe(true);
  });

  it.each(
    [
      ["now one for Rowan Pell", "rowan pell"],
      ["one for Rowan Pell, not Corvin Mallow", "rowan pell"],
      ["no, not for Rowan Pell, for Corvin Mallow", "corvin mallow"],
      ["create a CA for test employee and a coaching for Rowan Pell", "test employee"],
      ["test employee, not Rowan Pell, was late", "test employee"],
      ["not sure, but write one for Rowan Pell", "rowan pell"],
      ["she did not call, Rowan Pell was late", "rowan pell"],
      ["cannot reach Rowan Pell", "rowan pell"],
      ["Rowan Pell", "rowan pell"],
    ].flatMap(([text, name]) => registers(text!).map((typed) => [typed, name!] as const)),
  )("%s: %s is not negated", (text, name) => {
    expect(at(text, name)).toBe(false);
  });

  it("out of range or empty: not negated", () => {
    expect(isNegatedName("", 0)).toBe(false);
    expect(isNegatedName("not Rowan Pell", -1)).toBe(false);
    expect(isNegatedName("not Rowan Pell", 99)).toBe(false);
  });
});

describe("onlyNegatedMentions and firstNonNegatedName", () => {
  it.each(registers("no, not for Rowan Pell, for Corvin Mallow"))("%s", (text) => {
    expect(onlyNegatedMentions(text, "Rowan Pell")).toBe(true);
    expect(onlyNegatedMentions(text, "Corvin Mallow")).toBe(false);
    expect(firstNonNegatedName(text, ["Rowan Pell", "Corvin Mallow"])).toBe("Corvin Mallow");
  });

  it.each(registers("one for Rowan Pell, not Corvin Mallow"))("%s", (text) => {
    expect(firstNonNegatedName(text, ["Corvin Mallow", "Rowan Pell"])).toBe("Rowan Pell");
  });

  it.each(registers("test employee, not Rowan Pell, was late; Rowan Pell was on time"))("%s", (text) => {
    // The second "Rowan Pell" is not negated, so the name is not only negated; the first unnegated name is test employee.
    expect(onlyNegatedMentions(text, "Rowan Pell")).toBe(false);
    expect(firstNonNegatedName(text, ["Rowan Pell", "test employee"])).toBe("test employee");
  });

  it("a name not in the text: not negated, and not first", () => {
    expect(onlyNegatedMentions("never one for Rowan Pell", "Corvin Mallow")).toBe(false);
    expect(firstNonNegatedName("never one for Rowan Pell", ["Rowan Pell"])).toBeNull();
  });
});
