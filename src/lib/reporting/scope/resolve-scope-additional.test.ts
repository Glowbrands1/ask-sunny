import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessScope } from "@/types";

/**
 * The DATA-BACKED resolver (`resolveScopeFor`) — the one reports, chat and
 * Sales Totals actually use for district and region accounts — honours an
 * explicitly assigned salon, and still fails closed for the AREAS.
 */

let areaAnswer: string[] = [];
let areaQueryFails = false;
const asked: { level: string; ids: readonly string[] }[] = [];

vi.mock("./reporting-areas", () => ({
  areaSalonNumbersFromReporting: async (level: string, ids: readonly string[]) => {
    asked.push({ level, ids });
    return areaQueryFails ? [] : areaAnswer;
  },
}));
vi.mock("@/lib/auth/page", () => ({ pageIdentity: async () => null }));

const { resolveScopeFor } = await import("./server");

beforeEach(() => {
  areaAnswer = [];
  areaQueryFails = false;
  asked.length = 0;
});

describe("resolveScopeFor with additional locations", () => {
  it("a district manager's explicit salon is added to the district's salons", async () => {
    areaAnswer = ["0313", "0314"];
    const scope: AccessScope = {
      level: "district",
      primaryAreaId: "dist-cotton-sarah",
      alsoCoversAreaIds: ["loc-0394"],
    };
    const resolved = await resolveScopeFor(scope);
    expect(resolved.unrestricted).toBe(false);
    expect([...resolved.salonNumbers]).toEqual(["0313", "0314", "0394"]);
  });

  it("only AREA ids are sent to reporting; salon ids never are", async () => {
    await resolveScopeFor({
      level: "region",
      primaryAreaId: "reg-patterson-madeline",
      alsoCoversAreaIds: ["loc-0394", "dist-dugan-rachael"],
    });
    expect(asked).toEqual([
      { level: "region", ids: ["reg-patterson-madeline", "dist-dugan-rachael"] },
    ]);
  });

  it("when the area query fails, the areas fail closed but a named salon still holds", async () => {
    areaQueryFails = true;
    const resolved = await resolveScopeFor({
      level: "district",
      primaryAreaId: "dist-cotton-sarah",
      alsoCoversAreaIds: ["loc-0394"],
    });
    expect([...resolved.salonNumbers]).toEqual(["0394"]);
    expect(resolved.unrestricted).toBe(false);
  });

  it("with no additional locations the result is exactly the areas, unchanged", async () => {
    areaAnswer = ["0313"];
    const resolved = await resolveScopeFor({
      level: "district",
      primaryAreaId: "dist-cotton-sarah",
      alsoCoversAreaIds: [],
    });
    expect([...resolved.salonNumbers]).toEqual(["0313"]);
  });

  it("an empty area answer with no extras is an empty allowlist, never unrestricted", async () => {
    const resolved = await resolveScopeFor({
      level: "district",
      primaryAreaId: "dist-gone",
      alsoCoversAreaIds: [],
    });
    expect(resolved.unrestricted).toBe(false);
    expect([...resolved.salonNumbers]).toEqual([]);
  });

  it("a global scope stays unrestricted and never asks reporting", async () => {
    const resolved = await resolveScopeFor({ level: "global", primaryAreaId: null, alsoCoversAreaIds: ["loc-0394"] });
    expect(resolved.unrestricted).toBe(true);
    expect(asked).toEqual([]);
  });

  it("a salon scope resolves without a round trip", async () => {
    const resolved = await resolveScopeFor({
      level: "salon",
      primaryAreaId: "loc-0306",
      alsoCoversAreaIds: ["loc-0394", "loc-0468"],
    });
    expect([...resolved.salonNumbers]).toEqual(["0306", "0394", "0468"]);
    expect(asked).toEqual([]);
  });
});
