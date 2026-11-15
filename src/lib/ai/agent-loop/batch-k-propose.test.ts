import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { otherPeopleInAccount } = await import("./account-names");
const { turnsNameAskedAbout } = await import("./tools");
const { turnsFromThisPersonsRequest } = await import("@/lib/forms/this-persons-turns");
const { extractEmployeeNames, samePerson } = await import("@/lib/forms/proposal");

/* Batch K (K4, K8): invented names only. Odalys Fenwick is not on any roster. */
const ROSTER = ["Remy Calder", "Juno Paxton"];
const others = (text: string, employee = "Remy Calder") => otherPeopleInAccount(text, employee, ROSTER, samePerson).map((other) => other.name);

describe("K4: the full names in the manager's words other than the card's person", () => {
  it("an off-roster name in the account", () => {
    expect(others("ca for Remy Calder\n\nOdalys Fenwick was 20 minutes late on 11/10.")).toEqual(["Odalys Fenwick"]);
  });
  it("a roster name in the account, in any capitalisation", () => {
    expect(others("ca for remy calder. juno paxton did not clean the beds.")).toEqual(["Juno Paxton"]);
  });
  it("a coworker as a witness is still reported, with the sentence, for the model to weigh", () => {
    const found = otherPeopleInAccount("ca for juno paxton. She was late. Remy Calder saw it.", "Juno Paxton", ROSTER, samePerson);
    expect(found).toEqual([{ name: "Remy Calder", said: "Remy Calder saw it." }]);
  });
  it("the card's own person, a possessive of them, forms, dates and policies are never another person", () => {
    expect(others("Corrective Action Form for Remy Calder. Remy Calder's beds were not cleaned on Monday November 10 under Standards of Conduct.")).toEqual([]);
  });
  it("the signed-in manager is never another person", () => {
    expect(otherPeopleInAccount("ca for Remy Calder. Quinn Marlowe told her to leave.", "Remy Calder", ROSTER, samePerson, ["Quinn Marlowe"])).toEqual([]);
  });
  it("one name once", () => {
    expect(others("Odalys Fenwick was late. Odalys Fenwick did not call.")).toEqual(["Odalys Fenwick"]);
  });
});

describe("K8: a turn the app asked the name of belongs to the corrected person", () => {
  const read = (nameAsked?: ReadonlySet<string>) => ({ names: extractEmployeeNames, same: samePerson, nameAsked });
  const turns = [
    { id: "m0", content: "ca for Juno Paxton, late on 11/3" },
    { id: "m1", content: "I need an exit form with this information for Remmy Caldar: she was terminated on 11/12" },
    { id: "m2", content: "I need an exit form with this information for Remmy Caldar. She was terminated 11/12" },
    { id: "m3", content: "For Remy Calder" },
  ];
  const context = { messages: turns, ids: turns.map((turn) => turn.id), text: "" };
  const history = [
    { id: "m0", role: "user" as const, content: turns[0]!.content },
    { id: "a0", role: "assistant" as const, content: "Here's the Corrective Action Form for **Juno Paxton**." },
    { id: "m1", role: "user" as const, content: turns[1]!.content },
    { id: "a1", role: "assistant" as const, content: "Did you mean **Remy Calder**?" },
    { id: "m2", role: "user" as const, content: turns[2]!.content },
    { id: "a2", role: "assistant" as const, content: "I can't find **Remmy Caldar** on your roster. reply **use Remmy Caldar** or give the full name." },
  ];
  it("the turns the app asked about, by id", () => {
    expect([...turnsNameAskedAbout(history)]).toEqual(["m1", "m2"]);
  });
  it("both earlier request turns are kept with the corrected one, and not the earlier person's", () => {
    expect(turnsFromThisPersonsRequest(context, "Remy Calder", read(turnsNameAskedAbout(history)))).toEqual(["m1", "m2", "m3"]);
  });
  it("without the app's question (or with another person's request before) the earlier turns are not Remy's", () => {
    expect(turnsFromThisPersonsRequest(context, "Remy Calder", read())).not.toContain("m1");
  });
  it("a turn the app did not ask about is not pulled in", () => {
    expect(turnsFromThisPersonsRequest(context, "Remy Calder", read(new Set(["m2"])))).toEqual(["m2", "m3"]);
  });
});
