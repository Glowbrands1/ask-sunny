import { afterEach, describe, expect, it } from "vitest";

import { candidateNameWords, matchRowsToQuestion } from "./chat-form-records";
import type { InstanceRow } from "./instances";

/**
 * FORMS_ON_FILE_ORDER_MATCH_POSSIBLE_ENABLED (ported from Ask Bubbles, 11 Nov 2026; QA's Bubbles 17h live test): forms
 * filed as "<last> <first>" were listed as naming the person asked about, because every word of the name was in the
 * question. The tester's wording, with this app's title; the person is invented.
 */
const FLAG = "FORMS_ON_FILE_ORDER_MATCH_POSSIBLE_ENABLED";
const QUESTION = "Corrective action for Tanning Consultant Wren Tallis";

const row = (employeeName: string) => ({ id: employeeName, employeeName }) as unknown as InstanceRow;
const split = () => {
  const { named, possible } = matchRowsToQuestion([row("Tallis Wren"), row("Wren Tallis"), row("Wren Park")], candidateNameWords(QUESTION));
  return { named: named.map((r) => r.employeeName), possible: possible.map((r) => r.employeeName) };
};

afterEach(() => {
  delete process.env[FLAG];
});

describe("FORMS_ON_FILE_ORDER_MATCH_POSSIBLE: a reversed name is a possible match", () => {
  it("flag off (as on main): \"Tallis Wren\" names the person asked about", () => {
    expect(split()).toEqual({ named: ["Tallis Wren", "Wren Tallis"], possible: ["Wren Park"] });
  });

  it("flag on: \"Tallis Wren\" is possible; \"Wren Tallis\" still names them; a first name alone stays possible", () => {
    process.env[FLAG] = "true";
    expect(split()).toEqual({ named: ["Wren Tallis"], possible: ["Tallis Wren", "Wren Park"] });
  });
});
