import { describe, expect, it } from "vitest";

import { accountMissing, NAME_CORRECTION } from "./tools";

/*
 * The account check in propose_form (QA, 14 Nov 2026): the live run's lost-account failures, in their wording (people
 * invented). What the manager said must survive into what_happened; rewording and spelling cleanup are fine.
 */
describe("the account keeps the manager's dates, times, places and amounts", () => {
  it.each([
    ["create a ca for marnie holloway, She was late at Omaha Last week", "She was late.", ["Last week", "at Omaha"]],
    ["the 10 minute sanitaion in the morning", "She did not do the 10-minute sanitation.", ["in the morning"]],
    ["Remy Calder failed to take trash out and put rugs out untl 12;30pm", "Remy did not take the trash out.", ["12;30pm"]],
    ["create a verbal ca for Rowan Kestrel. on 11-1-26 the register was off $20.", "The register was off.", ["11-1-26", "$20"]],
    ["create a corrective action for Perpetua Lindqvist, she was late on 10/5/26 and again on 10/15/26", "She was late on 10/15/26.", ["10/5/26"]],
  ])("drops: %s", (said, account, dropped) => {
    expect(accountMissing(said, account).sort()).toEqual([...dropped].sort());
  });

  it.each([
    ["create a ca for marnie holloway, She was late at Omaha Last week", "She was late at Omaha last week."],
    ["the 10 minute sanitaion in the morning", "She did not do the 10-minute sanitation in the morning."],
    ["Remy Calder failed to take trash out and put rugs out untl 12;30pm", "Remy did not take the trash out or put the rugs out until 12:30pm."],
    ["create a verbal ca for Rowan Kestrel. on 11-1-26 the register was off $20.", "On 11/01/2026 the register was off $20."],
    ["Can you make a CA for Corisande Pell for failure to open on time?", "Failure to open on time."],
    ["she yelled at a guest and she maybe forgot", "She yelled at a guest and she maybe forgot."],
  ])("keeps: %s", (said, account) => {
    expect(accountMissing(said, account)).toEqual([]);
  });
});

/* The name-correction guard (agent-loop/tools.ts, live re-run 14 Nov 2026): which messages correct only the name. */
describe("a message that corrects the employee's name", () => {
  it.each(["fix her last name, it is Doe-Smith", "her name is spelled Orwel", "the last name should be Varga", "wrong surname"])("corrects the name: %s", (said) =>
    expect(NAME_CORRECTION.test(said)).toBe(true),
  );
  it.each(["she was late on 11/3", "add that she was rude to a guest", "change the date to 11/4", "she gave her name to the guest"])("does not: %s", (said) =>
    expect(NAME_CORRECTION.test(said)).toBe(false),
  );
});
