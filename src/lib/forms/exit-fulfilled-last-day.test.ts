import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readExitFacts } from "./exit-facts";

/*
 * EXIT_FULFILLED_IS_LAST_DAY_ENABLED. Manager, 26 Oct 2026 (Ask Sunny
 * production), word for word, the name invented: the notice was worked to the
 * last day, and "Date that notice was fulfilled" stayed blank.
 */
const TODAY = "2026-10-26";
const TURNS = [
  "on 9-15-26 ivy provided her resignation to management and her last day worked was 9-28-26",
  "ivy gave and worked 2 week notice",
];
const sentence = (turn: string) => turn.replace(/^([a-z])/, (letter) => letter.toUpperCase()).replace(/\bivy\b/g, "Ivy");

const FLAG = "EXIT_FULFILLED_IS_LAST_DAY_ENABLED";
const saved = new Map<string, string | undefined>();
beforeEach(() => {
  for (const name of [FLAG, "EXIT_INTAKE_FIX_ENABLED"]) saved.set(name, process.env[name]);
  process.env.EXIT_INTAKE_FIX_ENABLED = "true";
  delete process.env[FLAG];
});
afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe(`${FLAG} on`, () => {
  it.each([
    ["lowercase", TURNS],
    ["Sentence case", TURNS.map(sentence)],
  ])("%s: the notice was fulfilled on the last day worked", (_casing, turns) => {
    process.env[FLAG] = "true";
    const facts = readExitFacts(turns.join("\n\n"), TODAY);
    expect(facts.noticeGiven).toBe("2026-09-15");
    expect(facts.lastDayWorked).toBe("2026-09-28");
    expect(facts.noticeFulfilled).toBe("2026-09-28");
  });

  it("a notice not said to be worked leaves the line blank", () => {
    process.env[FLAG] = "true";
    expect(readExitFacts(TURNS[0]!, TODAY).noticeFulfilled).toBeNull();
  });

  it("a notice cut short leaves it blank", () => {
    process.env[FLAG] = "true";
    expect(readExitFacts(`${TURNS[0]}\n\nshe did not fulfill her notice`, TODAY).noticeFulfilled).toBeNull();
  });

  it("a fulfilled date the manager gave is kept", () => {
    process.env[FLAG] = "true";
    expect(readExitFacts(`${TURNS[0]}\n\nher notice was fulfilled 9-26-26`, TODAY).noticeFulfilled).toBe("2026-09-26");
  });
});

describe(`${FLAG} off: as main`, () => {
  it("the line stays blank", () => {
    expect(readExitFacts(TURNS.join("\n\n"), TODAY).noticeFulfilled).toBeNull();
  });

  it("the flag reads off by default", async () => {
    const { exitFulfilledIsLastDayEnabled } = await import("@/lib/config/chat-quality-flags");
    expect(exitFulfilledIsLastDayEnabled()).toBe(false);
  });
});
