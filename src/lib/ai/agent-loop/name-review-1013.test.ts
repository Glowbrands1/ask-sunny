import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { installPreferredAliases, withPreferredNameShown } from "@/lib/forms/preferred-name-shown";
import type { AskResponse } from "@/lib/ai/types";

const { nameAsSaid, sameRosterPerson } = await import("./tools");

/**
 * QA's review of #1013 @ef62a035 (15 Nov 2026), in both paths. Invented names.
 * 1. A saved name is never another roster person's: Lorraine Fairweather (preferred Rae) and a separate legal Rae
 *    Fairweather — "write up rae fairweather" with Lorraine seated keeps "Lorraine Fairweather", no "(… in Woven)".
 * 2. Flag off is main, byte for byte: the loop's sameRosterPerson and nameAsSaid answer as main did.
 */
const LORRAINE = { id: "lf", firstName: "Lorraine", lastName: "Fairweather", preferredFirstName: "Rae" };
const RAE = { id: "rf", firstName: "Rae", lastName: "Fairweather", preferredFirstName: null };
const THOMAS = { id: "tb", firstName: "Thomas", lastName: "Beck", preferredFirstName: "Tom" };

afterEach(() => {
  installPreferredAliases(() => undefined);
  vi.unstubAllEnvs();
});

describe("1: a preferred name that is another roster person's name is never used (READABLE_NAMES_ENABLED)", () => {
  beforeEach(() => vi.stubEnv("READABLE_NAMES_ENABLED", "true"));

  it("the agent loop keeps the legal name", () => {
    expect(nameAsSaid(LORRAINE, "write up rae fairweather for being late", [LORRAINE, RAE])).toBe("Lorraine Fairweather");
    // With no other Rae on the roster, the preferred name is the manager's, as before.
    expect(nameAsSaid(LORRAINE, "write up rae fairweather for being late", [LORRAINE])).toBe("Rae Fairweather");
  });

  it("today's path keeps the legal name, with no swap", () => {
    installPreferredAliases(() => [
      { id: "lf", legal: "Lorraine Fairweather", preferred: "Rae Fairweather" },
      { id: "rf", legal: "Rae Fairweather", preferred: "Rae Fairweather" },
    ]);
    const card = { content: "For **Lorraine Fairweather**.", formProposal: { employeeName: "Lorraine Fairweather" } } as unknown as AskResponse;
    const out = withPreferredNameShown(card, "write up rae fairweather for being late");
    expect(out.formProposal?.employeeName).toBe("Lorraine Fairweather");
    expect(out.content).not.toContain("in Woven)");
  });
});

describe("2: flag off, the loop's helpers answer as main did", () => {
  it.each([
    ["Tom", "Thomas Beck", [THOMAS]],
    ["Rae", "Lorraine Fairweather", [LORRAINE]],
    ["Thomas J. Beck", "Tom Beck", [THOMAS]],
  ] as const)("sameRosterPerson(%s, %s) is true, as on main", (a, b, roster) => {
    expect(sameRosterPerson(a, b, roster)).toBe(true);
  });

  it("nameAsSaid is main's: the preferred name, whatever else is on the roster", () => {
    expect(nameAsSaid(LORRAINE, "write up rae fairweather", [LORRAINE, RAE])).toBe("Rae Fairweather");
  });
});
