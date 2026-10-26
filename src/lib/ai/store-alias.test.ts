import { afterEach, describe, expect, it } from "vitest";

import { readSalonMentions } from "@/lib/forms/salon-mention";
import { PRODUCTION_SALONS } from "@/data/salons";

import { rosterNames, withStoreAliases } from "./store-alias";
import type { AskRequest } from "./types";

/**
 * Ask Sunny conv_mvoehonm2pfrkng, 25 Oct 2026: "test testy, location o st,
 * today's date, on 9-20-26 test was 10 minutes late clocking in, this is a
 * verbal, test is a tc" — "o st" was not read as NE Lincoln O Street. The
 * manager's words exactly; "test testy" is the manager's own placeholder.
 */
const FLAG = "STORE_ALIAS_ENABLED";
const saved = process.env[FLAG];
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
});

const REPORTED = "test testy, location o st, today's date, on 9-20-26 test was 10 minutes late clocking in, this is a verbal, test is a tc";
const O_STREET = PRODUCTION_SALONS.find((salon) => salon.name === "NE Lincoln O Street")!;
const KEARNEY = PRODUCTION_SALONS.find((salon) => salon.name === "NE Kearney")!;

function ids(text: string): string[] {
  return [...new Set(readSalonMentions(text).flatMap((mention) => mention.salonIds))];
}

describe("STORE_ALIAS_ENABLED off", () => {
  it("passes the turn on as typed, and main's reader does not find O Street in it", () => {
    delete process.env[FLAG];
    const request = { question: REPORTED, history: [] } as unknown as AskRequest;
    expect(withStoreAliases(request)).toBe(request);
    expect(ids(REPORTED)).not.toContain(O_STREET.id);
  });
});

describe("STORE_ALIAS_ENABLED on", () => {
  it("reads 'location o st' as NE Lincoln O Street, the rest of the turn as typed", () => {
    process.env[FLAG] = "on";
    const out = withStoreAliases({ question: REPORTED, history: [] } as unknown as AskRequest);
    expect(out.question).toBe(REPORTED.replace("o st", "NE Lincoln O Street"));
    expect(ids(out.question)).toEqual([O_STREET.id]);
  });

  it.each([
    ["o st", O_STREET],
    ["O ST", O_STREET],
    ["at o st today", O_STREET],
    ["lincoln o st", O_STREET],
    ["o st lincoln", O_STREET],
    ["kearney ne", KEARNEY],
    ["Kearney ne", KEARNEY],
    ["Kearney, Ne", KEARNEY],
    ["At o st today", O_STREET],
    ["Lincoln o st", O_STREET],
    ["kearney, ne", KEARNEY],
    ["KEARNEY, NE", KEARNEY],
    ["she works at our kearney ne salon", KEARNEY],
  ])("reads %s as its salon", (text, salon) => {
    expect(ids(rosterNames(text))).toEqual([salon.id]);
  });

  it("reads the reported turn the same in sentence case", () => {
    const sentence = REPORTED[0]!.toUpperCase() + REPORTED.slice(1);
    expect(ids(rosterNames(sentence))).toEqual([O_STREET.id]);
  });

  it("reads a one-word salon reply as the salon only after the app asked which salon", () => {
    // Changed on purpose (QA, 26 Oct 2026): a whole-turn reply is written as the
    // salon answer, so the incident readers never take it for What happened.
    expect(rosterNames("kearney", true)).toBe("the salon is NE Kearney");
    expect(rosterNames("Kearney", true)).toBe("the salon is NE Kearney");
    expect(rosterNames("kearney")).toBe("kearney");
    process.env[FLAG] = "on";
    const out = withStoreAliases({
      question: "kearney",
      history: [{ role: "assistant", content: "I have **Avery Stone**. Which salon is this for?" }],
    } as unknown as AskRequest);
    expect(out.question).toBe("the salon is NE Kearney");
  });

  it("leaves people, other words and roster names as typed", () => {
    for (const text of [
      "Liberty",
      "kearney",
      "create a ca for avery kearney",
      "post office",
      "joe st",
      "she works at our KS Manhattan salon",
      "NE Lincoln O Street",
      "the costa st report",
    ]) {
      expect(rosterNames(text)).toBe(text);
    }
  });
});

/**
 * QA, 26 Oct 2026, with STORE_ALIAS_ENABLED on alone: the typed Permanent
 * Address "123 Main St, Lawrence, KS 66044" was no longer filled (the city
 * and state inside it were rewritten), and a later place word changed the
 * salon (salon-replay-oct25 T3, NEWEST_PLACE_TURN_ENABLED off).
 */
describe("STORE_ALIAS_ENABLED on: addresses and later place words", () => {
  const EXIT = "create an exit form for Test Employee at Lawrence, permanent address 123 Main St, Lawrence, KS 66044. She did not call in for her last two shifts. Last day worked 10-20-26";

  it.each([EXIT, EXIT.toLowerCase(), EXIT.toUpperCase()])("keeps the typed address as typed: %s", (turn) => {
    process.env[FLAG] = "on";
    const address = /123 main st, lawrence, ks 66044/i.exec(turn)![0];
    expect(withStoreAliases({ question: turn, history: [] } as unknown as AskRequest).question).toContain(address);
    expect(rosterNames(`permanent address ${address}`)).toBe(`permanent address ${address}`);
  });

  it.each([
    "change salon location to grand island, ne",
    "Change salon location to Grand Island, NE",
    "CHANGE SALON LOCATION TO GRAND ISLAND, NE",
  ])("leaves a later place word as typed once a salon is named: %s", (later) => {
    process.env[FLAG] = "on";
    const history = [
      { role: "user", content: "do verbal corrective action for Test Employee, team member at Kearney, NE. location." },
      { role: "assistant", content: "Got it." },
      { role: "user", content: later },
      { role: "assistant", content: "Got it." },
    ];
    const out = withStoreAliases({ question: 'create a Corrective Action Form for Test Employee"', history } as unknown as AskRequest);
    expect(out.history.map((turn) => turn.content)).toEqual(history.map((turn) => turn.content));
  });

  it("still names the first salon from an alias after other turns", () => {
    process.env[FLAG] = "on";
    const history = [
      { role: "user", content: "ca for test testy, late 9-20-26" },
      { role: "assistant", content: "Which salon is this for?" },
    ];
    const out = withStoreAliases({ question: "location o st", history } as unknown as AskRequest);
    expect(ids(out.question)).toContain(O_STREET.id);
  });
});
