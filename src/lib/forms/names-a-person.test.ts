import { afterEach, describe, expect, it } from "vitest";

import { namesAPerson } from "./names-a-person";
import { installPersonRoster } from "./person-guard";

/**
 * PAST_FORMS_BEFORE_LIBRARY_ENABLED steps aside for the library only when a person is named (the round-3 gate, QA
 * 7 Nov 2026): the gate's wordings name nobody and keep the library answer; sf-s29 names a person. The person is
 * invented.
 */
afterEach(() => {
  installPersonRoster(() => undefined);
});

describe("namesAPerson", () => {
  it.each([
    "what documents are you referring to in the knowledge base or forms?",
    "i need to find those documents",
    "Do we have a role-play evaluation?",
    "do we have a coaching form?",
    "what forms do we have?",
  ])("the round-3 gate's %s names nobody", (question) => {
    installPersonRoster(() => ["Jovelle Kerrigan"]);
    expect(namesAPerson(question)).toBe(false);
  });

  it.each(["are there any coaching and ca's for Jovelle Kerrigan", "do we have a coaching form for Jovelle Kerrigan?"])(
    "a typed name: %s",
    (question) => {
      expect(namesAPerson(question)).toBe(true);
    },
  );

  it("a roster person in lower case: are there any coaching and ca's for jovelle kerrigan", () => {
    installPersonRoster(() => ["Jovelle Kerrigan"]);
    expect(namesAPerson("are there any coaching and ca's for jovelle kerrigan")).toBe(true);
  });

  it("lower case with no roster names nobody (no guess)", () => {
    expect(namesAPerson("are there any coaching and ca's for jovelle kerrigan")).toBe(false);
  });
});
