import { afterEach, describe, expect, it } from "vitest";

import { readSalonMentions } from "@/lib/forms/salon-mention";

import { placesMarked, withNamePlaceAnswer } from "./name-place-answer";
import type { AskRequest } from "./types";

/**
 * QA live runs, 26 Oct 2026 (S3, S8; names invented): "<name>, <place>,
 * <title>, use today's date" to "Who is this form for?" left the place unset.
 */
const FLAG = "NAME_PLACE_ANSWER_ENABLED";
const saved = process.env[FLAG];
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
});

function places(text: string): string[] {
  return [...new Set(readSalonMentions(text).flatMap((mention) => mention.salonIds))];
}

const ANSWER = "rory vance, wornall, tanning consultant, use today's date";
const NAMED = "employee name: rory vance, wornall, late today";

describe("NAME_PLACE_ANSWER_ENABLED off", () => {
  it("reads the turn as typed; the reader finds no place in it, as on main", () => {
    delete process.env[FLAG];
    const request = { question: ANSWER, history: [] } as unknown as AskRequest;
    expect(withNamePlaceAnswer(request)).toBe(request);
    expect(places(ANSWER)).toEqual([]);
  });
});

describe("NAME_PLACE_ANSWER_ENABLED on", () => {
  const sentence = (text: string) => text[0]!.toUpperCase() + text.slice(1);

  it.each([ANSWER, sentence(ANSWER), NAMED, sentence(NAMED)])("'%s' names the place", (turn) => {
    process.env[FLAG] = "on";
    const out = withNamePlaceAnswer({ question: turn, history: [] } as unknown as AskRequest).question;
    expect(out).toMatch(/, at wornall,/i);
    expect(places(out)).toHaveLength(1);
  });

  it.each([
    "rory vance, late today",
    "wornall, rory vance",
    "rory vance, at wornall, tanning consultant",
    "rory vance was late today",
    "what is the policy for wornall",
  ])("leaves '%s' as typed", (turn) => {
    process.env[FLAG] = "on";
    expect(placesMarked(turn)).toBe(turn);
  });

  it("marks an earlier answer too", () => {
    process.env[FLAG] = "on";
    const out = withNamePlaceAnswer({ question: "use today's date", history: [{ role: "user", content: "rory vance, lawrence, tanning consultant" }] } as unknown as AskRequest);
    expect(out.history[0]!.content).toBe("rory vance, at lawrence, tanning consultant");
  });
});
