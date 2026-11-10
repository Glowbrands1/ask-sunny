import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TURNS } from "@/app/api/chat/replay-pack/nov9-letter-title-date-cases";
import { readExitFacts } from "@/lib/forms/exit-facts";
import { EXIT_TEMPLATE_KEY } from "@/lib/forms/exit-library";

import { withoutLetterSigner } from "./letter-signer";
import { withTitleOfTheEmployee } from "./title-of-the-employee";
import type { AskRequest, AskResponse } from "./types";

/**
 * EXIT_LETTER_ADDRESSEE_ENABLED. QA, the live Sunny test (9 Nov 2026; rounds 7c and 8), in gate runner 2's exact text
 * (the people invented): the letter to Marcus Tellefsen, "terminated, effective 11/08/2026, due to repeated no-call
 * no-shows on 11/3, 11/5 and 11/7", signed "Sincerely,\nDolores Whitcombe\nDistrict Manager".
 */
const FLAG = "EXIT_LETTER_ADDRESSEE_ENABLED";
const TODAY = "2026-11-08";

beforeEach(() => {
  vi.stubEnv("EXIT_LETTER_SIGNER_NOT_SUBJECT_ENABLED", "true");
  vi.stubEnv("EXIT_TERMINATION_STATED_ENABLED", "true");
  vi.stubEnv(FLAG, "true");
});
afterEach(() => vi.unstubAllEnvs());

describe("the sign-off on lines of its own", () => {
  it("off: the turn as it was", () => {
    vi.stubEnv(FLAG, "");
    expect(withoutLetterSigner({ question: TURNS[1] })).toBe(TURNS[1]);
  });

  it("on: the letter's addressee is the form's person, and \"Dolores Whitcombe / District Manager\" is not read", () => {
    const read = withoutLetterSigner({ question: TURNS[1] });
    expect(read).not.toMatch(/Dolores Whitcombe|District Manager/);
    expect(read.trimEnd().endsWith("Sincerely,")).toBe(true);
  });

  it("on: a letter the addressee signs is kept", () => {
    const own = "Marcus Tellefsen,\n\nI am resigning effective 11/08/2026.\n\nSincerely,\nMarcus Tellefsen\nTanning Consultant";
    expect(withoutLetterSigner({ question: own })).toBe(own);
  });
});

describe("the Resignation Date is the stated termination's", () => {
  it("off: the first no-show (the bug)", () => {
    vi.stubEnv(FLAG, "");
    expect(readExitFacts(TURNS[1], TODAY).resignationDate).toBe("2026-11-03");
  });

  it("on: \"terminated, effective 11/08/2026\"", () => {
    expect(readExitFacts(TURNS[1], TODAY).resignationDate).toBe("2026-11-08");
  });
});

describe("the exit read-back's Job Title line", () => {
  const response = {
    content:
      "Here's what I'll fill in on the **Resignation/Exit Form** for **Marcus Tellefsen**:\n\n- **Name:** Marcus Tellefsen\n- **Job Title:** District Manager\n- **Resignation Date:** November 8, 2026\n\n**Left blank for you to review:** Permanent Address.",
    formProposal: { templateKey: EXIT_TEMPLATE_KEY, employeeName: "Marcus Tellefsen", employeeRole: "District Manager" },
  } as unknown as AskResponse;
  const request = { question: TURNS[1], history: [{ role: "user", content: TURNS[0] }] } as unknown as AskRequest;

  beforeEach(() => vi.stubEnv("TITLE_OF_THE_EMPLOYEE_ENABLED", "true"));

  it("off: the card's role goes, the \"- **Job Title:** District Manager\" line stays (the bug)", () => {
    vi.stubEnv(FLAG, "");
    const out = withTitleOfTheEmployee(response, request);
    expect(out.formProposal?.employeeRole).toBeNull();
    expect(out.content).toMatch(/- \*\*Job Title:\*\* District Manager/);
  });

  it("on: the line goes and the Job Title is left for the manager", () => {
    const out = withTitleOfTheEmployee(response, request);
    expect(out.content).not.toMatch(/Job Title:\*\* District Manager/);
    expect(out.content).toMatch(/\*\*Left blank for you to review:\*\* Job Title, Permanent Address/);
  });
});
