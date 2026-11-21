import { describe, expect, it } from "vitest";

import { cardPolicyHeading } from "./card-policy";
import { readersLineBox, withoutReadersLineBox, withReadersLineBox } from "./readers-line-headings";

/* Runner 2's c259 (QA2, 21 Nov 2026, option (a)); QA f071. */
describe("headings saved under another box", () => {
  it("names Time Records' box on the card's line, and nothing else", () => {
    expect(readersLineBox("Time Records")).toBe("Standards of Conduct");
    expect(withReadersLineBox("Time Records Policy, JBA Policy Manual p.36", "Time Records")).toBe("Standards of Conduct — Time Records, JBA Policy Manual p.36");
    expect(withReadersLineBox("Late Opening Policy, JBA Policy Manual p.15", "Late Opening")).toBe("Late Opening Policy, JBA Policy Manual p.15");
  });

  it("reads the heading back from the card's line, so Create still quotes Time Records", () => {
    expect(withoutReadersLineBox("Standards of Conduct — Time Records, JBA Policy Manual p.36")).toBe("Time Records, JBA Policy Manual p.36");
    expect(cardPolicyHeading("**Policy:** Standards of Conduct — Time Records, JBA Policy Manual p.36")).toBe("Time Records");
    expect(cardPolicyHeading("**Policy:** Standards of Conduct Policy, JBA Policy Manual p.12")).toBe("Standards of Conduct");
  });
});
