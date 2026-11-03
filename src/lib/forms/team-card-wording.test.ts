import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TEAM_NOTHING_DESCRIBED, namesOnlyTheAudience, teamCardNotes, teamExpectation, wholeTeamRequest } from "./whole-team-coaching";

/**
 * TEAM_CARD_WORDING_ENABLED — QA's live check of the team card, 3 Nov 2026:
 * (1) "salon wide everyone needs the reminder to call a manager for cash
 * drawer shortages" got a policy answer, not the team card; (2) the team
 * card's Observation echoed the audience: "the whole team: for the whole salon".
 */
const FLAGS = ["WHOLE_TEAM_COACHING_ENABLED", "TEAM_CARD_WORDING_ENABLED"] as const;
const saved = new Map<string, string | undefined>();
beforeEach(() => {
  for (const name of FLAGS) {
    saved.set(name, process.env[name]);
    process.env[name] = "true";
  }
});
afterEach(() => {
  for (const name of FLAGS) {
    const value = saved.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const QA_TURN = "salon wide everyone needs the reminder to call a manager for cash drawer shortages";

describe("a team expectation is the team card", () => {
  for (const turn of [
    QA_TURN,
    "store wide everyone needs the reminder to call a manager for cash drawer shortages, overages, and returns",
    "everyone needs a reminder to clean the beds after every session",
    "the whole team needs to start greeting clients at the door",
    "all staff need a refresher on lotion upsells",
    "remind everyone to lock the back door at close",
  ]) {
    it(`${JSON.stringify(turn)} → the team card`, () => {
      expect(teamExpectation(turn)).toBe(true);
      expect(wholeTeamRequest({ question: turn, history: [] })?.question).toBe(`Coaching Form for the whole team: ${turn}`);
    });
  }

  for (const turn of [
    "she yelled in front of the whole team",
    "does everyone need to sign the policy manual?",
    "what does the salon wide cash policy say",
    "everyone was late today",
    "Rowan needs a coaching for being late",
  ]) {
    it(`${JSON.stringify(turn)} is not`, () => {
      expect(teamExpectation(turn)).toBe(false);
    });
  }

  it("not with a draft open, and not while another form's intake is asking", () => {
    expect(wholeTeamRequest({ question: QA_TURN, history: [], draftOpen: true })).toBeNull();
    expect(wholeTeamRequest({ question: QA_TURN, history: [], continuingTemplateKey: "corrective_action" })).toBeNull();
  });

  it("off: not read", () => {
    process.env.TEAM_CARD_WORDING_ENABLED = "false";
    expect(wholeTeamRequest({ question: QA_TURN, history: [] })).toBeNull();
  });
});

describe("words that only name the audience are not the card's content", () => {
  for (const turn of ["for the whole salon", "whole staff", "for whole staff - associates", "coaching form for all team members", "can you create a coaching form for my whole staff?"]) {
    it(`${JSON.stringify(turn)} → only "Coaching Form for the whole team"`, () => {
      expect(namesOnlyTheAudience(turn)).toBe(true);
      expect(wholeTeamRequest({ question: turn, history: [], continuingTemplateKey: "coaching" })?.question).toBe("Coaching Form for the whole team");
    });
  }

  it("what the coaching is about is kept", () => {
    const turn = "we do not accept $100 bills, this coaching form is for all team members";
    expect(namesOnlyTheAudience(turn)).toBe(false);
    expect(wholeTeamRequest({ question: turn, history: [] })?.question).toBe(`Coaching Form for the whole team: ${turn}`);
  });

  it("off: her words are handed on as before", () => {
    process.env.TEAM_CARD_WORDING_ENABLED = "false";
    expect(wholeTeamRequest({ question: "for the whole salon", history: [], continuingTemplateKey: "coaching" })?.question).toBe(
      "Coaching Form for the whole team: for the whole salon",
    );
  });
});

describe("what the drafting model reads on a team card", () => {
  it('"for the whole salon" alone: nothing described, so nothing is written', () => {
    expect(teamCardNotes("for the whole salon")).toBe(TEAM_NOTHING_DESCRIBED);
  });

  it("the audience line goes, what the coaching is about stays", () => {
    expect(teamCardNotes("Create a coaching form.\nfor the whole salon\ncheck every client's skin type before a session")).toBe(
      "check every client's skin type before a session",
    );
  });

  it("QA's sentence is kept whole", () => {
    expect(teamCardNotes(QA_TURN)).toBe(QA_TURN);
  });
});
