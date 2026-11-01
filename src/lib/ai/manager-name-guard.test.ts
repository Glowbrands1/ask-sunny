import { afterEach, describe, expect, it, vi } from "vitest";

import { MANAGER_NAME_RULE, withManagerNameGuard, withManagerNameRule, withoutManagerNameAsEmployee } from "./manager-name-guard";
import type { AskRequest, AskResponse } from "./types";

/**
 * ============================================================================
 * THE MANAGER'S OWN NAME IS NEVER THE EMPLOYEE (MANAGER_NAME_NOT_EMPLOYEE)
 * ============================================================================
 *
 * QA, live, 1 Nov 2026 (a real chat): "step by step take an employee off
 * myglow" named nobody, and the answer said "If <the manager's own first
 * name> is leaving the company voluntarily…". The manager here is invented.
 */

const ASK = "step by step take an employee off myglow";
const MANAGER = "Wren Ashby";
const ANSWER =
  "To terminate (deactivate) an employee in myGlow, here are the steps:\n\n1. On the myGlow Home Screen, select **Terminations**.\n\nIf Wren is leaving the company voluntarily, mark them rehireable. Wren's last day goes in the termination date.";

function request(question: string, history: { role: "user" | "assistant"; content: string }[] = []): AskRequest {
  return { question, history, context: { userName: MANAGER, locationName: "NE Kearney", todayIso: "2026-10-31" } } as unknown as AskRequest;
}
const reply = (content: string, employeeName?: string): AskResponse =>
  ({ content, citations: [], coverage: "covered", ...(employeeName ? { formProposal: { employeeName } } : {}) }) as unknown as AskResponse;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe(`"${ASK}" — the manager named nobody`, () => {
  it("off (production today): the manager's own first name is the employee", () => {
    expect(withManagerNameGuard(reply(ANSWER), request(ASK)).content).toContain("If Wren is leaving the company voluntarily");
  });

  it("MANAGER_NAME_NOT_EMPLOYEE: the answer says the employee", () => {
    vi.stubEnv("MANAGER_NAME_NOT_EMPLOYEE_ENABLED", "true");
    const content = withManagerNameGuard(reply(ANSWER), request(ASK)).content;
    expect(content).toContain("If the employee is leaving the company voluntarily");
    expect(content).toContain("The employee's last day goes in the termination date.");
    expect(content).not.toMatch(/\bWren\b/);
  });

  it("MANAGER_NAME_NOT_EMPLOYEE: a greeting is left alone", () => {
    vi.stubEnv("MANAGER_NAME_NOT_EMPLOYEE_ENABLED", "true");
    expect(withManagerNameGuard(reply("Hi Wren, here are the steps."), request(ASK)).content).toBe("Hi Wren, here are the steps.");
  });

  it("MANAGER_NAME_NOT_EMPLOYEE: never when the manager typed that name for an employee, nor for a card for somebody who shares it", () => {
    vi.stubEnv("MANAGER_NAME_NOT_EMPLOYEE_ENABLED", "true");
    expect(withManagerNameGuard(reply(ANSWER), request("how do i take wren off myglow")).content).toContain("If Wren is leaving");
    expect(withManagerNameGuard(reply(ANSWER), request(ASK, [{ role: "user", content: "Wren Calloway is leaving" }])).content).toContain("If Wren is leaving");
    expect(withManagerNameGuard(reply(ANSWER, "Wren Calloway"), request(ASK)).content).toContain("If Wren is leaving");
  });
});

describe("withoutManagerNameAsEmployee", () => {
  it("rewrites only the name as a subject", () => {
    const managerTurns = [ASK];
    expect(withoutManagerNameAsEmployee("Once Wren has returned the keys, sign off.", { managerName: MANAGER, managerTurns })).toBe(
      "Once the employee has returned the keys, sign off.",
    );
    expect(withoutManagerNameAsEmployee("Great question, Wren.", { managerName: MANAGER, managerTurns })).toBe("Great question, Wren.");
  });
});

describe("the prompt", () => {
  it("MANAGER_NAME_NOT_EMPLOYEE: says the manager's name is only for addressing them", async () => {
    vi.stubEnv("MANAGER_NAME_NOT_EMPLOYEE_ENABLED", "true");
    const { buildSystemPrompt } = await import("./prompts");
    const prompt = withManagerNameRule(buildSystemPrompt({
      assistantName: "Sunny",
      brandName: "Sun Tan City",
      salonNoun: "salon",
      context: { userName: MANAGER, locationName: "NE Kearney", todayIso: "2026-10-31" },
      mode: "standard",
      hasContext: true,
    } as never));
    expect(prompt).toContain(`You are talking to ${MANAGER}, who runs NE Kearney. ${MANAGER_NAME_RULE}`);
  });

  it("MANAGER_NAME_NOT_EMPLOYEE: the same in the cached prompt production uses", async () => {
    vi.stubEnv("MANAGER_NAME_NOT_EMPLOYEE_ENABLED", "true");
    vi.stubEnv("PROMPT_CACHE_ENABLED", "true");
    const { buildSystemPrompt } = await import("./prompts");
    const prompt = withManagerNameRule(buildSystemPrompt({
      assistantName: "Sunny",
      brandName: "Sun Tan City",
      salonNoun: "salon",
      context: { userName: MANAGER, locationName: "NE Kearney", todayIso: "2026-10-31" },
      mode: "standard",
      hasContext: true,
    } as never));
    expect(prompt).toContain("---DYNAMIC---");
    expect(prompt).toContain(`You are talking to ${MANAGER}, who runs NE Kearney. ${MANAGER_NAME_RULE}`);
  });

  it("off: the line is as before", async () => {
    const { buildSystemPrompt } = await import("./prompts");
    const prompt = withManagerNameRule(buildSystemPrompt({
      assistantName: "Sunny",
      brandName: "Sun Tan City",
      salonNoun: "salon",
      context: { userName: MANAGER, locationName: "NE Kearney", todayIso: "2026-10-31" },
      mode: "standard",
      hasContext: true,
    } as never));
    expect(prompt).toContain(`You are talking to ${MANAGER}, who runs NE Kearney. Today is 2026-10-31.`);
    expect(prompt).not.toContain(MANAGER_NAME_RULE);
  });
});
