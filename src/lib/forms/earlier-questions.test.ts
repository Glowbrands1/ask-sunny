import { describe, expect, it } from "vitest";

import { withoutEarlierQuestions } from "./earlier-questions";

/**
 * OBSERVATION_NOT_EARLIER_QUESTION_ENABLED (Pau via QA, 5 Nov 2026, sf-s25;
 * the manager's turns verbatim, person invented): the card's Observation of
 * Offense began with the question asked before the request.
 */
const S25 = [
  "closing policy",
  "What policy would it be if a tanning consultant did not complete the closing correctly and i have already talked to her about it",
  "Write a CA for Wynne Sarrow she is TC works at Omaha Pacific and on 11/3/26 she was scheduled until 9:15PM and clocked out at 9:01. She also took down the spray booths down at 8:11 PM before the Salon was closed.",
];

describe("a question asked before the request is not the account", () => {
  it("sf-s25: the earlier questions go; the request stays", () => {
    expect(withoutEarlierQuestions(S25)).toEqual([S25[2]]);
  });

  it("a turn after the request stays, whatever it asks (sf-b6's \"can you have it include that …\")", () => {
    const turns = [
      "I need a corrective action form for Wynne Sarrow for counting the drawer early and turning away a customer",
      "can you have it include that we recieved a customer complaint from Sunday 11-1, she started closing the last register at 4:56pm",
    ];
    expect(withoutEarlierQuestions(turns)).toEqual(turns);
  });

  it("an account given before the request stays", () => {
    const turns = ["she was late on 10/5 and 10/15", "write a CA for Wynne Sarrow"];
    expect(withoutEarlierQuestions(turns)).toEqual(turns);
  });

  it("no request: nothing is dropped", () => {
    expect(withoutEarlierQuestions(S25.slice(0, 2))).toEqual(S25.slice(0, 2));
  });
});
