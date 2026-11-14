import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { cardClaims, cardMismatch } = await import("./run");

/* The self-review (QA's urgent regression, 14 Nov 2026): what a reply says the card holds, against the card. */
describe("what a reply says the card holds", () => {
  it("reads the read-backs the rules book teaches", () => {
    expect(cardClaims("**Type of Warning:** Written Warning, as you said.")).toEqual({ warningLevel: "written" });
    expect(cardClaims("**Is payroll deduct applicable?** Yes, as you said. **Payroll deduction amount:** $20.")).toEqual({ payrollDeduct: "yes", payrollAmount: "20" });
    expect(cardClaims("**Policy:** Attendance Policy, JBA Policy Manual p.14")).toEqual({ policy: "Attendance Policy, JBA Policy Manual p.14" });
    expect(cardClaims("Dated 11/4 (when it happened); say if you want 11/6.")).toEqual({ date: "11/4" });
  });
  it("reads nothing from a reply that states no card field", () => {
    expect(cardClaims("The Attendance policy covers lateness. What happened?")).toEqual({});
  });
});

describe("a stated field the card does not hold", () => {
  const card = { warningLevel: "written", payrollDeduct: "yes", payrollDeductAmount: "20", policyLine: "Other — the 10-minute sanitation", formDate: "2026-11-04" } as never;
  it("matches the card it describes", () => {
    expect(cardMismatch({ warningLevel: "written", payrollDeduct: "yes", payrollAmount: "20", policy: "Other — 10-minute sanitation", date: "11/4" }, card)).toEqual([]);
  });
  it("names each field that differs", () => {
    expect(cardMismatch({ warningLevel: "verbal", payrollAmount: "25", date: "11/5" }, card)).toEqual(["warning level (verbal)", "payroll amount ($25)", "date (11/5)"]);
  });
  it("a Policy line is the card's whole line, not its heading alone (batch E, E6)", () => {
    const attendance = { policyLine: "Attendance Policy, JBA Policy Manual p.14" } as never;
    expect(cardMismatch({ policy: "Attendance" }, attendance)).toEqual(["policy (Attendance)"]);
    expect(cardMismatch({ policy: "Attendance Policy (JBA Policy Manual, p.14)" }, attendance)).toEqual([]);
  });
  it("with no card this turn, every stated field differs from the card on screen", () => {
    expect(cardMismatch({ warningLevel: "written" }, null)).toEqual(["warning level (written)"]);
  });
});
