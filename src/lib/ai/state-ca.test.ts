import { afterEach, describe, expect, it } from "vitest";

import { detectTemplateIntent } from "@/lib/forms/template-intent";

import { statesSpelledOut, withStateNames } from "./state-ca";
import type { AskRequest } from "./types";

/** Ask Sunny conv_mvokdp2c24wi9re, 26 Oct 2026: the manager's turn "Sacramento, CA" exactly. */
const FLAG = "STATE_CA_GUARD_ENABLED";
const saved = process.env[FLAG];
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
});

describe("STATE_CA_GUARD_ENABLED off", () => {
  it("passes the turn on as typed; main reads 'Sacramento, CA' as the Corrective Action", () => {
    delete process.env[FLAG];
    const request = { question: "Sacramento, CA", history: [] } as unknown as AskRequest;
    expect(withStateNames(request)).toBe(request);
    expect(detectTemplateIntent("Sacramento, CA").kind).toBe("corrective_action");
  });
});

describe("STATE_CA_GUARD_ENABLED on", () => {
  it.each(["Sacramento, CA", "sacramento, ca", "Sacramento, ca", "SACRAMENTO, CA", "Los Angeles CA 90001", "los angeles ca 90001", "she moved to Sacramento, CA last month", "Los Angeles CA"])(
    "reads %s as a place, not a form",
    (text) => {
      process.env[FLAG] = "on";
      const out = withStateNames({ question: text, history: [] } as unknown as AskRequest).question;
      expect(out).toMatch(/California/);
      expect(detectTemplateIntent(out).kind).toBe("none");
    },
  );

  it("never changes 'ca' as a form", () => {
    for (const text of [
      "ca",
      "Ca",
      "CA",
      "ca for avery stone",
      "Ca for avery stone late today",
      "write up ca for avery stone",
      "create a ca",
      "Create a CA for Avery Stone",
      "need a ca",
      "verbal ca avery stone 10-10-26",
      "avery stone needs a ca",
      "what is a ca?",
    ]) {
      expect(statesSpelledOut(text)).toBe(text);
    }
  });
});

/**
 * QA-4 and QA-6, 26 Oct 2026: "CA" after a person, a salon or a topic is the
 * form. Names invented.
 */
describe("STATE_CA_GUARD_ENABLED on: CA after a name stays the form", () => {
  const sentence = (text: string) => text[0]!.toUpperCase() + text.slice(1);

  it.each([
    "Avery Stone CA",
    "Make Avery Stone CA",
    "Avery Stone, CA",
    "avery, ca",
    "at Lawrence CA",
    "Rowan Pell CA",
    "Test Employee CA",
    "Rowan Pell, CA",
    "Coaching, CA",
    "write up Rowan Pell, CA, verbal",
  ])("'%s' is left as typed, in lowercase and sentence case", (turn) => {
    process.env[FLAG] = "on";
    for (const variant of [turn, turn.toLowerCase(), sentence(turn.toLowerCase())]) expect(statesSpelledOut(variant)).toBe(variant);
  });

  it.each(["what is a ca?", "What is a ca?", "Los Angeles CA 90001", "Los angeles ca 90001", "she moved to sacramento, ca last month"])(
    "twins: '%s'",
    (turn) => {
      process.env[FLAG] = "on";
      const out = statesSpelledOut(turn);
      if (/what is a ca/i.test(turn)) expect(out).toBe(turn);
      else expect(out).toMatch(/California/);
    },
  );
});
