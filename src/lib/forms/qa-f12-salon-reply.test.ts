import { describe, expect, it } from "vitest";

import { answersSalon, latestSalonAnswer, salonCorrection, salonQuestionOpen, salonReply } from "./salon-reply";

/**
 * QA F-12, 22 Oct 2026 — the salon-reply reader, one turn at a time, over Ask
 * Sunny's own roster. The conversation-level behaviour (intake kept, salon set
 * only within the actor's scope, employee kept) is in
 * `src/app/api/forms/qa-f12-salon-reply-e2e.test.ts`.
 */

const ASKED = [
  { role: "user", content: "create a coaching form for Jo Test, late 3 times this week" },
  { role: "assistant", content: "I won't choose which salon this belongs to. Which salon is this about?", formProposal: { status: "needs_location" } },
];
const READY = [
  { role: "user", content: "create a coaching form for Jo Test at lincoln 27th street, late 3 times" },
  { role: "assistant", content: "Here is what I would put on a **Coaching Form**.", formProposal: { status: "ready" } },
];

describe("the salon question", () => {
  it("is open after a card that needs its salon, or after the question's own wording", () => {
    expect(salonQuestionOpen(ASKED)).toBe(true);
    expect(salonQuestionOpen([{ role: "assistant", content: "**NE Kearney** isn't a salon on your assignment, so I can't file a form against it. Which of your salons is this about?" }])).toBe(true);
    expect(salonQuestionOpen(READY)).toBe(false);
    expect(salonQuestionOpen([])).toBe(false);
  });
});

describe("positive: a short reply that is a salon", () => {
  it.each([
    ["410", ["loc-0410"]],
    ["0410", ["loc-0410"]],
    ["#410", ["loc-0410"]],
    ["salon 410", ["loc-0410"]],
    ["410.", ["loc-0410"]],
    ["254", ["loc-0410"]],
    ["omaha pacific", ["loc-0410"]],
    ["the omaha pacific salon", ["loc-0410"]],
    ["lincoln 27th street", ["loc-0310"]],
    ["it's omaha pacific", ["loc-0410"]],
    ["kearney", ["loc-0309"]],
  ])("%j", (reply, salons) => {
    expect(salonReply(reply, true)).toEqual(salons);
  });
});

describe("ambiguous: every salon the reply can mean, never one of them", () => {
  it("306 is salon 0306 and Google store code 306 (salon 0462)", () => {
    expect([...salonReply("306", true)!].sort()).toEqual(["loc-0306", "loc-0462"]);
  });
  it("a city several salons share", () => {
    expect(salonReply("lincoln", true)!.length).toBe(3);
    expect(salonReply("omaha", true)!.length).toBe(3);
  });
  it("a number that names no salon is an answer that names none", () => {
    expect(salonReply("999", true)).toEqual([]);
  });
});

describe("negative: times, prices, dates, quantities, questions and people are not salons", () => {
  it.each(["4:10", "at 4:10", "410pm", "$254", "254 dollars", "for 410 minutes", "4/10", "410 bottles", "410?", "she got here at 410 today", "pat rivera", "late again today", ""])(
    "%j",
    (reply) => {
      expect(salonReply(reply, true)).toBeNull();
    },
  );
  it("a bare number is read only when the salon question is open", () => {
    expect(salonReply("410", false)).toBeNull();
    expect(answersSalon(READY, "410")).toBe(false);
    expect(answersSalon(ASKED, "410")).toBe(true);
  });
});

describe("corrections", () => {
  it.each([
    ["sorry, it's omaha pacific", ["loc-0410"]],
    ["no wait, it's omaha pacific", ["loc-0410"]],
    ["actually, omaha pacific", ["loc-0410"]],
    ["actually it's salon 410", ["loc-0410"]],
    ["sorry, it's #0410", ["loc-0410"]],
    ["sorry, it's grand island", ["loc-0307"]],
  ])("%j", (turn, salons) => {
    expect(salonCorrection(turn)).toEqual(salons);
    expect(answersSalon(READY, turn)).toBe(true);
  });
  it.each(["actually 410", "sorry, she was late again", "no", "actually it's for sam jones"])("%j is not a salon correction", (turn) => {
    expect(salonCorrection(turn)).toBeNull();
  });
});

describe("multi-turn: the latest answer decides", () => {
  it("an answer is remembered after later turns", () => {
    const history = [...ASKED, { role: "user", content: "410" }, { role: "assistant", content: "Here is what I would put on a **Coaching Form**.", formProposal: { status: "ready" } }];
    expect(latestSalonAnswer(history, "she was late again today")).toEqual(["loc-0410"]);
  });
  it("a correction replaces the salon named in the first message", () => {
    expect(latestSalonAnswer(READY, "sorry, it's omaha pacific")).toEqual(["loc-0410"]);
  });
  it("a salon named later in an ordinary sentence hands back to the ordinary reading", () => {
    const history = [...ASKED, { role: "user", content: "410" }, { role: "assistant", content: "ok", formProposal: { status: "ready" } }];
    expect(latestSalonAnswer(history, "she was at the omaha pacific salon")).toBeNull();
  });
  it("nothing to answer: the ordinary reading decides", () => {
    expect(latestSalonAnswer(READY, "she was late again today")).toBeNull();
  });
});
