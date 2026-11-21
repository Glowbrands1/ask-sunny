import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { answersCreateAll, asksForEveryone } = await import("./coaching-for-everyone");
const { swapName } = await import("./same-form-copy");

/*
 * QA's code audit of coach_team / coaching for everyone (main 9e1d1f67, 20 Nov 2026). The chat path is the replay pack's
 * nov20-coach-team-cases.ts; these are the readers on their own. Invented names only.
 */

describe("A: the team card's placeholder is swapped only as a whole phrase", () => {
  it("keeps \"All\" and \"members\" as words and swaps \"All team members\" whole", () => {
    expect(swapName("All guests must be greeted at the door. All team members restock before close.", "All team members", "Remy Calder")).toBe(
      "All guests must be greeted at the door. Remy Calder restock before close.",
    );
    expect(swapName("Members of the team greet guests.", "All team members", "Remy Calder")).toBe("Members of the team greet guests.");
  });
  it("still swaps a person's first name alone", () => {
    expect(swapName("Remy restocked the shelf.", "Remy Calder", "Juno Paxton")).toBe("Juno restocked the shelf.");
  });
});

describe("C: an ordinary yes answers the \"create all\" confirmation", () => {
  it("reads yes, yes please, go ahead and make them, create all of them", () => {
    for (const said of ["yes", "Yes please", "yes, create all", "create all 4", "create all of them", "go ahead and make them", "ok do it", "sure!"]) {
      expect(answersCreateAll(said), said).toEqual({});
    }
  });
  it("keeps the people left out", () => {
    expect(answersCreateAll("create all except Remy Calder and Juno")).toEqual({ except: "Remy Calder and Juno" });
    expect(answersCreateAll("yes but not Rowan")).toEqual({ except: "Rowan" });
  });
  it("never reads a no, a hold, a question or another request as yes", () => {
    for (const said of ["no", "not yet", "wait", "don't create them", "yes?", "can you change the wording first", "cancel", ""]) {
      expect(answersCreateAll(said), said).toBeNull();
    }
  });
});

describe("D: the whole team is everyone", () => {
  it("reads \"this coaching for the whole team\" and its kin", () => {
    for (const said of ["Do this coaching for the whole team", "this coaching form for my team", "the same form for the entire staff", "Create this coaching form for everyone on my team"]) {
      expect(asksForEveryone(said), said).toBe(true);
    }
  });
  it("is not a team request without one", () => {
    for (const said of ["coaching for remy calder", "this form for Remy", "team meeting tomorrow"]) expect(asksForEveryone(said), said).toBe(false);
  });
});
