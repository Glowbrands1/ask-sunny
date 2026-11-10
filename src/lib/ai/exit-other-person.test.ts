import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "@/types";

import { withExitOtherPersonNotOffered } from "./exit-other-person";
import type { AskResponse } from "./types";

// EXIT_OTHER_PERSON_NOT_SUBJECT_ENABLED (QA's Sunny round-5 live tester, 8 Nov 2026, item 4b). Invented people.
const LETTER =
  "Meeting with Dorran tomorrow 11/06. The tone of the message was also disrespectful to your Salon Director, Philippa. Your employment is terminated, effective 11/06/2026.";
const ASK = (names: string) =>
  `Which of them is this **Resignation/Exit Form** for — ${names}? Tell me and I'll fill in what you've already described.\n\n**Job title:** Salon Director`;
const answer = (content: string) => ({ content }) as AskResponse;
const request = (question: string, history: string[] = []) => ({
  question,
  history: history.map((content, index) => ({ id: `u${index}`, role: "user", content, createdAt: "2026-11-05T20:00:00Z" }) as ChatMessage),
});

beforeEach(() => vi.stubEnv("EXIT_OTHER_PERSON_NOT_SUBJECT_ENABLED", "true"));
afterEach(() => vi.unstubAllEnvs());

describe("withExitOtherPersonNotOffered", () => {
  it("off: unchanged", () => {
    vi.stubEnv("EXIT_OTHER_PERSON_NOT_SUBJECT_ENABLED", "");
    const response = answer(ASK("**Philippa** or **Dorran**"));
    expect(withExitOtherPersonNotOffered(response, request(`I need an exit form. ${LETTER}`))).toBe(response);
  });

  it("on: the person named only after a title is not offered, and the title line goes", () => {
    const out = withExitOtherPersonNotOffered(answer(ASK("**Philippa** or **Dorran**")), request(`I need an exit form. ${LETTER}`, [LETTER]));
    expect(out.content).not.toMatch(/Philippa/);
    expect(out.content).not.toMatch(/Job title/);
    expect(out.content).toMatch(/^Who is this \*\*Resignation\/Exit Form\*\* for\?/);
  });

  it("on: three candidates, one after a title: the two others are still the choice", () => {
    const said = `I need an exit form. ${LETTER} Rowan was there too.`;
    const out = withExitOtherPersonNotOffered(answer(ASK("**Philippa**, **Dorran** or **Rowan**")), request(said));
    expect(out.content).toMatch(/Which of them is this \*\*Resignation\/Exit Form\*\* for — \*\*Dorran\*\* or \*\*Rowan\*\*\?/);
  });

  it("on: a person also named plainly stays a candidate", () => {
    const said = `I need an exit form. ${LETTER} Philippa also quit today.`;
    const response = answer(ASK("**Philippa** or **Dorran**"));
    expect(withExitOtherPersonNotOffered(response, request(said))).toBe(response);
  });

  it("on: not the exit question: unchanged", () => {
    const response = answer("Which of them is this **Coaching Form** for — **Philippa** or **Dorran**? Tell me and I'll draft it from what you've already described.");
    expect(withExitOtherPersonNotOffered(response, request(LETTER))).toBe(response);
  });
});
