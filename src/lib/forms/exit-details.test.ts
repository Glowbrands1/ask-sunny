import { describe, expect, it } from "vitest";

import { JOIN } from "./bounded-context";
import {
  EXIT_CORRECTABLE_KEYS,
  EXIT_STATED_KEYS,
  exitCorrectionValues,
  exitDetailValues,
  exitDetailsSupplied,
  readExitDetails,
} from "./exit-details";

/**
 * ============================================================================
 * HR'S DETAILS LINES, READ FROM THE MANAGER'S OWN WORDS
 * ============================================================================
 *
 * Clear or nothing: every answer below is one a manager actually typed, and
 * every "undefined" is a question Sunny must ask rather than answer.
 */

// A Monday, as in the rest of the exit suite.
const TODAY = "2026-09-28";
const read = (text: string) => readExitDetails(text, TODAY);
const answers = (text: string) => read(text).answers;

describe("returned items and the salon key", () => {
  it.each([
    ["She returned her store items but not her key.", { store_items_returned: "yes", salon_key_returned: "no" }],
    ["She returned her store items and her key.", { store_items_returned: "yes", salon_key_returned: "yes" }],
    ["She returned everything except the key.", { store_items_returned: "yes", salon_key_returned: "no" }],
    ["She returned everything.", { store_items_returned: "yes", salon_key_returned: "yes" }],
    ["She still has her key. She turned in her uniform.", { store_items_returned: "yes", salon_key_returned: "no" }],
    ["She dropped off her key on Monday", { salon_key_returned: "yes" }],
    ["The key was not returned and the items were returned.", { store_items_returned: "yes", salon_key_returned: "no" }],
    ["She didn't return her shirts or her key", { store_items_returned: "no", salon_key_returned: "no" }],
    ["All store items were returned", { store_items_returned: "yes" }],
    ["store items: no, key: yes", { store_items_returned: "no", salon_key_returned: "yes" }],
    ["store items yes, key no", { store_items_returned: "yes", salon_key_returned: "no" }],
    ["She walked off with her key", { salon_key_returned: "no" }],
  ])("%s", (text, expected) => {
    expect(answers(text)).toEqual(expected);
  });

  it("mentions of a key that say nothing about returning it answer nothing", () => {
    expect(answers("She was our key holder.")).toEqual({});
    expect(answers("The key thing is she was always late.")).toEqual({});
  });
});

describe("payroll deduction, minimum wage and the bonus", () => {
  it.each([
    ["Payroll deduction applies.", { payroll_deduction_applicable: "yes" }],
    ["payroll should deduct her uniform", { payroll_deduction_applicable: "yes" }],
    ["No payroll deduction.", { payroll_deduction_applicable: "no" }],
    ["Payroll deduction is not applicable", { payroll_deduction_applicable: "no" }],
    ["Drop her to minimum wage and she forfeits her bonus.", { dropped_to_minimum_wage: "yes", forfeit_bonus: "yes" }],
    ["She will be dropped to minimum wage and forfeit her bonus", { dropped_to_minimum_wage: "yes", forfeit_bonus: "yes" }],
    ["She won't be dropped to minimum wage or forfeit her bonus.", { dropped_to_minimum_wage: "no", forfeit_bonus: "no" }],
    ["She keeps her bonus.", { forfeit_bonus: "no" }],
    ["She loses her bonus.", { forfeit_bonus: "yes" }],
    ["She won't get her bonus.", { forfeit_bonus: "yes" }],
    ["min wage: no, bonus: yes", { dropped_to_minimum_wage: "no", forfeit_bonus: "yes" }],
  ])("%s", (text, expected) => {
    expect(answers(text)).toEqual(expected);
  });

  it("the key's $25 deduction never answers the general payroll deduction question", () => {
    expect(answers("She didn't return her key so she'll be deducted $25.")).toEqual({ salon_key_returned: "no" });
    expect(answers("She still has the key, deduct $25 from her check for it.")).toEqual({ salon_key_returned: "no" });
    expect(answers("Payroll deduct her $25 for the key.")).toEqual({});
    expect(answers("She kept the key, so she'll be deducted.")).toEqual({ salon_key_returned: "no" });
    // A deduction for something else in the same sentence is still an answer.
    expect(answers("She returned her keys, and payroll should deduct her uniform.")).toEqual({
      salon_key_returned: "yes",
      payroll_deduction_applicable: "yes",
    });
    // Said separately, it is still the manager's answer.
    expect(answers("She still has her key. Payroll deduction applies.")).toEqual({
      salon_key_returned: "no",
      payroll_deduction_applicable: "yes",
    });
  });

  it("naming the payroll department is not a deduction", () => {
    expect(answers("I'll notify payroll and HR today.")).toEqual({});
  });
});

describe("rehire", () => {
  it.each([
    ["She is not eligible for rehire.", "no"],
    ["She is eligible for rehire.", "yes"],
    ["I would rehire her.", "yes"],
    ["I would not rehire her.", "no"],
    ["Do not rehire.", "no"],
    ["She's ineligible for rehire", "no"],
    ["not rehirable", "no"],
    ["rehire: yes", "yes"],
  ])("%s -> %s", (text, expected) => {
    expect(answers(text).eligible_for_rehire).toBe(expected);
  });
});

describe("how they resigned", () => {
  it.each([
    ["She texted me that she quit.", "Text message"],
    ["She called me and quit over the phone.", "Phone call"],
    ["She emailed her resignation letter on 9/1.", "Email"],
    ["She told me in person.", "In person"],
    ["She was a no call no show Saturday and Sunday.", "No call/no show"],
    ["She walked out mid-shift.", "Walked out"],
    ["She left a voicemail saying she quit.", "Voicemail"],
    ["She texted me and then called.", "Text message and phone call"],
    // HR feedback 30 Sep 2026: the Colene exit form.
    ["On 9-15-26, she provided her resignation to management, sending the message via Woven.", "Woven message"],
    ["colene messaged management her resignation via woven.", "Woven message"],
    ["She sent the resignation via Woven.", "Woven message"],
    ["She messaged me on Woven that she was resigning.", "Woven message"],
    ["She sent a Woven message saying she quit.", "Woven message"],
  ])("%s -> %s", (text, method) => {
    expect(read(text).resignationMethod).toBe(method);
  });

  it("Woven named for anything but the channel is no method", () => {
    expect(read("She missed the Woven deadline twice.").resignationMethod).toBeNull();
    expect(read("Her training in Woven is still open.").resignationMethod).toBeNull();
  });

  it("does not read a method that was denied, or a sick call", () => {
    expect(read("She didn't text me, she just stopped coming.").resignationMethod).toBeNull();
    expect(read("She called in sick twice last week.").resignationMethod).toBeNull();
  });
});

describe("why they resigned", () => {
  it.each([
    ["She quit because she's moving to Denver, and her last day was 9/15.", "She's moving to Denver."],
    ["reason: new job at Target", "New job at Target."],
    ["She left for another job.", "Another job."],
    ["she quit to go back to school", "To go back to school."],
    ["She got a new job at the mall.", "She got a new job at the mall."],
    ["She didn't give a reason.", "No reason given."],
    ["No reason given.", "No reason given."],
  ])("%s -> %s", (text, reason) => {
    expect(read(text).resignationReason).toBe(reason);
  });

  /*
   * One fact per line, as a manager typed it in Production (2 Oct 2026). The
   * reason ends at its line; it used to run on into "Store items returned
   * payroll deduction does not apply eligible for rehire".
   */
  it("ends the reason at the end of its line", () => {
    const text = [
      "Kayla Koehn",
      "Tanning Consultant ",
      "NE Kearney",
      "Gave notice - fulfilled notice",
      "Gave notice 9/25/26 - date notice fulfilled 10/9/26",
      "Resigning to pursue other career options",
      "Store items returned payroll deduction does not apply eligible for rehire",
    ].join("\n");
    expect(read(text).resignationReason).toBe("To pursue other career options.");
    expect(read(text).answers.store_items_returned).toBe("yes");
  });

  it("a reason for something else is not a reason for leaving", () => {
    expect(read("She didn't return her key because she lost it.").resignationReason).toBeNull();
    expect(read("Why did she quit?").resignationReason).toBeNull();
  });
});

describe("the resignation date", () => {
  it("is a date tied to quitting, or the date notice was given", () => {
    expect(read("She quit on the spot 9/20.").resignationDate).toBe("2026-09-20");
    expect(read("She texted me on 9/20 that she quit.").resignationDate).toBe("2026-09-20");
    expect(read("She gave her two weeks notice on 9/1 and her last day was 9/15.").resignationDate).toBe(
      "2026-09-01",
    );
    expect(read("She was a no call no show yesterday.").resignationDate).toBe("2026-09-27");
  });

  it("is not a last day worked, and two different dates are left blank", () => {
    expect(read("Her last day was 9/15.").resignationDate).toBeNull();
    expect(read("She gave notice on 9/1, then quit on 9/10.").resignationDate).toBeNull();
  });
});

describe("clear or nothing, and the later turn wins", () => {
  it("a question answers nothing", () => {
    expect(exitDetailsSupplied(read("Is she eligible for rehire? Did she return her key?"))).toBe(false);
  });

  it("the same question answered both ways in one turn is an ambiguity", () => {
    const details = read("She returned the key and didn't return the key.");
    expect(details.answers.salon_key_returned).toBeUndefined();
    expect(details.ambiguities).toEqual([{ kind: "answer_conflict", key: "salon_key_returned" }]);
  });

  it("a later turn replaces an earlier answer, as a correction", () => {
    const details = read(["She returned her key and she is eligible for rehire.", "Actually she still has the key."].join(JOIN));
    expect(details.answers).toEqual({ salon_key_returned: "no", eligible_for_rehire: "yes" });
    expect(details.ambiguities).toEqual([]);
  });

  it("nothing said is nothing filled", () => {
    const details = read("Her last day was 9/15.");
    expect(exitDetailValues(details)).toEqual({ values: {}, checked: {} });
  });
});

describe("as form values", () => {
  it("are keyed the way the stored version keys them, under the exit allow-list", () => {
    const { values, checked } = exitDetailValues(
      read("She texted me on 9/20 that she quit because she's moving. She returned her items but not her key. Not eligible for rehire."),
    );
    expect(values).toEqual({
      resignation_date: "2026-09-20",
      resignation_method: "Text message",
      resignation_reason: "She's moving.",
    });
    expect(checked).toEqual({
      store_items_returned: ["yes"],
      salon_key_returned: ["no"],
      eligible_for_rehire: ["no"],
    });
    for (const key of [...Object.keys(values), ...Object.keys(checked)]) {
      expect(EXIT_STATED_KEYS.has(key), key).toBe(true);
    }
    expect(EXIT_STATED_KEYS.has("written_notice_attached")).toBe(false);
    expect(EXIT_STATED_KEYS.has("permanent_address")).toBe(false);
  });

  it("a correction replaces both separation boxes when it says how they left", () => {
    const correction = exitCorrectionValues("Actually she was a no call no show on 9/20.", TODAY)!;
    expect(correction.checked).toMatchObject({
      resignation_notice: [],
      resignation_type: ["no_call_no_show"],
    });
    expect(correction.values).toMatchObject({
      resignation_date: "2026-09-20",
      resignation_method: "No call/no show",
    });
    for (const key of [...Object.keys(correction.values), ...Object.keys(correction.checked)]) {
      expect(EXIT_CORRECTABLE_KEYS.has(key), key).toBe(true);
    }
  });

  it("a question, a request for information, or a turn with nothing in it, is not a correction", () => {
    expect(exitCorrectionValues("Did she return her key?", TODAY)).toBeNull();
    expect(exitCorrectionValues("is she eligible for rehire", TODAY)).toBeNull();
    expect(exitCorrectionValues("tell me the rehire policy for no call no shows", TODAY)).toBeNull();
    expect(exitCorrectionValues("What's our policy when a no call no show keeps the key", TODAY)).toBeNull();
    expect(exitCorrectionValues("thanks!", TODAY)).toBeNull();
  });
});
