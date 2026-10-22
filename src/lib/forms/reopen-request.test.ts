import { describe, expect, it } from "vitest";

import { readReopenRequest } from "./reopen-request";

/**
 * "Change exit for lacey morrow", "duplicate exit … and change date notice
 * given to 9-27-26", "show draft of exit" — the turns from production feedback
 * that were answered "I can't edit a form that already exists".
 */
describe("reading a request for a form that already exists", () => {
  it.each([
    ["change exit for lacey morrow", "stc-exit", false],
    ["duplicate exit for lacey morrow and change date notice given to 9-27-26", "stc-exit", true],
    ["edit the exit form for Lacey Morrow", "stc-exit", false],
    ["revise lacey morrow exit form", "stc-exit", false],
    ["reopen the coaching form for Dana Moss", "coaching", false],
    ["can you edit the coaching form for Dana Moss to say she was late twice", "coaching", true],
    ["change her new location on the transfer form to salon 24", "position-transfer", true],
  ])("%s → edit the %s", (question, templateKey, asksChange) => {
    expect(readReopenRequest(question)).toEqual({ mode: "edit", templateKey, asksChange });
  });

  it("reads 'show draft of exit' as showing the form", () => {
    expect(readReopenRequest("show draft of exit")).toEqual({
      mode: "show",
      templateKey: "stc-exit",
      asksChange: false,
    });
  });

  it("names no template for 'edit the form', leaving the open form to decide", () => {
    expect(readReopenRequest("edit the form")).toEqual({ mode: "edit", templateKey: null, asksChange: false });
  });

  it.each([
    ["a new form", "create exit for Lacey Morrow"],
    ["a new form, asked another way", "make a new exit form for Lacey Morrow"],
    ["a pull-up request", "pull up a transfer form for jane doe"],
    ["another one", "start another coaching form for Dana"],
    ["a question about forms", "how do I change an exit form after it's finalized?"],
    ["a question about permission", "can I edit a finalized coaching form?"],
    ["a change with no form in it", "change it to two weeks"],
    ["an ordinary question", "what is the dress code?"],
  ])("leaves %s alone", (_label, question) => {
    expect(readReopenRequest(question)).toBeNull();
  });
});
