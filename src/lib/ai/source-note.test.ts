import { afterEach, describe, expect, it, vi } from "vitest";

import { withoutSourceNotes } from "./source-note";

/* QA, 5 Nov 2026 (item 9): a reply leaked the model's note about a source. QA's exact wording (reported in the sibling app; its "store" is this app's "salon"). */
const LEAK = "[S1 doesn't actually cover general tardiness — it only covers failing to open the salon…]";

afterEach(() => vi.unstubAllEnvs());
const on = () => vi.stubEnv("SOURCE_NOTE_GUARD_ENABLED", "true");

describe("SOURCE_NOTE_GUARD_ENABLED: a bracketed note about a source is removed", () => {
  it("off: the text is returned as it is (the defect)", () => {
    vi.stubEnv("SOURCE_NOTE_GUARD_ENABLED", "");
    const text = `Late arrivals are handled under the Attendance Policy. ${LEAK}`;
    expect(withoutSourceNotes(text)).toBe(text);
  });

  it("on: QA's leaked note is removed, the sentence before it stays", () => {
    on();
    expect(withoutSourceNotes(`Late arrivals are handled under the Attendance Policy. ${LEAK}`)).toBe(
      "Late arrivals are handled under the Attendance Policy.",
    );
  });

  it("on: the note on its own line goes with its line; the paragraphs around it stay", () => {
    on();
    expect(withoutSourceNotes(`Opening late is covered by the Late Opening Policy [S1].\n\n${LEAK}\n\nTell me if you want a Corrective Action.`)).toBe(
      "Opening late is covered by the Late Opening Policy [S1].\n\nTell me if you want a Corrective Action.",
    );
  });

  it("on: citations are kept for the marker stripping (bare, grouped, with a page or section)", () => {
    on();
    for (const text of [
      "Clock in on time [S1].",
      "Clock in on time [S1][S2].",
      "Clock in on time [S1, S2].",
      "Clock in on time [S1 and S3].",
      "Clock in on time [S1 p.14].",
      "Clock in on time [S2, §3.1].",
    ]) {
      expect(withoutSourceNotes(text), text).toBe(text);
    }
  });

  it("on: a bracket that is not a source tag is untouched", () => {
    on();
    const text = "Fill in [Employee] and [Date] on the form. [Salon 12 opens at 9]";
    expect(withoutSourceNotes(text)).toBe(text);
  });
});

describe("SOURCE_NOTE_GUARD_ENABLED: bare markers on every path (QA's live Sunny tester, 6 Nov 2026)", () => {
  const LIVE_1 = "All cash discrepancies need to be documented and reported to your District Manager [S46].";
  const LIVE_2 = "Future policy violations may result in additional corrective action up to and including termination [S1].";

  it("off: the reply keeps the markers (the live leak)", async () => {
    const { withoutSourceMarkers } = await import("./source-note");
    expect(withoutSourceMarkers(LIVE_1)).toBe(LIVE_1);
  });

  it("on: the two live sentences lose their markers, and keep their full stop", async () => {
    vi.stubEnv("SOURCE_NOTE_GUARD_ENABLED", "true");
    const { withoutSourceMarkers } = await import("./source-note");
    expect(withoutSourceMarkers(LIVE_1)).toBe("All cash discrepancies need to be documented and reported to your District Manager.");
    expect(withoutSourceMarkers(LIVE_2)).toBe("Future policy violations may result in additional corrective action up to and including termination.");
    expect(withoutSourceMarkers("Clock in on time [S12, S14], every shift.")).toBe("Clock in on time, every shift.");
  });

  it("on, negative: a page citation and other brackets are left alone", async () => {
    vi.stubEnv("SOURCE_NOTE_GUARD_ENABLED", "true");
    const { withoutSourceMarkers } = await import("./source-note");
    expect(withoutSourceMarkers("See the Late Opening Policy [S1 p.14].")).toBe("See the Late Opening Policy [S1 p.14].");
    expect(withoutSourceMarkers("Hi [Employee], [Salon 12 opens at 9].")).toBe("Hi [Employee], [Salon 12 opens at 9].");
  });
});

