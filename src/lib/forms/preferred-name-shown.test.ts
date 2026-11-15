import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AskResponse } from "@/lib/ai/types";

import { installPreferredAliases, nameAsSaid, withPreferredNameShown } from "./preferred-name-shown";

/**
 * QA, 15 Nov 2026: the manager typed an employee's preferred first name and the card showed only the legal name. Pau's
 * ruling (~10:20 PHT): the card and the form use the name the manager used, preferred or legal; with neither, the
 * preferred one; with the preferred name the reply names the legal name once. Invented names.
 */
const ALIAS = { legal: "Lorraine Fairweather", preferred: "Rae Fairweather" };

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

describe("nameAsSaid", () => {
  it.each([
    ["Create a CA for rae fairweather, she was late", "Rae Fairweather"],
    ["Create a CA for Lorraine Fairweather, she was late", "Lorraine Fairweather"],
    ["she was late again", "Rae Fairweather"],
    ["lorraine, I mean rae fairweather", "Rae Fairweather"],
  ])("%s → %s", (said, name) => {
    expect(nameAsSaid(ALIAS, said)).toBe(name);
  });
});

describe("READABLE_NAMES_ENABLED on", () => {
  beforeEach(() => vi.stubEnv("READABLE_NAMES_ENABLED", "true"));

  it("the preferred name typed: on the card, and the legal name said once", () => {
    for (const employee of ["Lorraine Fairweather", "Rae Fairweather"]) {
      const out = withPreferredNameShown(reply(employee), "Create a CA for rae fairweather, she was late");
      expect(out.content).toBe("I'll draft a **Corrective Action Form** for **Rae Fairweather** (Lorraine Fairweather in Woven) from what you've described.\n\nIs **Rae Fairweather** right?");
      expect(out.formProposal?.employeeName).toBe("Rae Fairweather");
      expect(out.formProposal?.wovenCloseMatch).toBe("Rae Fairweather is Lorraine Fairweather in Woven.");
    }
  });

  it("a plain mention of the legal name elsewhere is said the manager's way, so the legal name is said once", () => {
    const withStore = { ...reply("Lorraine Fairweather"), content: "I'll draft it for **Lorraine Fairweather**. Store: West, from Woven (where Lorraine Fairweather is assigned)." } as AskResponse;
    expect(withPreferredNameShown(withStore, "rae fairweather").content).toBe("I'll draft it for **Rae Fairweather** (Lorraine Fairweather in Woven). Store: West, from Woven (where Rae Fairweather is assigned).");
  });

  it("the legal name typed: the legal name, with no note", () => {
    const out = withPreferredNameShown(reply("Rae Fairweather"), "Create a CA for Lorraine Fairweather, she was late");
    expect(out.content).toBe("I'll draft a **Corrective Action Form** for **Lorraine Fairweather** from what you've described.\n\nIs **Lorraine Fairweather** right?");
    expect(out.formProposal?.employeeName).toBe("Lorraine Fairweather");
    expect(out.formProposal?.wovenCloseMatch).toBeUndefined();
  });

  it("the legal name is said once across turns: a later reply that already says it is left as is", () => {
    const later = { ...reply("Rae Fairweather"), content: "**Rae Fairweather** (Lorraine Fairweather in Woven) — updated." } as AskResponse;
    expect(withPreferredNameShown(later, "rae fairweather").content).toBe("**Rae Fairweather** (Lorraine Fairweather in Woven) — updated.");
  });
});

describe("READABLE_NAMES_ENABLED off: as before", () => {
  it("nothing changes", () => {
    const before = reply("Lorraine Fairweather");
    expect(withPreferredNameShown(before, "Create a CA for rae fairweather")).toBe(before);
  });
});
