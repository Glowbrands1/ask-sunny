import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const reply = vi.fn();
vi.mock("../call-claude", () => ({ callClaudeToolTimed: (...args: unknown[]) => reply(...args) }));

import { lastFirstAiFallbackEnabled } from "@/lib/config/chat-quality-flags";

import type { GroundedPerson } from "../grounded-entities";
import type { CheckContext } from "./check";
import { withFilledEmployeeKept, withLastFirstFallback } from "./last-first-fallback";
import { readFormRequest } from "./read";

/**
 * LAST_FIRST_AI_FALLBACK_ENABLED (QA's old-PR audit of #352, 6 Nov 2026; ported from Ask Bubbles): with the AI reader
 * on, "<Last>, <First>" is read by `last-first.ts` when the reader gives no employee, and never otherwise. QA's
 * audit wording; every person invented.
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
const PEOPLE = [person("e-1", "Remy", "Calder"), person("e-2", "Odile", "Calder"), person("e-3", "Tess", "Varga")];
const AUDIT = "My employee Calder, Remy was late on the 2nd at Kearney. Please create a CA form";

const context = (turn: string, people = PEOPLE): CheckContext => ({ managerTurns: [turn], people, locations: [], headings: [], today: "2026-10-26" });
/** The AI reader's reply: its employee, with the manager's sentence as the quote. */
function aiReads(turn: string, employee: string | null, extra: Record<string, unknown> = {}) {
  reply.mockResolvedValueOnce({
    input: { employee: employee ? { value: employee, evidence: turn } : null, ...extra },
    usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
  });
}
async function read(turn: string, people = PEOPLE) {
  const ready = context(turn, people);
  const ai = await readFormRequest({ turns: [{ role: "user", content: turn }], context: ready });
  const after = withLastFirstFallback(ai, ready);
  return {
    off: "checked" in ai ? (ai.checked.employee?.person?.id ?? null) : null,
    on: "checked" in after ? (after.checked.employee?.person?.id ?? null) : null,
    after,
  };
}

afterEach(() => {
  reply.mockReset();
  vi.unstubAllEnvs();
});

describe("the AI reader gave no employee: the last-first reading fills it", () => {
  it("the reader returned nothing for QA's wording", async () => {
    aiReads(AUDIT, null);
    expect(await read(AUDIT)).toMatchObject({ off: null, on: "e-1" });
  });

  it("the reader threw", async () => {
    reply.mockRejectedValueOnce(new Error("overloaded"));
    const { off, on, after } = await read(AUDIT);
    expect({ off, on }).toEqual({ off: null, on: "e-1" });
    // The last-first reading at no cost: the trace says source last_first, the spend guard counts nothing.
    expect(after).toMatchObject({ ms: 0, usage: { inputTokens: 0, outputTokens: 0 } });
  });

  it("the reader returned only the <Last> word of the <Last>, <First> the manager typed (two Calders)", async () => {
    aiReads(AUDIT, "Calder");
    expect(await read(AUDIT)).toMatchObject({ off: null, on: "e-1" });
  });

  it("the reader's other fields are kept, and its usage is still counted", async () => {
    const turn = `${AUDIT} verbal`;
    aiReads(turn, null, { warningLevel: { value: "verbal", evidence: "verbal" } });
    const { after } = await read(turn);
    expect(after).toMatchObject({ checked: { warningLevel: "verbal", employee: { name: "Remy Calder" }, quotedEmployee: "Calder, Remy" }, usage: { inputTokens: 10 } });
  });
});

describe("never breaks what the reader read", () => {
  it("the reader read the right person: kept as it is", async () => {
    aiReads(AUDIT, "Calder, Remy");
    const ready = context(AUDIT);
    const ai = await readFormRequest({ turns: [{ role: "user", content: AUDIT }], context: ready });
    expect(withLastFirstFallback(ai, ready)).toBe(ai);
  });

  it("the reader's lone <Last> fits one person: that person is the pair's, kept as it is", async () => {
    aiReads(AUDIT, "Calder");
    const people = [person("e-1", "Remy", "Calder"), person("e-3", "Tess", "Varga")];
    expect(await read(AUDIT, people)).toMatchObject({ off: "e-1", on: "e-1" });
  });

  it("the reader read another person than the pair: kept", async () => {
    const turn = "Tess Varga covered for Calder, Remy. Please create a CA form for Tess Varga";
    aiReads(turn, "Tess Varga");
    expect(await read(turn)).toMatchObject({ off: "e-3", on: "e-3" });
  });

  it.each([
    ["Remy was late, again on the 2nd at Kearney. Please create a CA form"],
    ["Remy Calder, my opener, was late on the 2nd at Kearney. Please create a CA form"],
    ["Late, Again on the 2nd. Please create a CA form"],
  ])("a comma that is not a name, with no employee read: nothing is filled — %s", async (turn) => {
    aiReads(turn, null);
    expect(await read(turn)).toMatchObject({ off: null, on: null });
  });

  it("a comma that is not a name, with the person read: kept — <First> <Last>, my opener", async () => {
    const turn = "Remy Calder, my opener, was late on the 2nd at Kearney. Please create a CA form";
    aiReads(turn, "Remy Calder");
    expect(await read(turn)).toMatchObject({ off: "e-1", on: "e-1" });
  });

  it("the reader fell back and there is no pair: the fallback stays", async () => {
    reply.mockRejectedValueOnce(new Error("overloaded"));
    expect((await read("create a ca for remy calder")).after).toEqual({ fallback: "error" });
  });
});

describe("this app's corrected-employee read: a word of the filled person's own name is not a correction", () => {
  const remy = PEOPLE[0]!;
  const tess = PEOPLE[2]!;
  const filled: { person: GroundedPerson | null; name: string; typed: string; ambiguous: never[] } = { person: remy, name: "Remy Calder", typed: "Calder", ambiguous: [] };
  it.each([
    ["Calder", null, "kept"],
    ["Remy", null, "kept"],
    ["Tess Varga", tess, "corrected"],
    ["Quinn Marlowe", null, "corrected"],
  ] as const)("the turn names %s", (name, person, expected) => {
    const corrected = { person, name, typed: name, ambiguous: [] };
    expect(withFilledEmployeeKept(filled, corrected)).toBe(expected === "kept" ? filled : corrected);
  });
  it("nothing was filled: the correction stands", () => {
    const open = { person: null, name: "Calder", typed: "Calder", ambiguous: [] };
    const corrected = { person: null, name: "Calder", typed: "Calder", ambiguous: [] };
    expect(withFilledEmployeeKept(open, corrected)).toBe(corrected);
  });
});

describe("the flag", () => {
  it("is off by default, and on only with LAST_FIRST_NAME_READ_ENABLED", () => {
    expect(lastFirstAiFallbackEnabled()).toBe(false);
    vi.stubEnv("LAST_FIRST_AI_FALLBACK_ENABLED", "true");
    expect(lastFirstAiFallbackEnabled()).toBe(false);
    vi.stubEnv("LAST_FIRST_NAME_READ_ENABLED", "true");
    expect(lastFirstAiFallbackEnabled()).toBe(true);
  });
});
