import { describe, expect, it } from "vitest";

import { withoutUnaskedAccountWipes } from "./account-wipe-guard";
import type { FormPatch } from "./form-reducer";

/**
 * ACCOUNT_WIPE_GUARD_ENABLED. Ported from the sibling app (QA, a manager's 1★ rating there, 5–6 Nov 2026): on a reopened Coaching Form, "this is a verbal
 * warning. previous coaching policy manual 10-15-26" wiped Details of Coaching. The person is invented.
 */
const SAID = "this is a verbal warning. previous coaching policy manual 10-15-26";
const LABELS = { coaching_details: "Details of Coaching", observation: "Observation of Offense", form_date: "Date" };
const CURRENT = { coaching_details: "Odalys Penwarden left the register drawer open on 10/15/26.", observation: "Observed: the drawer was open." };
const clear = (field: string): FormPatch => ({ set: {}, clear: [field], evidence: { [field]: SAID } });
const replace = (field: string, value: string, how: "replace" | "add" = "replace"): FormPatch => ({ set: { [field]: value }, clear: [], how: { [field]: how }, evidence: { [field]: value } });
const guard = (patch: FormPatch, latest = SAID, current: Record<string, unknown> = CURRENT) => withoutUnaskedAccountWipes(patch, { latest, labels: LABELS, current });

describe("withoutUnaskedAccountWipes", () => {
  it("the manager's turn never clears or replaces the Details", () => {
    expect(guard(clear("coaching_details")).patch).toMatchObject({ set: {}, clear: [] });
    expect(guard(clear("coaching_details")).kept).toEqual(["coaching_details"]);
    expect(guard(replace("coaching_details", "This is a verbal warning.")).patch.set).toEqual({});
    expect(guard(clear("observation")).patch.clear).toEqual([]);
  });

  it("an add, another field, or an empty account field: as before", () => {
    expect(guard(replace("coaching_details", "Verbal warning given.", "add")).patch.set).toEqual({ coaching_details: "Verbal warning given." });
    expect(guard(clear("form_date")).patch.clear).toEqual(["form_date"]);
    expect(guard(replace("coaching_details", "This is a verbal warning."), SAID, {}).patch.set).toEqual({ coaching_details: "This is a verbal warning." });
  });

  it("asked in so many words, or the field named: written", () => {
    expect(guard(clear("coaching_details"), "remove the details").patch.clear).toEqual(["coaching_details"]);
    expect(guard(replace("coaching_details", "x"), "replace the details of coaching with x").patch.set).toEqual({ coaching_details: "x" });
    expect(guard(replace("coaching_details", "x"), "Details of Coaching should say x").patch.set).toEqual({ coaching_details: "x" });
    expect(guard(clear("observation"), "clear the observation").patch.clear).toEqual(["observation"]);
  });
});

describe("what the guard lets through (QA's gate, 10 Nov 2026)", () => {
  it("a made-about turn, a correction, or a replace that keeps the account", () => {
    expect(guard(replace("coaching_details", "Thaddeus showed up late."), "I need you to make it about showing up late and please list the policy make the date for 10/14/26.").patch.set).toEqual({ coaching_details: "Thaddeus showed up late." });
    expect(guard(replace("coaching_details", "Perrin missed the monthly meeting."), "can you make it for missing out monthly meeting").patch.set).toEqual({ coaching_details: "Perrin missed the monthly meeting." });
    expect(guard(replace("coaching_details", "Odalys Pembrooke left the register drawer open on 10/15/26."), "fix her last name, it is Pembrooke").patch.set).toEqual({ coaching_details: "Odalys Pembrooke left the register drawer open on 10/15/26." });
    expect(guard(replace("coaching_details", "Odalys Penwarden-Hale left the register drawer open on 10/15/26."), "she goes by Penwarden-Hale now").patch.set).toEqual({ coaching_details: "Odalys Penwarden-Hale left the register drawer open on 10/15/26." });
  });

  it("the manager's turn still never clears, or replaces with words that drop the account", () => {
    expect(guard(clear("coaching_details")).patch.clear).toEqual([]);
    expect(guard(replace("coaching_details", "This is a verbal warning.")).patch.set).toEqual({});
  });
});
