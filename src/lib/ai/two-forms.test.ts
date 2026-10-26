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
