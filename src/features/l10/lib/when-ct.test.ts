import { describe, expect, it } from "vitest";

import { formatCentral } from "./when";

// Port from the Leadership Hub (Glowbrands1/leadership-hub#106): the owner (18 Nov 2026) wants every time in CT, and the
// meeting history / past-meeting labels said "CST" or "CDT" while the chat timestamps said "CT".
describe("formatCentral", () => {
  it("always labels the time CT, in summer and in winter", () => {
    expect(formatCentral("2026-10-26T20:00:00Z")).toBe("Mon, Oct 26, 2026, 3:00 PM CT");
    expect(formatCentral("2026-11-18T12:45:00Z")).toBe("Wed, Nov 18, 2026, 6:45 AM CT");
  });
});
