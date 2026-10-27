import { describe, expect, it } from "vitest";

import type { GroundedPerson } from "../grounded-entities";
import type { CheckContext } from "./check";
import { lastFirstReading } from "./last-first";

/**
 * LAST_FIRST_NAME_READ_ENABLED: QA's five "Last, First" variants (27 Oct 2026),
 * word for word, every person invented. Today's name reader gave "Marlowe",
 * "Hollis Ivy", "Ferris Dale", "Quill" for Mara, and no employee at all.
 */
const person = (id: string, firstName: string, lastName: string): GroundedPerson => ({
  id,
  firstName,
  lastName,
  preferredFirstName: null,
  salonIds: ["loc-0309"],
  title: null,
  primaryLocationName: null,
  primarySalonId: null,
});
const PEOPLE = [person("e-1", "Quinn", "Marlowe"), person("e-2", "Dale", "Ferris"), person("e-3", "Mara", "Quill"), person("e-4", "Ivy", "Hollis"), person("e-5", "Quinn", "Ferris")];

const context = (managerTurns: string[], people = PEOPLE): CheckContext => ({
  managerTurns,
  people,
  locations: [{ id: "loc-0309", name: "NE Kearney" }],
  headings: ["Attendance"],
  today: "2026-10-27",
});
const name = (turns: string[], people = PEOPLE) => lastFirstReading(context(turns, people))?.employee?.name ?? null;

const S1 = [
  "My employee Marlowe, Quinn has was 10 minutes late on her last two shifts. On the first shift I verbally coached her on our policy and expectations. Then she was late again. Please create a CA form so I can document. She was late on 10/5 and 10/15",
  "I already told you the employee name. She is at Kearney",
  "10/15",
];
const S3 = [
  "i need to issue a ca for someone being late",
  "Marlowe, Quinn was late on 10/20 and the salon was opened late",
  "she was issued a verbal ca on 10.1 for this same thing",
  "yes payrol ldeduct",
  "i dont know the amount",
  "kearney",
];
const S9 = [
  "create an exit form. employee name is Hollis, Ivy. ivy was a tanning consultant at manhattan location. on 9-15-26 ivy provided her resignation to management and her last day worked was 9-28-26",
  "ivy gave and worked 2 week notice. ivy messaged management her resignation via woven. all salon items were returned and she is eligible for rehire",
];
const S11 = ["create corrective action form for Quill, Mara, Salon Director", "Quill, Mara, Salon Director"];
const S13 = [
  "create coaching form for employee Ferris, Dale who is a tanning consultant at manhattan. on 9-29-26 dale was out of dress code",
  "employee name is Ferris, Dale",
  "create coaching form for Ferris, Dale",
];

describe("the five Last, First chats", () => {
  it.each([
    ["S1", S1, "Quinn Marlowe"],
    ["S3", S3, "Quinn Marlowe"],
    ["S9", S9, "Ivy Hollis"],
    ["S11", S11, "Mara Quill"],
    ["S13", S13, "Dale Ferris"],
  ])("%s reads the one person on the roster", (_id, turns, expected) => {
    expect(name(turns)).toBe(expected);
  });
});

describe("nothing is read that the roster cannot settle", () => {
  it("no pair, or not a person: nothing", () => {
    expect(name(["create a ca form for quinn marlowe, she was late"])).toBeNull();
    expect(name(["Hello, Quinn", "Tuesday, October 20 she was late", "Kearney, Nebraska"])).toBeNull();
  });

  it("a pair that fits two people is not read (Quinn Ferris and Quinn Marlowe)", () => {
    expect(name(["create a ca for Quinn, Marlowe"], PEOPLE)).toBe("Quinn Marlowe");
    expect(name(["create a ca for Ferris, Quinn"], PEOPLE)).toBe("Quinn Ferris");
    expect(name(["create a ca for Quinn, Quinn"], PEOPLE)).toBeNull();
  });

  it("no roster: the typed name stands only with a person to check against, so nothing is read", () => {
    expect(name(S1, [])).toBeNull();
  });
});
