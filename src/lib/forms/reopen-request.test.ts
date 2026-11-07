import { afterEach, describe, expect, it, vi } from "vitest";

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

/**
 * REOPEN_BY_ANY_OPEN_VERB_ENABLED (QA, 6 Nov 2026; QA's history review of a
 * location manager's chats, 5 Nov 2026): the manager's own wording, names
 * invented. Only "edit" reopened a form on file; these started over.
 */
describe("REOPEN_BY_ANY_OPEN_VERB_ENABLED: a form on file asked for with any verb that opens it", () => {
  afterEach(() => vi.unstubAllEnvs());
  const on = () => vi.stubEnv("REOPEN_BY_ANY_OPEN_VERB_ENABLED", "true");

  const OPENED = [
    ["bring up Odalys Fairbank's corrective action", "dpoa"],
    ["bring up an old coaching form for Marisol", "coaching"],
    ["bring up a previously edited corrective action for Odalys Fairbank", "dpoa"],
    ["bring up a previous corrective action form that i made for Odalys Fairbank earlier today", "dpoa"],
    ["pull up Odalys Fairbank's CA", "dpoa"],
    ["open Odalys Fairbank's corrective action", "dpoa"],
    ["open the CA for Odalys Fairbank", "dpoa"],
    ["open her CA", "dpoa"],
    ["open my CA for Odalys Fairbank", "dpoa"],
  ] as const;

  it.each(OPENED)("off: %s is not read as a form on file", (question) => {
    expect(readReopenRequest(question)).toBeNull();
  });

  it.each(OPENED)("on: %s → opens the %s on file to edit", (question, templateKey) => {
    on();
    expect(readReopenRequest(question)).toEqual({ mode: "show", templateKey, asksChange: false, opensToEdit: true, byAddedVerb: true });
  });

  // QA decision (b), 6 Nov 2026: "find" displays the form, as "show" does; it does not open a finalized one to edit.
  it.each([
    ["can you find the coaching form for Marisol Quintero", "coaching"],
    ["find my earlier CA for Odalys Fairbank", "dpoa"],
  ])("on: %s → shows the %s on file", (question, templateKey) => {
    expect(readReopenRequest(question)).toBeNull();
    on();
    expect(readReopenRequest(question)).toEqual({ mode: "show", templateKey, asksChange: false, byAddedVerb: true });
  });

  it("on: \"Change <name> CA\" names the Corrective Action Form (sf-s26); off, it names none", () => {
    expect(readReopenRequest("Change Thessaly Brandt CA")).toBeNull();
    on();
    expect(readReopenRequest("Change Thessaly Brandt CA")).toEqual({ mode: "edit", templateKey: "dpoa", asksChange: false });
  });

  it.each([
    "write up Odalys Fairbank for not opening the salon on time on Tuesday",
    "Odalys didn't open the salon on time, write her up",
    "create a corrective action for Odalys Fairbank",
    "pull up a coaching form for Marisol Quintero",
    // QA decision (c), 6 Nov 2026: an indefinite article before the form starts a new one.
    "open a CA for Odalys Fairbank",
    "open a new corrective action for Odalys Fairbank",
    "bring up a coaching form for Marisol Quintero",
    "how do I find an old coaching form?",
  ])("on: %s is still not a form on file", (question) => {
    on();
    expect(readReopenRequest(question)).toBeNull();
  });

  it("on: \"show\" still shows, and does not open a finalized form to edit", () => {
    on();
    expect(readReopenRequest("show me the exit form for Lacey Morrow")).toEqual({ mode: "show", templateKey: "stc-exit", asksChange: false });
  });
});
