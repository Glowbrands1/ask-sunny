import { afterEach, describe, expect, it, vi } from "vitest";

import type { AccessScope } from "@/types";

import { proposeLocation } from "./location-scope";

/*
 * QA's Sunny gate, 6 Nov 2026 (sf-s28): "can you write me a ca for Thessaly Brandt from o street"
 * from a salon director whose only salon is Kearney. "from" was no place cue, so O Street was not
 * read; with CA_SALES on the card silently took Kearney. PLACE_FROM_CUE_ENABLED: "a CA for <name>
 * from <salon>" names the salon. Every person is invented.
 */
const KEARNEY: AccessScope = { level: "salon", primaryAreaId: "loc-0309", alsoCoversAreaIds: [] };
const S28 = "can i give a ca for not signing off on the cleaning check list\n\ncan you write me a ca for Thessaly Brandt from o street";
const at = (text: string) => proposeLocation(KEARNEY, text, ["loc-0309"]);

afterEach(() => vi.unstubAllEnvs());
const on = () => vi.stubEnv("PLACE_FROM_CUE_ENABLED", "true");

describe("PLACE_FROM_CUE_ENABLED: \"a CA for <name> from <salon>\" names the salon", () => {
  it("off: sf-s28's O Street is not read, so the card takes Kearney (the gate's finding)", () => {
    expect(at(S28)).toEqual({ resolution: "resolved", locationId: "loc-0309" });
  });

  it("on: sf-s28 asks which salon, naming O Street as outside the assignment", () => {
    on();
    expect(at(S28)).toMatchObject({ resolution: "needs_selection", authorizedIds: ["loc-0309"], outOfScopeName: "NE Lincoln O Street" });
  });

  it("on: the manager's own salon named that way resolves to it", () => {
    on();
    expect(at("i need a ca for Thessaly Brandt from kearney, she was late opening")).toEqual({ resolution: "resolved", locationId: "loc-0309" });
  });

  it.each([
    "create a corrective action for Thessaly Brandt, she transferred from o street last month, she was late opening",
    "create a corrective action for Thessaly Brandt, she got a call from the salon and left early",
    "create a corrective action for Thessaly Brandt, late every day from 10/5",
    "create a corrective action for Thessaly Brandt, a complaint from a guest about her attitude",
    "create a corrective action for Thessaly Brandt, she ignored a direction from the district manager",
  ])("on, negative: %s keeps the employee's salon (no out-of-scope question)", (text) => {
    on();
    expect(at(text)).toEqual({ resolution: "resolved", locationId: "loc-0309" });
  });
});
