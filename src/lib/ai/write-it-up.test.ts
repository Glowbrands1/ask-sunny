import { afterEach, describe, expect, it } from "vitest";

import { employeeState, managerContext } from "@/lib/forms/proposal";
import { detectTemplateIntent } from "@/lib/forms/template-intent";

import { withWriteItUp, writeItUpRequest } from "./write-it-up";
import type { AskRequest } from "./types";

/**
 * QA, 26 Oct 2026 (Sunny tester; the same reader in the sibling app): after
 * "whats the policy on being late opening the salon", "write it up for devon
 * harlan" got policy advice instead of a card. The tester's wording; the name
 * is the testers' invented one.
 */
const FLAG = "WRITE_IT_UP_ENABLED";
const saved = process.env[FLAG];
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
});

const POLICY_QUESTION = "whats the policy on being late opening the salon";

function read(question: string) {
  const request = withWriteItUp({ question, history: [{ role: "user", content: POLICY_QUESTION }] } as unknown as AskRequest);
  const history = [{ id: "u0", role: "user" as const, content: request.history[0]!.content as string }];
  return {
    intent: detectTemplateIntent(request.question),
    employee: employeeState(managerContext(history, { id: "now", content: request.question })).resolution,
  };
}

describe("WRITE_IT_UP_ENABLED off", () => {
  it("reads 'write it up for devon harlan' as no form, as on main", () => {
    delete process.env[FLAG];
    const request = { question: "write it up for devon harlan", history: [] } as unknown as AskRequest;
    expect(withWriteItUp(request)).toBe(request);
    expect(read("write it up for devon harlan").intent).toEqual({ kind: "none" });
  });
});

describe("WRITE_IT_UP_ENABLED on", () => {
  it.each([
    "write it up for devon harlan",
    "Write it up for devon harlan",
    "Write it up for Devon Harlan",
    "can you write this up for devon harlan",
    "write that up for devon harlan tc 10-20-26",
  ])("'%s' is the Corrective Action Form for Devon Harlan", (turn) => {
    process.env[FLAG] = "on";
    const { intent, employee } = read(turn);
    expect(intent).toEqual({ kind: "explicit", templateKey: "dpoa" });
    expect(employee.kind === "resolved" && employee.employeeName.toLowerCase()).toBe("devon harlan");
  });

  it("capitals are read as the form too", () => {
    process.env[FLAG] = "on";
    expect(read("WRITE IT UP FOR DEVON HARLAN").intent).toEqual({ kind: "explicit", templateKey: "dpoa" });
  });

  it.each(["write it up for me", "can you write it up for you to check", "write it up for 10/20", "i wrote it up for her yesterday", "write up devon harlan"])(
    "leaves '%s' as typed",
    (turn) => {
      process.env[FLAG] = "on";
      expect(writeItUpRequest(turn)).toBe(turn);
    },
  );
});
