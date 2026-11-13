import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { addAlreadyOnForm } from "./add-already-on-form";

const STORED = ["Observed:\nOttoline Ormsworth was on the phone for the entire shift.\n\nExpectation:\nPhone use is limited to breaks."];

describe("ADD_ALREADY_ON_FORM_SAYS_SO_ENABLED: the sibling app's live 17u test, item 5, ported (13 Nov 2026)", () => {
  it("\"add that she was on the phone for the entire shift\" on a form that already says it: already on the form", () => {
    expect(addAlreadyOnForm("add that she was on the phone for the entire shift", "Ottoline Ormsworth", STORED)).toBe(true);
  });
  it("an add with a word the form does not hold is not already on it", () => {
    expect(addAlreadyOnForm("add that she was on the phone for the entire shift and ignored a guest", "Ottoline Ormsworth", STORED)).toBe(false);
    expect(addAlreadyOnForm("add that she left the register open", "Ottoline Ormsworth", STORED)).toBe(false);
  });
  it("only a plain add: a rewrite or a question is never read as already there", () => {
    expect(addAlreadyOnForm("make it about her phone use instead, she was on her phone the whole shift", "Ottoline Ormsworth", STORED)).toBe(false);
    expect(addAlreadyOnForm("was she on the phone for the entire shift?", "Ottoline Ormsworth", STORED)).toBe(false);
  });
  it("an add with no content words is not read as already there", () => {
    expect(addAlreadyOnForm("add that", "Ottoline Ormsworth", STORED)).toBe(false);
  });
});

describe("ADD_ALREADY_ON_FORM_SAYS_SO_ENABLED: the gates' findings (Gate-Bubbles-4, Gate-Sunny-3, 13 Nov 2026)", () => {
  it("a negation must match in place: \"add that she was NOT on the phone for the entire shift\" is not already on the form", () => {
    expect(addAlreadyOnForm("add that she was not on the phone for the entire shift", "Ottoline Ormsworth", STORED)).toBe(false);
    expect(addAlreadyOnForm("add that she wasn't on the phone for the entire shift", "Ottoline Ormsworth", STORED)).toBe(false);
  });
  it("\"the whole shift\" is \"the entire shift\"", () => {
    expect(addAlreadyOnForm("add that she was on the phone for the whole shift", "Ottoline Ormsworth", STORED)).toBe(true);
    expect(addAlreadyOnForm("add that she was on her phone the whole shift", "Ottoline Ormsworth", ["Observed:\nOttoline Ormsworth was on the phone the entire shift."])).toBe(true);
  });
  it("the words in another order, or split across sentences, are not already there", () => {
    expect(addAlreadyOnForm("add that the entire shift she was on the phone", "Ottoline Ormsworth", STORED)).toBe(false);
  });
  it("a negation the form also holds is already there", () => {
    expect(addAlreadyOnForm("add that she did not clock in", "Ottoline Ormsworth", ["Ottoline Ormsworth didn't clock in."])).toBe(true);
  });
});

