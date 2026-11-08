import { afterEach, describe, expect, it, vi } from "vitest";

import { correctedIncidentDate } from "./corrected-incident-date";

/** QA's round-5 trace of corrective-action-conversation-qa Q6 (8 Nov 2026); the manager's words, an invented person. */
const REQUEST = "create a CA for tess varga for not attending the monthly meeting on 10-20-26. previous coaching: jba policy manual 1-1-26, verbal ca 9-1-26";
const TODAY = "2026-10-21";

afterEach(() => vi.unstubAllEnvs());

describe("CORRECTED_DATE_KEPT", () => {
  it("off: nothing (the report)", () => {
    expect(correctedIncidentDate([REQUEST, "the meeting was actually on 10-19-26"], ["2026-10-19", "2026-10-20"], TODAY)).toBeNull();
  });

  it("on: the incident date the manager corrected to, also after a prior step's correction", () => {
    vi.stubEnv("CORRECTED_DATE_KEPT_ENABLED", "true");
    const turns = [REQUEST, "actually make it verbal", "the meeting was actually on 10-19-26"];
    expect(correctedIncidentDate(turns, ["2026-10-19", "2026-10-20"], TODAY)).toBe("2026-10-19");
    expect(correctedIncidentDate([...turns, "sorry, the verbal ca was on 9-2-26 not 9-1-26"], ["2026-09-02", "2026-10-19", "2026-10-20"], TODAY)).toBe("2026-10-19");
  });

  it("on: a corrected prior step's date is never the form's", () => {
    vi.stubEnv("CORRECTED_DATE_KEPT_ENABLED", "true");
    expect(correctedIncidentDate([REQUEST, "sorry, the verbal ca was on 9-2-26 not 9-1-26"], ["2026-09-02", "2026-10-20"], TODAY)).toBeNull();
  });

  it("on: no correction, or one date only: nothing", () => {
    vi.stubEnv("CORRECTED_DATE_KEPT_ENABLED", "true");
    expect(correctedIncidentDate(["create a CA for tess varga, she was late on 10/19/26 and again on 10/20/26"], ["2026-10-19", "2026-10-20"], TODAY)).toBeNull();
    expect(correctedIncidentDate([REQUEST, "the meeting was actually on 10-19-26"], ["2026-10-19"], TODAY)).toBeNull();
  });
});
