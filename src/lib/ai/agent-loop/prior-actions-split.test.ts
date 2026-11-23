import { describe, expect, it } from "vitest";

import { priorActionsSplit } from "./tools";

/* QA's round 2 (22 Nov 2026, U09; found in Ask Bubbles): "JBA Policy Manual 1-1-2026, Verbal CA 11-1-2026. On 11-1-26 <P> violated …". */
const SAID = "JBA Policy Manual 1-1-2026, Verbal CA 11-1-2026. On 11-1-26 Remy Calder violated care and cleaning of facilities policy";

describe("priorActionsSplit (U09)", () => {
  it("keeps the good step and leaves off only the one dated the incident's day", () => {
    const split = priorActionsSplit("JBA Policy Manual — 01/01/2026; Verbal CA — 11/01/2026", SAID, "2026-11-01");
    expect(split.kept).toBe("JBA Policy Manual — 01/01/2026");
    expect(split.dropped.map((entry) => entry.step)).toEqual(["Verbal CA — 11/01/2026"]);
  });

  it("a list with no problem is kept whole; a list with no good step is refused whole", () => {
    expect(priorActionsSplit("JBA Policy Manual — 01/01/2026", SAID, "2026-11-01")).toMatchObject({ kept: "JBA Policy Manual — 01/01/2026", dropped: [] });
    expect(priorActionsSplit("Verbal CA — 11/01/2026", SAID, "2026-11-01").kept).toBeNull();
  });
});
