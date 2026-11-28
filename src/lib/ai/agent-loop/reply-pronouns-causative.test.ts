import { describe, expect, it } from "vitest";

import { withoutPersonPronouns } from "./reply-pronouns";

/*
 * The owner's live check of the history-first coaching answer (28 Nov 2026): the role-play line read "have <P>'s practice
 * the call-in process". The model wrote "have her practice the call-in process"; "her" after have / let / make / help,
 * with an object after the next word ("practice THE call-in process"), is the person doing it, never what they own.
 * "have her shift covered" still owns something. The person here is STAFF's invented Remy.
 */
describe("\"her\" after have / let / make / help is the person, not a possessive", () => {
  it("the live role-play line: \"have her practice the call-in process\" names her, not \"Remy's practice\"", () => {
    const live = "Role-play: You play Remy and give a common excuse (overslept, car trouble); have her practice the call-in process and proposing a concrete fix (earlier alarm, backup ride).";
    expect(withoutPersonPronouns(live, "Remy").text).toBe("Role-play: You play Remy and give a common excuse (overslept, car trouble); have Remy practice the call-in process and proposing a concrete fix (earlier alarm, backup ride).");
  });

  it.each([
    ["Let her know the schedule changed.", "Let Remy know the schedule changed."],
    ["Make her repeat the expectation back to you.", "Make Remy repeat the expectation back to you."],
    ["Help her plan the route to work.", "Help Remy plan the route to work."],
  ])("%s", (said, expected) => {
    expect(withoutPersonPronouns(said, "Remy").text).toBe(expected);
  });

  it("still a possessive when no object follows: \"have her shift covered\", \"help her team\"", () => {
    expect(withoutPersonPronouns("Have her shift covered before Friday.", "Remy").text).toBe("Have Remy's shift covered before Friday.");
    expect(withoutPersonPronouns("Help her team during the rush.", "Remy").text).toBe("Help Remy's team during the rush.");
  });
});
