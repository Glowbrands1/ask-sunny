import { describe, expect, it } from "vitest";

import { spelledDateWords } from "./form-reducer";
import { replacedAccount } from "./issue-edit-account";

/*
 * ISSUE_EDIT_IS_THE_ACCOUNT (v2-Gate-Bubbles-5's probes on main, via QA, 14 Nov 2026), in the gate's words. On a saved
 * lateness CA, "change the issue to … on Nov 4th" changed only the date, and "… on 11/3/26" said "Nothing needed changing".
 */
describe("replacedAccount", () => {
  it("reads the gate's two turns as a new account", () => {
    expect(replacedAccount("change the issue to she was texting on her cell phone the whole shift on Nov 4th")).toBe(
      "she was texting on her cell phone the whole shift on Nov 4th",
    );
    expect(replacedAccount("change the issue to she was texting on her cell phone the whole shift on 11/3/26")).toBe(
      "she was texting on her cell phone the whole shift on 11/3/26",
    );
  });

  it("reads the other names managers use for the account", () => {
    expect(replacedAccount("change the observation of offense to she left the register open on 11/2/26")).not.toBeNull();
    expect(replacedAccount("update what happened to she yelled at a customer")).not.toBeNull();
    expect(replacedAccount("change the issue to not doing the 10-minute sanitation")).not.toBeNull();
  });

  it("leaves a date correction a date correction", () => {
    expect(replacedAccount("change the incident to 11/4")).toBeNull();
    expect(replacedAccount("change the incident date to 11/4/26")).toBeNull();
    expect(replacedAccount("change the issue to Nov 4th")).toBeNull();
    expect(replacedAccount("change the date to 11/4/26")).toBeNull();
    expect(replacedAccount("the meeting was actually on 10-19-26")).toBeNull();
  });

  it("is not an add or another field", () => {
    expect(replacedAccount("add that she was texting on her cell phone the whole shift")).toBeNull();
    expect(replacedAccount("change the warning to a written warning")).toBeNull();
  });
});

describe("spelledDateWords", () => {
  it("gives the words a date she typed is written in", () => {
    expect(spelledDateWords("on Nov 4th")).toEqual(["november", "4"]);
    expect(spelledDateWords("on november 4, 2026")).toEqual(["november", "4", "2026"]);
    expect(spelledDateWords("the 4th of Nov")).toEqual(["november", "4"]);
    expect(spelledDateWords("on 11/3/26")).toEqual(["november", "3", "2026"]);
  });

  it("reads nothing that is not a date", () => {
    expect(spelledDateWords("she was on her phone for 10 minutes")).toEqual([]);
    expect(spelledDateWords("13/40")).toEqual([]);
  });
});
