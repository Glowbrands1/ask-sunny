import { describe, expect, it } from "vitest";

import { detectTemplateIntent } from "./template-intent";
import { TEMPLATE_SEEDS } from "./library";

/**
 * ============================================================================
 * REQUIREMENTS 1–6 — WHICH FORM, AND THE REFUSAL TO GUESS
 * ============================================================================
 *
 * The behaviour under test is a REMOVAL. `detectTemplate` in the retired
 * `chat-flow.ts` ended:
 *
 *     return match ? { id: match.id, ... } : { id: "tpl-coaching", ... };
 *
 * — so every unrecognised form request produced a Coaching Form, and "form"
 * was itself one of coaching's matchers. A manager typing "create a form for
 * Sarah" was handed the first step of a documented disciplinary sequence,
 * chosen by a keyword list.
 */

describe("1. an explicitly named template resolves to that template", () => {
  it.each([
    ["I need a coaching form for Sarah", "coaching"],
    ["start documented coaching with Marcus", "coaching"],
    ["write a DPOA for Jordan Vance", "dpoa"],
    ["this needs a written warning", "dpoa"],
    ["corrective action for repeated lateness", "dpoa"],
    ["do a policy review with the team", "policy-review"],
  ])("%s", (question, key) => {
    expect(detectTemplateIntent(question)).toEqual({ kind: "explicit", templateKey: key });
  });
});

describe("2. every key it can produce is a real library key", () => {
  it("never names a template the library does not seed", () => {
    const seeded = new Set(TEMPLATE_SEEDS.map((seed) => seed.key));
    const questions = [
      "coaching form",
      "coaching document",
      "coach form",
      "documented coaching",
      "coaching write-up",
      "coaching writeup",
      "dpoa",
      "disciplinary plan",
      "disciplinary form",
      "disciplinary action",
      "corrective action",
      "written warning",
      "policy review",
      "coaching document for Dana",
    ];
    for (const question of questions) {
      const intent = detectTemplateIntent(question);
      expect(intent.kind, question).toBe("explicit");
      if (intent.kind !== "explicit") continue;
      expect(seeded, `${question} -> ${intent.templateKey}`).toContain(intent.templateKey);
    }
  });
});

describe("3. a form request with no named template is AMBIGUOUS, never coaching", () => {
  it.each([
    "create a form for Sarah",
    "can you make a form",
    "build me a form",
    "start a form please",
    "I need a new form",
    "draft a form about attendance",
    "let's do a write-up",
  ])("%s", (question) => {
    const intent = detectTemplateIntent(question);
    expect(intent).toEqual({ kind: "ambiguous" });
    // The specific regression: this is not coaching.
    expect(JSON.stringify(intent)).not.toContain("coaching");
  });
});

describe("4. EPP names a FAMILY of six, so it is ambiguous too", () => {
  it("does not pick one of six performance plans", () => {
    const eppKeys = TEMPLATE_SEEDS.filter((seed) => seed.key.includes("epp")).map(
      (seed) => seed.key,
    );
    // The premise: there really is more than one, so choosing would be a guess.
    expect(eppKeys.length).toBeGreaterThan(1);

    for (const question of ["start an EPP for Dana", "she needs a performance plan"]) {
      expect(detectTemplateIntent(question), question).toEqual({ kind: "ambiguous" });
    }
  });
});

describe("5. a question that is not about a document is not a form request", () => {
  it.each([
    "what is the tardiness policy?",
    "how do I coach someone on punctuality?",
    "how should I coach a new consultant?",
    "what do I say when someone is late again?",
    "who approves time off",
  ])("%s", (question) => {
    expect(detectTemplateIntent(question)).toEqual({ kind: "none" });
  });
});

describe("6. matchers are whole words, so a substring cannot trigger a form", () => {
  it.each([
    "I stepped in to cover her shift",
    "we ran out of pepper spray in the back room",
    "the client asked about a lotion sample",
  ])("%s", (question) => {
    expect(detectTemplateIntent(question)).toEqual({ kind: "none" });
  });
});
