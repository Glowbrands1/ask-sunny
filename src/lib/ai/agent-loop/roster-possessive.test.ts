import { describe, expect, it } from "vitest";

import { requestFormKind, withRosterPossessives } from "./tools";

/** QA's 266-chat shadow re-run S1 (22 Nov 2026): "open <First>s ca". Invented roster names. */
const ROSTER = [
  { firstName: "Remy", lastName: "Calder", preferredFirstName: null },
  { firstName: "Juno", lastName: "Paxton", preferredFirstName: null },
  { firstName: "Jules", lastName: "Marsh", preferredFirstName: null },
  { firstName: "Jule", lastName: "Orr", preferredFirstName: null },
];

describe("withRosterPossessives (S1)", () => {
  it("\"open Remys ca\" is Remy's", () => {
    expect(withRosterPossessives("open Remys ca", ROSTER)).toBe("open Remy's ca");
    expect(withRosterPossessives("show me paxtons forms", ROSTER)).toBe("show me paxton's forms");
  });
  it("a name that is itself on the roster stays (\"Jules\" is not \"Jule's\")", () => {
    expect(withRosterPossessives("open Jules ca", ROSTER)).toBe("open Jules ca");
  });
  it("words that are not roster names are untouched", () => {
    expect(withRosterPossessives("open the forms for cars", ROSTER)).toBe("open the forms for cars");
    expect(withRosterPossessives("open Remy's ca", ROSTER)).toBe("open Remy's ca");
  });
  it("a live manager's \"show me <first>sexit\" (no apostrophe, no space): \"Remy's exit\" (Pau's review, 23 Nov 2026)", () => {
    expect(withRosterPossessives("show me remysexit", ROSTER)).toBe("show me remy's exit");
    expect(withRosterPossessives("show me Paxtonsexit form", ROSTER)).toBe("show me Paxton's exit form");
  });
  it("a glued word that is a roster name, or only starts with a name and a short tail, stays", () => {
    expect(withRosterPossessives("open Jules ca", ROSTER)).toBe("open Jules ca");
    expect(withRosterPossessives("remyson and the remysex", ROSTER)).toBe("remyson and the remysex");
  });
});


describe("requestFormKind (a live manager's \"show me <first>sexit\", \"yes\", \"yes\", \"11202026\"; Pau, 23 Nov 2026)", () => {
  const turn = (role: "user" | "assistant", content: string) => ({ role, content }) as never;
  it("the kind said at the start of the request holds through the answers to the replies' questions", () => {
    const history = [
      turn("user", "show me remysexit"),
      turn("assistant", "Just to confirm — do you want to see Remy's Resignation/Exit Form on file?"),
      turn("user", "yes"),
      turn("assistant", "There are 6 forms on file for Remy. Which one would you like to open?"),
    ];
    expect(requestFormKind({ question: "11202026", history }, ROSTER)?.templateNameWords).toEqual(["exit", "resignation"]);
  });
  it("a request that ended (a reply that asked nothing) does not carry its kind into the next one", () => {
    const history = [turn("user", "show me remysexit"), turn("assistant", "Opening her Resignation/Exit Form."), turn("user", "now show me remys forms")];
    expect(requestFormKind({ question: "11/20", history }, ROSTER)).toBeNull();
  });
});
