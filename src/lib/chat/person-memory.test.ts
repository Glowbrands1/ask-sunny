import { describe, expect, it } from "vitest";

import { MEMORY_SECTION } from "@/lib/ai/prompts";
import {
  MAX_EXCERPT_CHARS,
  MAX_PEOPLE,
  excerptFor,
  isAboutPerson,
  mentionsPerson,
  namesToRecall,
  rememberedDate,
  renderMemoryBlock,
} from "./person-memory";

/**
 * WHO A TURN IS ABOUT, AND WHAT IS RECALLED ABOUT THEM — the pure half of
 * Ask Sunny's memory of the people a manager has told it about.
 */

const turn = (content: string, createdAt = "2026-10-03T15:00:00Z") => ({ content, createdAt });

describe("namesToRecall — who this turn may be about", () => {
  it("reads a name given on purpose as confirmed", () => {
    expect(
      namesToRecall({ question: "What should I do about Sarah Test?", history: [] }),
    ).toEqual([{ name: "Sarah Test", confirmed: true }]);
  });

  it("reads a lone capitalised first name as unconfirmed", () => {
    expect(
      namesToRecall({ question: "Sarah was late again today, what now?", history: [] }),
    ).toEqual([{ name: "Sarah", confirmed: false }]);
  });

  it("never reads the words a question opens with as a person", () => {
    expect(
      namesToRecall({ question: "Can you create a coaching form for attendance?", history: [] }),
    ).toEqual([]);
    expect(namesToRecall({ question: "What is the refund policy?", history: [] })).toEqual([]);
  });

  it("recalls the person the conversation already named when the question uses a pronoun", () => {
    expect(
      namesToRecall({
        question: "What should I do with her now?",
        history: [
          { role: "user", content: "I need a coaching form for Dana Moss" },
          { role: "assistant", content: "Sure — what happened?" },
        ],
      }),
    ).toEqual([{ name: "Dana Moss", confirmed: true }]);
  });

  it("keeps one entry per person, with the fuller spelling", () => {
    expect(
      namesToRecall({
        question: "Sarah said she would be on time",
        history: [{ role: "user", content: "Coaching form for Sarah Test" }],
      }),
    ).toEqual([{ name: "Sarah Test", confirmed: true }]);
  });

  it("leaves the manager's own name out", () => {
    expect(
      namesToRecall({
        question: "Paulyne here — how do I coach Jordan Avery?",
        history: [],
        userName: "Paulyne",
      }).map((person) => person.name),
    ).toEqual(["Jordan Avery"]);
  });

  it("recalls at most a few people", () => {
    const names = namesToRecall({
      question: "Coach Amy Fox, Ben Hale, Cara Diaz, Dev Rao and Eli Moss",
      history: [],
    });
    expect(names.length).toBeLessThanOrEqual(MAX_PEOPLE);
  });
});

describe("mentionsPerson — a whole word, in any case", () => {
  it("matches the first name, a possessive and lower case", () => {
    expect(mentionsPerson("sarah was late", "Sarah Test")).toBe(true);
    expect(mentionsPerson("Sarah's schedule changed", "Sarah")).toBe(true);
  });

  it("does not match inside another word", () => {
    expect(mentionsPerson("the same thing happened", "Sam")).toBe(false);
    expect(mentionsPerson("Samantha was late", "Sam")).toBe(false);
  });
});

describe("isAboutPerson — an earlier conversation is about this person", () => {
  const sarahTest = { name: "Sarah Test", confirmed: true };

  it("when it mentions them", () => {
    expect(isAboutPerson(sarahTest, [turn("Sarah was late three times this week")])).toBe(true);
  });

  it("not when it never mentions them", () => {
    expect(isAboutPerson(sarahTest, [turn("Jordan was late three times")])).toBe(false);
  });

  it("not when it names somebody else with the same first name", () => {
    expect(isAboutPerson(sarahTest, [turn("Coaching form for Sarah Miller, she was late")])).toBe(
      false,
    );
  });

  it("for an unconfirmed name, only where the earlier conversation named them on purpose", () => {
    const sarah = { name: "Sarah", confirmed: false };
    expect(isAboutPerson(sarah, [turn("Coaching form for Sarah"), turn("she was late")])).toBe(true);
    expect(isAboutPerson(sarah, [turn("Sarah brand lotion is selling well")])).toBe(false);
  });

  it("for an unconfirmed name, where a form was filed about them", () => {
    const sarah = { name: "Sarah", confirmed: false };
    expect(isAboutPerson(sarah, [turn("Sarah was late again")], true)).toBe(true);
  });
});

describe("excerptFor — the manager's own words, from where the person comes up", () => {
  it("starts at the first mention and carries the turns after it", () => {
    expect(
      excerptFor({ name: "Sarah", confirmed: true }, [
        turn("Create a coaching form"),
        turn("For Sarah"),
        turn("She was late three times, her car broke down"),
      ]),
    ).toEqual(["For Sarah", "She was late three times, her car broke down"]);
  });

  it("stays within its budget", () => {
    const long = "x".repeat(450);
    const excerpt = excerptFor(
      { name: "Sarah", confirmed: true },
      Array.from({ length: 10 }, (_, index) => turn(index === 0 ? `Sarah ${long}` : long)),
    );
    expect(excerpt.join("").length).toBeLessThanOrEqual(MAX_EXCERPT_CHARS);
    expect(excerpt.length).toBeGreaterThan(1);
  });
});

describe("renderMemoryBlock", () => {
  it("is null when nothing was recalled", () => {
    expect(renderMemoryBlock([], "Paulyne")).toBeNull();
    expect(renderMemoryBlock([{ name: "Sarah", conversations: [], forms: [] }], "Paulyne")).toBeNull();
  });

  it("says what it is and quotes the manager", () => {
    const block = renderMemoryBlock(
      [
        {
          name: "Sarah Test",
          conversations: [
            { title: "Coaching form for Sarah Test", date: "2026-10-03", excerpt: ["She was late"] },
          ],
          forms: [
            {
              employeeName: "Sarah Test",
              templateName: "Coaching Form",
              formDate: "2026-10-03",
              status: "finalized",
            },
          ],
        },
      ],
      "Paulyne",
    )!;

    expect(block.startsWith(MEMORY_SECTION)).toBe(true);
    expect(block).toContain("not a verified record and not company policy");
    expect(block).toContain("ABOUT SARAH TEST");
    expect(block).toContain('Earlier conversation, 2026-10-03 — "Coaching form for Sarah Test"');
    expect(block).toContain("> She was late");
    expect(block).toContain("- Coaching Form for Sarah Test — dated 2026-10-03, finalized");
  });
});

describe("rememberedDate", () => {
  it("is the business day, not the UTC one", () => {
    // 9pm Central on October 3 is already October 4 in UTC.
    expect(rememberedDate("2026-10-04T02:00:00Z")).toBe("2026-10-03");
  });

  it("is null for an unreadable instant", () => {
    expect(rememberedDate("not a date")).toBeNull();
  });
});
