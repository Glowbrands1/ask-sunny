import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { groundFormSlots } from "./form-full-remap";

/**
 * NEGATED_PERSON_NO_CARD_ENABLED on the full remap (FORM_FULL_REMAP_ENABLED),
 * QA-6, 26 Oct 2026. The extraction model copies the person a turn names,
 * negated or not, and with nobody copied the remap's own reader read the
 * first capitalised name: with the card open for Corvin Mallow, "never one
 * for Rowan Pell" moved the card to Rowan Pell. Each turn in lower case,
 * Sentence case and ALL CAPS, with the model copying Rowan Pell, Corvin
 * Mallow or nobody. Rowan Pell and Corvin Mallow are invented names.
 */

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }),
}));

const OPEN = "create a written CA for Corvin Mallow at Kearney for being late on 10-20-26. no payroll deduct";
const ROSTER = [
  { id: "corvin", firstName: "Corvin", lastName: "Mallow", preferredFirstName: null, salonIds: ["loc-0309"] },
  { id: "rowan", firstName: "Rowan", lastName: "Pell", preferredFirstName: null, salonIds: ["loc-0309"] },
];
const MODEL = ["Rowan Pell", "Corvin Mallow", null] as const;
const registers = (text: string) => [text.toLowerCase(), text.charAt(0).toUpperCase() + text.slice(1), text.toUpperCase()];

function employeeAfter(second: string, model: string | null): string | null {
  const { slots } = groundFormSlots({
    raw: { templateKey: "dpoa", employeeName: model, observation: null, actionPlan: null },
    history: [
      { role: "user", content: OPEN },
      { role: "assistant", content: "Here is the Corrective Action Form." },
    ],
    question: second,
    today: "2026-10-24",
    people: ROSTER,
  });
  return slots.employeeName?.toLowerCase() ?? null;
}

beforeEach(() => {
  vi.stubEnv("FORM_FULL_REMAP_ENABLED", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("NEGATED_PERSON_NO_CARD_ENABLED on: the remap's person", () => {
  beforeEach(() => {
    vi.stubEnv("NEGATED_PERSON_NO_CARD_ENABLED", "true");
  });

  it.each([...registers("never one for Rowan Pell"), ...registers("do not make one for Rowan Pell")])(
    "%s → no card for Rowan Pell, the card stays Corvin Mallow",
    (text) => {
      for (const model of MODEL) expect(employeeAfter(text, model), String(model)).toBe("corvin mallow");
    },
  );

  it.each(registers("no, not for Rowan Pell, for Corvin Mallow"))("%s → Corvin Mallow", (text) => {
    for (const model of MODEL) expect(employeeAfter(text, model), String(model)).toBe("corvin mallow");
  });

  it.each(registers("now one for Rowan Pell"))("%s → Rowan Pell when the model reads Rowan Pell (positive control)", (text) => {
    expect(employeeAfter(text, "Rowan Pell")).toBe("rowan pell");
  });

  it.each(registers("one for Rowan Pell, not Corvin Mallow"))("%s → Rowan Pell, whoever the model copies", (text) => {
    for (const model of MODEL) expect(employeeAfter(text, model), String(model)).toBe("rowan pell");
  });
});

// Flag off: as on main, pinned (model Rowan Pell, model Corvin Mallow, no model reading).
describe("NEGATED_PERSON_NO_CARD_ENABLED off: as on main", () => {
  it.each([
    ["never one for rowan pell", "rowan pell", "corvin mallow", "corvin mallow"],
    ["Never one for Rowan Pell", "rowan pell", "corvin mallow", "rowan pell"],
    ["NEVER ONE FOR ROWAN PELL", "rowan pell", "corvin mallow", "corvin mallow"],
    ["do not make one for rowan pell", "rowan pell", "corvin mallow", "corvin mallow"],
    ["Do not make one for Rowan Pell", "rowan pell", "corvin mallow", "rowan pell"],
    ["DO NOT MAKE ONE FOR ROWAN PELL", "rowan pell", "corvin mallow", "corvin mallow"],
    ["no, not for rowan pell, for corvin mallow", "rowan pell", "corvin mallow", "corvin mallow"],
    ["No, not for Rowan Pell, for Corvin Mallow", "rowan pell", "corvin mallow", "rowan pell"],
    ["NO, NOT FOR ROWAN PELL, FOR CORVIN MALLOW", "rowan pell", "corvin mallow", "corvin mallow"],
    ["now one for rowan pell", "rowan pell", "corvin mallow", "corvin mallow"],
    ["Now one for Rowan Pell", "rowan pell", "corvin mallow", "rowan pell"],
    ["NOW ONE FOR ROWAN PELL", "rowan pell", "corvin mallow", "corvin mallow"],
    ["one for rowan pell, not corvin mallow", "rowan pell", "corvin mallow", "corvin mallow"],
    ["One for Rowan Pell, not Corvin Mallow", "rowan pell", "corvin mallow", "rowan pell"],
    ["ONE FOR ROWAN PELL, NOT CORVIN MALLOW", "rowan pell", "corvin mallow", "not corvin mallow"],
  ])("%s → %s / %s / %s", (text, ...expected) => {
    expect(MODEL.map((model) => employeeAfter(text, model))).toEqual(expected);
  });
});
