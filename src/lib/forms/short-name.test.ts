import { describe, expect, it } from "vitest";

import { replyWithShortName, withShortName } from "./short-name";

/* QA, 20 Nov 2026 (main b06e51be): "ca for Test Testy, late 11/18" named the person in full on the card, the reply and Observed. */
describe("withShortName (an account)", () => {
  it("puts the short name in place of the full name, possessive and any case included", () => {
    expect(withShortName("Test Testy was late on 11/18.", "Test Testy", "Test")).toEqual({ text: "Test was late on 11/18.", replaced: 1 });
    expect(withShortName("test testy missed Test Testy's shift.", "Test Testy", "Test").text).toBe("Test missed Test's shift.");
  });
  it("leaves text in quotes, a single-word name and an equal short name alone", () => {
    expect(withShortName('The guest said "Test Testy was rude." Test Testy apologised.', "Test Testy", "Test").text).toBe('The guest said "Test Testy was rude." Test apologised.');
    expect(withShortName("Test was late.", "Test", "Test").replaced).toBe(0);
    expect(withShortName("Test Testy was late.", "Test Testy", "Test Testy").replaced).toBe(0);
  });
  it("never shortens a longer name that only starts the same", () => {
    expect(withShortName("Test Testyson was late.", "Test Testy", "Test").replaced).toBe(0);
  });
});

describe("replyWithShortName (the reply)", () => {
  const reply = [
    "Here's the Corrective Action Form for **Test Testy**.",
    "",
    "**Test Testy** isn't on the Woven staff list, so I've used the name as you typed it.",
    "",
    "**Observation of Offense:** Test Testy was late on 11/18. Is this for Test Testy at Kearney?",
  ].join("\n");
  it("shortens the opener for this card's form and the account, and keeps the bold confirm line and the question", () => {
    const out = replyWithShortName(reply, "Test Testy", "Test", "Corrective Action Form");
    expect(out.text).toBe([
      "Here's the Corrective Action Form for **Test**.",
      "",
      "**Test Testy** isn't on the Woven staff list, so I've used the name as you typed it.",
      "",
      "**Observation of Offense:** Test was late on 11/18. Is this for Test Testy at Kearney?",
    ].join("\n"));
    expect(out.replaced).toBe(2);
  });
  it("keeps every other bold mention (Using **<full name>** from your staff list)", () => {
    expect(replyWithShortName("Using **Test Testy** from your staff list.", "Test Testy", "Test", "Corrective Action Form").replaced).toBe(0);
  });
});

describe("withOwnOtherFirstNames (port from the sibling app, its QA's live re-run 23 Nov 2026)", () => {
  it("the legal first name in the account becomes the card's short name, so one person is named", async () => {
    const { withOwnOtherFirstNames } = await import("./short-name");
    const out = withOwnOtherFirstNames("On 11/14 Velmara worked 50 minutes over the scheduled shift and did not clean up after themself.", ["Velmara"], "Pellwood", "Brisenne");
    expect(out.text).toBe("On 11/14 Brisenne worked 50 minutes over the scheduled shift and did not clean up after themself.");
  });

  it("the full other name with the surname, and text in quotes left as written", async () => {
    const { withOwnOtherFirstNames } = await import("./short-name");
    expect(withOwnOtherFirstNames("Velmara Pellwood said \"ask Velmara\" and left.", ["Velmara"], "Pellwood", "Brisenne").text).toBe("Brisenne said \"ask Velmara\" and left.");
  });

  it("a longer name that starts with the other first name is someone else", async () => {
    const { withOwnOtherFirstNames } = await import("./short-name");
    expect(withOwnOtherFirstNames("Velmaradine covered the shift.", ["Velmara"], "Pellwood", "Brisenne").text).toBe("Velmaradine covered the shift.");
  });
});
