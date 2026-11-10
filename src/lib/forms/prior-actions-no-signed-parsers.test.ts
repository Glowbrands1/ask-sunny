import { afterEach, describe, expect, it, vi } from "vitest";

import { readCaDateEdit } from "./ca-chat-dates";
import { priorLineKey, uniteLines } from "./form-reducer";
import { priorLineDate, withPriorLineDate } from "./prior-actions";

/*
 * PRIOR_ACTIONS_NO_SIGNED_ENABLED (QA, a location manager's chat in the sibling app, 5 Nov 2026):
 * a Prior actions line now ends "— finalized <date>" (a form on file) or
 * "— <date>" (a step the manager told), "— signed <date>" only when they said
 * so. Every reader of the list's lines reads all three: de-duplication and
 * date corrections work whichever a line has.
 */
const TODAY = "2026-11-05";

afterEach(() => vi.unstubAllEnvs());
const on = () => vi.stubEnv("PRIOR_ACTIONS_NO_SIGNED_ENABLED", "true");

describe("a line's date, whatever marks it", () => {
  it("reads signed, finalized and plain dates", () => {
    expect(priorLineDate("Coaching — signed 09/02/2026")).toBe("09/02/2026");
    expect(priorLineDate("Coaching — finalized 09/02/2026")).toBe("09/02/2026");
    expect(priorLineDate("Coaching — JBA Policy Manual — 09/02/2026")).toBe("09/02/2026");
    expect(priorLineDate("Coaching on attendance (date not given)")).toBe("");
  });

  it("moves the date and keeps the mark", () => {
    expect(withPriorLineDate("Coaching — signed 09/02/2026", "09/03/2026")).toBe("Coaching — signed 09/03/2026");
    expect(withPriorLineDate("Coaching — finalized 09/02/2026", "09/03/2026")).toBe("Coaching — finalized 09/03/2026");
    expect(withPriorLineDate("Coaching — JBA Policy Manual — 09/02/2026", "09/03/2026")).toBe("Coaching — JBA Policy Manual — 09/03/2026");
  });
});

describe("form-reducer: de-duplication across formats", () => {
  it("on: a signed, a finalized and a plain line of one step and date are one line", () => {
    on();
    expect(priorLineKey("Coaching — signed 09/02/2026")).toBe(priorLineKey("Coaching — 09/02/2026"));
    expect(priorLineKey("Coaching — finalized 09/02/2026")).toBe(priorLineKey("Coaching — 09/02/2026"));
    expect(priorLineKey("Coaching — 09/02/2026")).not.toBe(priorLineKey("Coaching — 09/03/2026"));
    expect(uniteLines("Coaching — finalized 09/02/2026", "Coaching — 09/02/2026")).toBe("Coaching — finalized 09/02/2026");
    expect(uniteLines("Coaching — 09/02/2026", "Verbal warning — 09/21/2026")).toBe("Coaching — 09/02/2026\nVerbal warning — 09/21/2026");
  });

  it("off: as before — only \" — signed \" carries a date", () => {
    expect(priorLineKey("Coaching — signed 09/02/2026")).toBe("coaching|09/02/2026");
    expect(priorLineKey("Coaching — 09/02/2026")).toBe("coaching|");
  });
});

describe("ca-chat-dates: \"9/3, not 9/2\" corrects a line in either format", () => {
  for (const line of ["Coaching — signed 09/02/2026", "Coaching — finalized 09/02/2026", "Coaching — JBA Policy Manual — 09/02/2026"]) {
    it(`on: ${line}`, () => {
      on();
      const edit = readCaDateEdit({
        text: "the previous coaching was 9/3/26, not 9/2/26",
        today: TODAY,
        form: { formDate: "2026-11-03", observation: "", priorActions: line },
      });
      expect(edit).toMatchObject({ kind: "prior", value: line.replace("09/02/2026", "09/03/2026") });
    });
  }

  it("off: a line without \"signed\" is left as it was (as before)", () => {
    const edit = readCaDateEdit({
      text: "the previous coaching was 9/3/26, not 9/2/26",
      today: TODAY,
      form: { formDate: "2026-11-03", observation: "", priorActions: "Coaching — JBA Policy Manual — 09/02/2026" },
    });
    expect(edit).toMatchObject({ kind: "prior", value: "Coaching — JBA Policy Manual — 09/02/2026" });
  });
});
