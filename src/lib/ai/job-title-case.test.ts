import { afterEach, describe, expect, it } from "vitest";

import type { ChatFormProposal } from "@/types";

import { withJobTitleCase } from "./job-title-from-words";
import type { AskResponse } from "./types";

/**
 * JOB_TITLE_CASE_ENABLED (QA S1 live, conv_mvqa2u7m23g2o0p, 27 Oct 2026): the
 * live title reader kept "tan consultant" as typed, and the draft saved it in
 * lower case. The harness's stubbed reader already writes "Tan Consultant",
 * so the post-processor is tested on the card the live path gives.
 */
const FLAG = "JOB_TITLE_CASE_ENABLED";
const card = (employeeRole: string | null): AskResponse =>
  ({ content: "", formProposal: { employeeName: "Rory Vance", employeeRole } as ChatFormProposal }) as AskResponse;

afterEach(() => {
  delete process.env[FLAG];
});

describe(FLAG, () => {
  it("on: a lower-case title is written in title case; one with a capital is left as typed", () => {
    process.env[FLAG] = "true";
    expect(withJobTitleCase(card("tan consultant")).formProposal?.employeeRole).toBe("Tan Consultant");
    expect(withJobTitleCase(card("ASD")).formProposal?.employeeRole).toBe("ASD");
    expect(withJobTitleCase(card("Salon director")).formProposal?.employeeRole).toBe("Salon director");
    expect(withJobTitleCase(card(null)).formProposal?.employeeRole).toBeNull();
  });

  it("off: as main", () => {
    expect(withJobTitleCase(card("tan consultant")).formProposal?.employeeRole).toBe("tan consultant");
  });
});
