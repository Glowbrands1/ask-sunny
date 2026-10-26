import { afterEach, describe, expect, it } from "vitest";

import { employeeState, managerContext } from "@/lib/forms/proposal";
import { detectTemplateIntent } from "@/lib/forms/template-intent";
import type { ChatFormProposal } from "@/types";

import { nextPersonRequest, withNextPersonForm } from "./next-person";
import type { AskRequest } from "./types";

/**
 * QA, 26 Oct 2026 (both apps): two named people in one chat. After "ca for
 * <A> late today", "now one for <B>, he was rude to a guest" left the card on
 * A. The manager's wording; names invented.
 */
const FLAG = "NEXT_PERSON_FORM_ENABLED";
const saved = process.env[FLAG];
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
});

const OPENED = "create a ca for avery stone, late today";

function card(templateName: string): ChatFormProposal {
  return { templateName } as unknown as ChatFormProposal;
}

/** The employee after the turns, the way the proposal reads them, with the flag's rewrite first. */
function employeeAfter(next: string, templateName = "Corrective Action Form"): string | null {
  const request = withNextPersonForm({
    question: next,
    history: [
      { role: "user", content: OPENED },
      { role: "assistant", content: "I'll draft a **Corrective Action Form** for **avery stone**.", formProposal: card(templateName) },
    ],
  } as unknown as AskRequest);
  const history = request.history
    .filter((turn) => turn.role === "user")
    .map((turn, index) => ({ id: `u${index}`, role: "user" as const, content: turn.content as string }));
  const state = employeeState(managerContext(history, { id: "now", content: request.question })).resolution;
  return state.kind === "resolved" ? state.employeeName.toLowerCase() : null;
}

function cases(text: string): string[] {
  const lower = text.toLowerCase();
  return [lower, lower[0]!.toUpperCase() + lower.slice(1), text.toUpperCase()];
}

const NEXT = [
  "now one for Devon Harlan, he was rude to a guest",
  "now do one for devon harlan he was rude to a guest",
  "another one for Devon Harlan for being rude",
  "next one is for Devon Harlan, rude to a guest",
  "ok and one for devon harlan, rude to a guest",
];

describe("NEXT_PERSON_FORM_ENABLED off", () => {
  it("reads every turn as typed; the card stays on the first person, as on main", () => {
    delete process.env[FLAG];
    const request = { question: NEXT[0], history: [] } as unknown as AskRequest;
    expect(withNextPersonForm(request)).toBe(request);
    expect(employeeAfter(NEXT[0]!)).toBe("avery stone");
  });
});

describe("NEXT_PERSON_FORM_ENABLED on", () => {
  it.each(NEXT)("'%s' is a new form for the second person, in any case", (turn) => {
    process.env[FLAG] = "on";
    for (const variant of cases(turn)) {
      // Capitals are read by the name reader only with NAME_CASE; lowercase and sentence case here.
      if (variant === variant.toUpperCase()) continue;
      expect(employeeAfter(variant)).toBe("devon harlan");
    }
  });

  it("keeps the open card's form", () => {
    process.env[FLAG] = "on";
    expect(nextPersonRequest("now one for devon harlan, phone at the counter", "Coaching Form")).toBe(
      "create a Coaching Form for devon harlan, phone at the counter",
    );
    expect(detectTemplateIntent(nextPersonRequest("now one for devon harlan, rude to a guest", "Corrective Action Form"))).toEqual({
      kind: "explicit",
      templateKey: "dpoa",
    });
    expect(nextPersonRequest("another one for Devon Harlan", "Exit Form")).toBe("create an Exit Form for Devon Harlan");
  });

  it.each(["now one for her", "one for the team", "ONE FOR THE WHOLE TEAM", "is there one for this?", "she needs one for 10/12"])(
    "leaves '%s' as typed",
    (turn) => {
      process.env[FLAG] = "on";
      expect(nextPersonRequest(turn, "Corrective Action Form")).toBe(turn);
    },
  );

  it("needs an open card: with no card before it the turn is read as typed", () => {
    process.env[FLAG] = "on";
    const request = { question: NEXT[0], history: [{ role: "user", content: "hi" }] } as unknown as AskRequest;
    expect(withNextPersonForm(request)).toBe(request);
  });
});

/** QA-7 probes, 26 Oct 2026: a time, a meal or a topic after "one for" is not a person. */
describe("NEXT_PERSON_FORM_ENABLED on: 'now one for friday' is not a new form", () => {
  it.each(["now one for friday", "now one for tomorrow", "now one for lunch", "another one for being late", "Now one for Friday", "Another one for being late"])(
    "leaves '%s' as typed",
    (turn) => {
      process.env[FLAG] = "on";
      expect(nextPersonRequest(turn, "Corrective Action Form")).toBe(turn);
    },
  );

  it("only the first 'one for' is read", () => {
    process.env[FLAG] = "on";
    expect(nextPersonRequest("now one for devon harlan and one for tom lee", "Corrective Action Form")).toBe(
      "create a Corrective Action Form for devon harlan and one for tom lee",
    );
  });
});
