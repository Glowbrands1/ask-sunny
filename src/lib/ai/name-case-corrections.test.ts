import { afterEach, describe, expect, it } from "vitest";

import { employeeState, managerContext } from "@/lib/forms/proposal";

import { withNameCase } from "./name-case";
import type { AskRequest } from "./types";

/**
 * QA-3, 26 Oct 2026, for NAME_CASE_INSENSITIVE_ENABLED: correction turns and
 * name gaps, with the flag on, in lowercase, sentence case and capitals. The
 * manager's wording; every person is invented.
 *
 * Not pinned here: "for rowan testcase opend late" (read "Rowan Testcase
 * opend") and "for Test Employee" (read "Test") read the same way on main in
 * mixed case. They are the name reader's (forms/proposal.ts), not this flag's.
 */
const FLAG = "NAME_CASE_INSENSITIVE_ENABLED";
const saved = process.env[FLAG];
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
});

function sentenceCase(text: string): string {
  const lower = text.toLowerCase();
  return lower[0]!.toUpperCase() + lower.slice(1);
}

function variants(text: string): string[] {
  return [text.toLowerCase(), sentenceCase(text), text.toUpperCase()];
}

/** The employee after the manager's turns, with the flag's rewrite applied first. */
function employeeAfter(...turns: string[]): string | null {
  process.env[FLAG] = "on";
  const request = withNameCase({
    question: turns[turns.length - 1]!,
    history: turns.slice(0, -1).map((content) => ({ role: "user", content })),
  } as unknown as AskRequest);
  const history = request.history.map((turn, index) => ({ id: `u${index}`, role: "user" as const, content: turn.content as string }));
  const state = employeeState(managerContext(history, { id: "now", content: request.question })).resolution;
  return state.kind === "resolved" ? state.employeeName : null;
}

const OPENED = "create a ca for devon harlan, late today";

describe("NAME_CASE_INSENSITIVE_ENABLED on: a correction names the new person", () => {
  it.each([...variants("actually it's rory vance"), ...variants("no, it's Rory Vance"), ...variants("name is rory vance")])("%s", (reply) => {
    expect(employeeAfter(OPENED, reply)?.toLowerCase()).toBe("rory vance");
  });

  it.each(variants("the name is devon harlan, not coaching, make it a ca"))("%s", (reply) => {
    expect(employeeAfter("create a coaching form for rory vance", reply)?.toLowerCase()).toBe("devon harlan");
  });
});

describe("NAME_CASE_INSENSITIVE_ENABLED on: the surname is never cut after a blank opener", () => {
  const ACCOUNT = "Devon harlan, ks manhattan, was on her phone 25 min customers waiting 9-29-26";
  it.each([
    ...variants("Create a ca.").map((opener) => [opener, ACCOUNT] as const),
    ...variants("Create an exit form.").map((opener) => [opener, ACCOUNT] as const),
    ...variants(ACCOUNT).map((account) => ["Create a ca.", account] as const),
  ])("%s / %s", (opener, account) => {
    expect(employeeAfter(opener, account)?.toLowerCase()).toBe("devon harlan");
  });
});
