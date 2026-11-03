import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { patchOutputSchema, toPatch } from "./form-patch-schema";

/** Step B: the strict output schema the form-patch model is held to, its enum built per template. */

const schema = patchOutputSchema(["observation", "incident_date", "level"]);

const VALID = {
  turn: "this_form",
  set: [
    { field: "observation", value: "The towel bin was emptied twice.", how: "add", evidence: "the towel bin was emptied twice" },
    { field: "level", options: ["written"], how: "replace", evidence: "make it a written" },
  ],
  clear: [{ field: "incident_date", evidence: "take the date off" }],
};

describe("patchOutputSchema", () => {
  it("accepts a valid output, and an empty patch", () => {
    expect(schema.safeParse(VALID).success).toBe(true);
    expect(schema.safeParse({ turn: "question", set: [], clear: [] }).success).toBe(true);
  });

  it("rejects a field outside the template's keys", () => {
    const output = { ...VALID, set: [{ field: "employee_name", value: "x", how: "replace", evidence: "x" }] };
    expect(schema.safeParse(output).success).toBe(false);
    expect(schema.safeParse({ ...VALID, clear: [{ field: "salon", evidence: "x" }] }).success).toBe(false);
  });

  it("rejects extra keys at every level (strict)", () => {
    expect(schema.safeParse({ ...VALID, reply: "Updated!" }).success).toBe(false);
    expect(schema.safeParse({ ...VALID, set: [{ ...VALID.set[0], owner: "manager" }] }).success).toBe(false);
    expect(schema.safeParse({ ...VALID, clear: [{ ...VALID.clear[0], how: "replace" }] }).success).toBe(false);
  });

  it("rejects a missing or empty evidence, an unknown turn or how, and too many entries", () => {
    expect(schema.safeParse({ ...VALID, set: [{ field: "observation", value: "x", how: "add", evidence: "" }] }).success).toBe(false);
    expect(schema.safeParse({ ...VALID, set: [{ field: "observation", value: "x", how: "add" }] }).success).toBe(false);
    expect(schema.safeParse({ ...VALID, turn: "chat" }).success).toBe(false);
    expect(schema.safeParse({ ...VALID, set: [{ ...VALID.set[0], how: "merge" }] }).success).toBe(false);
    expect(schema.safeParse({ ...VALID, set: Array.from({ length: 21 }, () => VALID.set[0]) }).success).toBe(false);
    expect(schema.safeParse({ ...VALID, clear: Array.from({ length: 11 }, () => VALID.clear[0]) }).success).toBe(false);
    expect(schema.safeParse({ ...VALID, set: [{ ...VALID.set[0], value: "x".repeat(4001) }] }).success).toBe(false);
    expect(schema.safeParse({ turn: "this_form", set: [] }).success).toBe(false);
  });

  it("the JSON schema the model is given", () => {
    expect(z.toJSONSchema(schema)).toMatchSnapshot();
  });
});

describe("toPatch", () => {
  it("turns the output into a reducer patch", () => {
    const parsed = schema.parse(VALID);
    expect(toPatch(parsed)).toEqual({
      set: { observation: "The towel bin was emptied twice.", level: ["written"] },
      clear: ["incident_date"],
      how: { observation: "add", level: "replace" },
      evidence: {
        observation: "the towel bin was emptied twice",
        level: "make it a written",
        incident_date: "take the date off",
      },
    });
  });

  it("a set with neither value nor options is a set to empty, which the reducer ignores", () => {
    const parsed = schema.parse({ turn: "this_form", set: [{ field: "observation", how: "add", evidence: "x" }], clear: [] });
    expect(toPatch(parsed).set).toEqual({ observation: "" });
  });
});
