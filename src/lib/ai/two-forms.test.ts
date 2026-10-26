import { afterEach, describe, expect, it } from "vitest";

import { detectTemplateIntent } from "@/lib/forms/template-intent";
import type { ChatFormProposal } from "@/types";

import { formsAskedFor, withTwoFormsAsk } from "./two-forms";
import type { AskRequest, AskResponse } from "./types";

/**
 * QA, 26 Oct 2026 (Bubbles tester batch B4, item t): "Can you create a
 * coaching form and a policy review? I'd like to see both" gave only a Policy
 * Review card and dropped the Coaching Form without a word. The tester's
 * wording.
 */
const FLAG = "TWO_FORMS_ASK_ENABLED";
const saved = process.env[FLAG];
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
});

const ASKED = "Can you create a coaching form and a policy review? I'd like to see both";

function reply(templateKey: string, templateName: string): AskResponse {
  return {
    content: `Here is what I would put on a **${templateName}**.`,
    citations: [],
    formProposal: { templateKey, templateName } as unknown as ChatFormProposal,
  } as unknown as AskResponse;
}

function cases(text: string): string[] {
  const lower = text.toLowerCase();
  return [lower, lower[0]!.toUpperCase() + lower.slice(1), text.toUpperCase()];
}

describe("TWO_FORMS_ASK_ENABLED off", () => {
  it("leaves the one card's reply as it is, as on main", () => {
    delete process.env[FLAG];
    const response = reply("policy-review", "Policy Review");
    expect(withTwoFormsAsk(response, { question: ASKED, history: [] } as unknown as AskRequest)).toBe(response);
    // Main reads the whole turn as one form.
    expect(detectTemplateIntent(ASKED)).toEqual({ kind: "explicit", templateKey: "policy-review" });
  });
});

describe("TWO_FORMS_ASK_ENABLED on", () => {
  it.each(cases(ASKED))("'%s' names both forms, and the reply says how to start the other", (question) => {
    process.env[FLAG] = "on";
    expect(formsAskedFor(question).map((form) => form.templateKey)).toEqual(["coaching", "policy-review"]);
    const out = withTwoFormsAsk(reply("policy-review", "Policy Review"), { question, history: [] } as unknown as AskRequest);
    expect(out.content).toContain("You asked for two forms. I've started the **Policy Review** here.");
    expect(out.content.toLowerCase()).toContain('say **"now the coaching form"**');
    expect(out.formProposal).toEqual(reply("policy-review", "Policy Review").formProposal);
  });

  it("'now the coaching form' is then the Coaching Form", () => {
    expect(detectTemplateIntent("now the coaching form")).toEqual({ kind: "explicit", templateKey: "coaching" });
  });

  it("the terse form names both too: 'coaching form and policy review for devon harlan'", () => {
    process.env[FLAG] = "on";
    const out = withTwoFormsAsk(reply("coaching", "Coaching Form"), {
      question: "coaching form and a policy review for devon harlan",
      history: [],
    } as unknown as AskRequest);
    expect(out.content).toContain('"now the policy review for devon harlan"');
  });

  it.each([
    ["one form", "can you create a coaching form for devon harlan", "coaching", "Coaching Form"],
    ["no card", ASKED, null, null],
    ["a card for neither", ASKED, "dpoa", "Corrective Action Form"],
  ])("leaves the reply as it is: %s", (_name, question, key, name) => {
    process.env[FLAG] = "on";
    const response = key ? reply(key, name!) : ({ content: "x", citations: [] } as unknown as AskResponse);
    expect(withTwoFormsAsk(response, { question, history: [] } as unknown as AskRequest)).toBe(response);
  });

  it("says it once", () => {
    process.env[FLAG] = "on";
    const request = { question: ASKED, history: [] } as unknown as AskRequest;
    const once = withTwoFormsAsk(reply("policy-review", "Policy Review"), request);
    expect(withTwoFormsAsk(once, request)).toBe(once);
  });
});

/**
 * QA-2, 26 Oct 2026: a negated or finished form is not asked for; the phrase
 * keeps no connector. The flag-on twins of the reported lines.
 */
describe("TWO_FORMS_ASK_ENABLED on: negated and finished forms", () => {
  const variants = (text: string) => [text.toLowerCase(), text[0]!.toUpperCase() + text.slice(1).toLowerCase(), text.toUpperCase()];

  it.each([
    ...variants("don't create a policy review, just a coaching form"),
    ...variants("do not make a coaching form and a policy review"),
    ...variants("never create a coaching form and a policy review"),
  ])("'%s' adds no line", (question) => {
    process.env[FLAG] = "on";
    const response = reply("coaching", "Coaching Form");
    expect(withTwoFormsAsk(response, { question, history: [] } as unknown as AskRequest)).toBe(response);
  });

  it.each(variants("I already did a coaching form, now create a policy review"))("'%s' asks for the policy review only", (question) => {
    process.env[FLAG] = "on";
    expect(formsAskedFor(question).map((form) => form.templateKey)).toEqual(["policy-review"]);
  });

  it("'create a policy review and also a coaching form' names the policy review without the connector", () => {
    process.env[FLAG] = "on";
    const out = withTwoFormsAsk(reply("coaching", "Coaching Form"), { question: "create a policy review and also a coaching form", history: [] } as unknown as AskRequest);
    expect(out.content).toContain('say **"now the policy review"**');
  });
});

/** QA-4, 26 Oct 2026: the second form named without an article (names invented). */
describe("TWO_FORMS_ASK_ENABLED on: a second form with no article", () => {
  it.each([
    ...cases("a coaching form and policy review for Devon Harlan"),
    ...cases("coaching and ca"),
    ...cases("ca for avery stone for no call no show and then coaching for mara quill"),
  ])("'%s' names two forms", (question) => {
    process.env[FLAG] = "on";
    const keys = formsAskedFor(question).map((form) => form.templateKey);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });

  it.each([
    "ca for avery stone, coaching was not enough",
    "coaching form for devon harlan about policy",
    "coaching form for devon harlan and corrective feedback",
  ])("'%s' still names one form", (question) => {
    process.env[FLAG] = "on";
    expect(formsAskedFor(question).length).toBeLessThan(2);
  });
});

/** QA-7, 26 Oct 2026 (names invented). */
describe("TWO_FORMS_ASK_ENABLED on: 'only', capitals and the same form twice", () => {
  it.each(cases("create a policy review and a coaching form, but only the coaching form now"))("'%s' asks for the coaching form alone", (question) => {
    process.env[FLAG] = "on";
    expect(formsAskedFor(question).map((form) => form.templateKey)).toEqual(["coaching"]);
    const response = reply("coaching", "Coaching Form");
    expect(withTwoFormsAsk(response, { question, history: [] } as unknown as AskRequest)).toBe(response);
  });

  it.each(cases("can you just create a coaching form and a policy review"))("'%s' still names both forms", (question) => {
    process.env[FLAG] = "on";
    expect(formsAskedFor(question)).toHaveLength(2);
  });

  it("in capitals the other form is said back in lowercase", () => {
    process.env[FLAG] = "on";
    const out = withTwoFormsAsk(reply("policy-review", "Policy Review"), { question: ASKED.toUpperCase(), history: [] } as unknown as AskRequest);
    expect(out.content).toContain('"now the coaching form"');
    expect(out.content).not.toContain("COACHING FORM");
  });

  // Known gaps, pinned as they are: "except for dana" names a person, not a form, so two forms
  // are still asked for; the same form for two people is one form here (NEXT_PERSON_FORM starts the next).
  it.each([
    ["create a coaching form and a policy review except for dana", 2],
    ["create a coaching form for dana and a coaching form for tom", 1],
  ] as const)("known gap: '%s' names %d form(s)", (question, count) => {
    process.env[FLAG] = "on";
    expect(formsAskedFor(question)).toHaveLength(count);
  });
});
