import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { AskResponse } from "@/lib/ai/types";
import type { RosterEmployee } from "@/lib/forms/employee-match";
import type { ChatFormProposal } from "@/types";

import { copyOwnSalon } from "./same-form-copy";

/** COPY_OWN_SALON_ENABLED (QA's Sunny flip-9 live tester, 8 Nov 2026). Invented people. */
const person = (firstName: string, lastName: string, salonIds: string[]): RosterEmployee => ({ id: `e-${firstName}`, firstName, lastName, salonIds });
const ROSTER = [person("Orla", "Venning", ["loc-0309"]), person("Cormac", "Teague", ["loc-0307"]), person("Ines", "Marrow", ["loc-0307", "loc-0309"])];
const SCOPE = ["loc-0307", "loc-0309"];

function reply(employeeName: string, extra: Partial<ChatFormProposal> = {}): AskResponse {
  const card = { proposalId: "p", templateKey: "coaching", templateName: "Coaching Form", employeeName, locationId: "loc-0309", locationName: null, locationResolution: "resolved", ...extra };
  return { content: "card", citations: [], formProposal: card } as unknown as AskResponse;
}

describe("copyOwnSalon", () => {
  it("a copy card for a one-salon person takes that salon", () => {
    expect(copyOwnSalon(reply("Cormac Teague"), "copy this form for Cormac Teague", ROSTER, SCOPE).formProposal?.locationId).toBe("loc-0307");
  });

  it("a card carrying copyFromInstanceId is a copy card, whatever the turn says", () => {
    const out = copyOwnSalon(reply("Cormac Teague", { copyFromInstanceId: "f-1" }), "Cormac Teague", ROSTER, SCOPE);
    expect(out.formProposal?.locationId).toBe("loc-0307");
  });

  it("a card that is not a copy is left alone", () => {
    const built = reply("Cormac Teague");
    expect(copyOwnSalon(built, "create a coaching form for Cormac Teague at kearney", ROSTER, SCOPE)).toBe(built);
  });

  it("a person at several salons, or not on the roster, is left alone", () => {
    const several = reply("Ines Marrow");
    expect(copyOwnSalon(several, "copy this form for Ines Marrow", ROSTER, SCOPE)).toBe(several);
    const nobody = reply("Tamsin Oddway");
    expect(copyOwnSalon(nobody, "copy this form for Tamsin Oddway", ROSTER, SCOPE)).toBe(nobody);
  });

  it("only salons in the manager's scope count", () => {
    const built = reply("Cormac Teague");
    expect(copyOwnSalon(built, "copy this form for Cormac Teague", ROSTER, ["loc-0309"])).toBe(built);
  });

  it("already at the person's salon: unchanged", () => {
    const built = reply("Orla Venning");
    expect(copyOwnSalon(built, "copy this form for Orla Venning", ROSTER, SCOPE)).toBe(built);
  });
});
