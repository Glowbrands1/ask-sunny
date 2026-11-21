import { describe, expect, it } from "vitest";

import { withoutPersonPronouns } from "./reply-pronouns";

/*
 * QA2's live R3 on cdb2ddc2 (21 Nov 2026): the manager typed "…came into the salon to show her team her new puppy". The
 * saved Observation read "… to show the team the new puppy" (#1145), but the reply and the card's issue text read "to show
 * Test's team Test's new puppy". The reply/card pass now writes the person's possessive the way the saved write-up does:
 * once the person is named in the sentence, "her <thing>" is "the <thing>". Reported speech keeps its owner ("Remy said
 * Remy's car broke down", #1145). The tester's "Test" is STAFF's invented Remy here.
 */
describe("the person's possessive, once they are named in the sentence", () => {
  it("QA2's R3: \"to show her team her new puppy\" reads as the saved write-up does", () => {
    expect(withoutPersonPronouns("Remy came into the salon to show her team her new puppy.", "Remy").text).toBe("Remy came into the salon to show the team the new puppy.");
    expect(withoutPersonPronouns("She came into the salon to show her team her new puppy.", "Remy").text).toBe("Remy came into the salon to show the team the new puppy.");
  });

  it("the first mention in a sentence is still the name, and reported speech keeps the owner", () => {
    expect(withoutPersonPronouns("Her phone was out on the floor.", "Remy").text).toBe("Remy's phone was out on the floor.");
    expect(withoutPersonPronouns("She said her car broke down.", "Remy").text).toBe("Remy said Remy's car broke down.");
  });
});
