import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AskResponse } from "@/lib/ai/types";

import { installPreferredAliases, loopPreferredNote, withPreferredNameShown } from "./preferred-name-shown";

/**
 * QA, 15 Nov 2026: the manager typed an employee's preferred first name and the card showed only the legal name. Pau's
 * ruling: forms show the legal name only; replies and cards may say the preferred name with the legal name once.
 * Invented names.
 */
const ALIAS = { legal: "Lorraine Fairweather", preferred: "Rae Fairweather" };
const LORRAINE = { firstName: "Lorraine", preferredFirstName: "Rae", lastName: "Fairweather" };

function reply(employee: string): AskResponse {
  return {
    content: `I'll draft a **Corrective Action Form** for **${employee}** from what you've described.\n\nIs **${employee}** right?`,
    formProposal: { templateKey: "dpoa", templateName: "Corrective Action Form", employeeName: employee, status: "ready" },
  } as unknown as AskResponse;
}

beforeEach(() => installPreferredAliases(() => [ALIAS]));
afterEach(() => {
  installPreferredAliases(() => undefined);
  vi.unstubAllEnvs();
});

describe("READABLE_NAMES_ENABLED on", () => {
  beforeEach(() => vi.stubEnv("READABLE_NAMES_ENABLED", "true"));

  it("the preferred name typed is said once with the legal name; the card keeps the legal name and says why", () => {
    for (const employee of ["Lorraine Fairweather", "Rae Fairweather"]) {
      const out = withPreferredNameShown(reply(employee), "Create a CA for rae fairweather, she was late");
      expect(out.content).toBe("I'll draft a **Corrective Action Form** for Rae Fairweather (**Lorraine Fairweather** in Woven) from what you've described.\n\nIs **Lorraine Fairweather** right?");
      expect(out.formProposal?.employeeName).toBe("Lorraine Fairweather");
      expect(out.formProposal?.wovenCloseMatch).toBe("Rae Fairweather is Lorraine Fairweather in Woven; the form uses the legal name.");
    }
  });

  it("the legal name typed is the legal name, as before", () => {
    const before = reply("Lorraine Fairweather");
    expect(withPreferredNameShown(before, "Create a CA for Lorraine Fairweather, she was late")).toBe(before);
  });

  it("the loop's find_staff says the same, only for the preferred name typed", () => {
    expect(loopPreferredNote("rae fairweather", LORRAINE)).toBe('The manager typed the preferred name. Say "Rae Fairweather (Lorraine Fairweather in Woven)" the first time; the form uses the legal name, Lorraine Fairweather.');
    expect(loopPreferredNote("lorraine fairweather", LORRAINE)).toBeNull();
    expect(loopPreferredNote("rae fairweather", { firstName: "Rae", preferredFirstName: "Rae", lastName: "Fairweather" })).toBeNull();
  });
});

describe("READABLE_NAMES_ENABLED off: as before", () => {
  it("nothing changes", () => {
    const before = reply("Lorraine Fairweather");
    expect(withPreferredNameShown(before, "Create a CA for rae fairweather")).toBe(before);
    expect(loopPreferredNote("rae fairweather", LORRAINE)).toBeNull();
  });
});
