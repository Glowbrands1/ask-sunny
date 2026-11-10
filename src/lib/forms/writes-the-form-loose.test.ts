import { afterEach, describe, expect, it, vi } from "vitest";

import { detectTemplateIntent } from "./template-intent";

/*
 * CA_SALES_POLICY_ENABLED (QA, 4 Nov 2026): "Can you write me a performace ca
 * for an employee who …" made no card. "write me a …" and one or two plain
 * words before the form still write the form; writing ABOUT the form does
 * not. QA's wording, the person invented.
 */
const SAID = "Can you write me a performace ca for an employee who did not meet their numbers for the month of october Talise Vorn  - verbal\n146 tans \nBelow in PPTA, LPSVA, Average Club, CC%, Spa%";

afterEach(() => vi.unstubAllEnvs());

describe("\"write me a … CA\" writes the form (CA_SALES_POLICY_ENABLED)", () => {
  it("QA's wording, and shorter forms of it, ask to create a Corrective Action", () => {
    vi.stubEnv("CA_SALES_POLICY_ENABLED", "true");
    for (const said of [SAID, "write me a ca for Talise Vorn", "can you write me a performance ca for Talise Vorn", "write us a quick corrective action for Talise Vorn"]) {
      expect(detectTemplateIntent(said), said).toEqual({ kind: "corrective_action", requestedCreation: true });
    }
  });

  it("writing about the form is not creating one", () => {
    vi.stubEnv("CA_SALES_POLICY_ENABLED", "true");
    for (const said of ["can you write a summary of the corrective action policy", "write a note explaining the corrective action steps", "write an email to Talise about her CA"]) {
      expect(detectTemplateIntent(said), said).not.toEqual({ kind: "corrective_action", requestedCreation: true });
    }
  });

  it("off: \"write me a ca for <name>\" is read as before", () => {
    vi.stubEnv("CA_SALES_POLICY_ENABLED", "false");
    expect(detectTemplateIntent("write me a ca for Talise Vorn")).toEqual({ kind: "corrective_action", requestedCreation: false });
  });
});
