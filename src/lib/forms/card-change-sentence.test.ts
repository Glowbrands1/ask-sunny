import { describe, expect, it } from "vitest";

import { cardChangeSentence, managerDate } from "./card-change-sentence";

const CARD = { formDate: "2026-10-20", warningLevel: null, payrollDeduct: null, locationName: "Kearney", employeeRole: null };

describe("cardChangeSentence", () => {
  it("says each field alone", () => {
    expect(cardChangeSentence({ formDate: "2026-10-19" }, CARD, "Salon")).toBe("Change the date to 10/19/2026.");
    expect(cardChangeSentence({ warningLevel: "written" }, CARD, "Salon")).toBe("Change: This is a written warning.");
    expect(cardChangeSentence({ payrollDeduct: "no" }, CARD, "Salon")).toBe("Change: Payroll deduct no.");
    expect(cardChangeSentence({ locationName: "Lawrence" }, CARD, "Salon")).toBe("Change: Salon: Lawrence.");
    expect(cardChangeSentence({ employeeRole: "Salon Director" }, CARD, "Salon")).toBe("Change: Job title: Salon Director.");
  });

  it("says several fields in one turn, the date first", () => {
    expect(
      cardChangeSentence({ formDate: "2026-10-19", warningLevel: "written", payrollDeduct: "yes", employeeRole: "Salon Director" }, CARD, "Salon"),
    ).toBe("Change the date to 10/19/2026. This is a written warning. Payroll deduct yes. Job title: Salon Director.");
  });

  it("says nothing for a field that did not change, and null when nothing did", () => {
    expect(cardChangeSentence({ formDate: "2026-10-20", locationName: "kearney" }, CARD, "Salon")).toBeNull();
    expect(cardChangeSentence({}, CARD, "Salon")).toBeNull();
  });

  it("sends nothing for a date that is not a real day", () => {
    expect(cardChangeSentence({ formDate: "2026-02-30", warningLevel: "written" }, CARD, "Salon")).toBeNull();
    expect(cardChangeSentence({ formDate: "10/19/2026" }, CARD, "Salon")).toBeNull();
  });
});

describe("managerDate", () => {
  it("writes the date the way the readers read it", () => {
    expect(managerDate("2026-10-19")).toBe("10/19/2026");
    expect(managerDate("2026-02-29")).toBeNull();
  });
});
