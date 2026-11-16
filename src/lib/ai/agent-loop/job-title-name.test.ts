import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { setAppConfigForTests, SUNNY_CONFIG } from "./app-config";
import { withoutJobTitle } from "./tools";

/** QA (16 Nov 2026, the 266 re-run's c220/c224): a job title typed beside a name is not part of it; titles come from the config. */
afterEach(() => setAppConfigForTests());

describe("withoutJobTitle", () => {
  it("takes the company's title off the start or end of a typed name", () => {
    expect(withoutJobTitle("TC Odessa Vantreight")).toBe("Odessa Vantreight");
    expect(withoutJobTitle("Quillon Ashgrove TC")).toBe("Quillon Ashgrove");
    expect(withoutJobTitle("Tanning Consultant, Quillon Ashbrove")).toBe("Quillon Ashbrove");
    expect(withoutJobTitle("  asd   Juno Paxton ")).toBe("Juno Paxton");
  });

  it("leaves a name with no title, and never empties a name", () => {
    expect(withoutJobTitle("Remy Calder")).toBe("Remy Calder");
    expect(withoutJobTitle("TC")).toBe("TC");
    expect(withoutJobTitle("Tc Reynolds")).toBe("Reynolds");
  });

  it("uses the app's own titles: another company's config strips its titles and not Sunny's", () => {
    setAppConfigForTests({ ...SUNNY_CONFIG, jobTitles: [/\b(?:barista)\b/i] });
    expect(withoutJobTitle("Barista Odessa Vantreight")).toBe("Odessa Vantreight");
    expect(withoutJobTitle("TC Odessa Vantreight")).toBe("TC Odessa Vantreight");
  });
});
