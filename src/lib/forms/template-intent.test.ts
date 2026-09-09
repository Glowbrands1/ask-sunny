import { describe, expect, it } from "vitest";

import { detectTemplateIntent, formRequestPhrase } from "./template-intent";
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
    ["do a policy review with the team", "policy-review"],
    ["I need a follow-up coaching form for Sarah", "follow-up-coaching"],
    ["log the coaching follow-up for Marcus", "follow-up-coaching"],
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
      "written warning",
      "policy review",
      "coaching document for Dana",
      "follow-up coaching",
      "follow up coaching form",
    ];
    for (const question of questions) {
      const intent = detectTemplateIntent(question);
      expect(intent.kind, question).toBe("explicit");
      if (intent.kind !== "explicit") continue;
      expect(seeded, `${question} -> ${intent.templateKey}`).toContain(intent.templateKey);
    }
  });
});

/**
 * ============================================================================
 * "CORRECTIVE ACTION" IS THE LADDER, NOT THE DISCIPLINARY PLAN OF ACTION
 * ============================================================================
 *
 * The phrase used to be a `dpoa` matcher, so "I need to do a corrective action
 * for Sarah" resolved to a formal warning — the seventh rung of the approved
 * progression — chosen by a keyword. §2 of the Performance Management Framework
 * is explicit that corrective action is the whole sequence: Observation,
 * Coaching, Role Play, Follow-Up Coaching, EPP, Follow-Up Review, DPOA, Further
 * Leadership Review.
 *
 * `requestedCreation` splits the two things managers mean by the phrase, because
 * they need different answers: asking what corrective action IS is a knowledge
 * question, and asking for one to be STARTED needs the document settled first.
 */
describe("2b. corrective action is the progression, and never resolves to a template", () => {
  it.each([
    "corrective action",
    "what is our corrective action process",
    "tell me about corrective actions",
  ])("%s is a knowledge question, not a creation request", (question) => {
    expect(detectTemplateIntent(question)).toEqual({
      kind: "corrective_action",
      requestedCreation: false,
    });
  });

  it.each([
    "I need to do a corrective action for Sarah",
    "create a corrective action for Marcus",
    "start a corrective action",
  ])("%s asks for a document and must be classified first", (question) => {
    expect(detectTemplateIntent(question)).toEqual({
      kind: "corrective_action",
      requestedCreation: true,
    });
  });

  it("never returns the DPOA for the umbrella phrase", () => {
    for (const question of [
      "corrective action",
      "corrective action for repeated lateness",
      "I need a corrective action for Sarah",
    ]) {
      expect(detectTemplateIntent(question).kind, question).not.toBe("explicit");
    }
  });

  it("still resolves the namings that ARE unambiguous in the sources", () => {
    // "Written warning" is a Type of Warning on the DPOA itself, so naming it
    // names the document. The correction is about the umbrella, not about these.
    for (const question of ["written warning for Sarah", "she needs a verbal warning"]) {
      expect(detectTemplateIntent(question), question).toEqual({
        kind: "explicit",
        templateKey: "dpoa",
      });
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

/**
 * ============================================================================
 * EVERY PUBLISHED FORM IS NAMEABLE — AND THE PICKER DEPENDS ON IT
 * ============================================================================
 *
 * Only three templates could be named: coaching, DPOA and policy review. The
 * six performance plans and the four hiring forms read as `none`, so "Create a
 * Prescreen / Phone Interview Form" came back as a knowledge answer about
 * prescreening, and a card in the form selector had nothing to hand back to.
 *
 * The round trip below is the load-bearing one. A card sends
 * `formRequestPhrase(name)` through the composer; if that sentence does not
 * resolve to the same template, the manager lands on the picker they just used.
 */
describe("7. every seeded template can be asked for by its own name", () => {
  it.each(TEMPLATE_SEEDS.map((seed) => [seed.name, seed.key]))(
    "%s",
    (name, key) => {
      expect(detectTemplateIntent(formRequestPhrase(name))).toEqual({
        kind: "explicit",
        templateKey: key,
      });
    },
  );

  it("reads the hiring forms as the manager would type them", () => {
    for (const [question, key] of [
      ["Create a prescreen form for the 2pm call", "prescreen-phone-interview"],
      ["start a phone interview form", "prescreen-phone-interview"],
      ["tanning consultant interview for Dana", "tanning-consultant-interview"],
      ["first round management interview", "management-interview-round-1"],
      ["second round interview for Marco", "management-interview-round-2"],
    ] as const) {
      expect(detectTemplateIntent(question), question).toEqual({
        kind: "explicit",
        templateKey: key,
      });
    }
  });

  it("keeps the performance plans apart from one another", () => {
    for (const [question, key] of [
      ["create an SDIT EPP", "sdit-epp"],
      ["create a TSD EPP", "tsd-epp"],
      ["create an ASD-SDIT performance EPP", "asd-sdit-epp"],
      ["create an FTTC EPP", "fttc-epp"],
      ["DMIT EPP — TSD review please", "dmit-epp-tsd"],
      ["DMIT EPP — DMIT review please", "dmit-epp-dmit"],
    ] as const) {
      expect(detectTemplateIntent(question), question).toEqual({
        kind: "explicit",
        templateKey: key,
      });
    }
  });
});

describe("8. naming a FAMILY is still ambiguous, and a subject is still a question", () => {
  it("asks which plan when only the family was named", () => {
    // Six of the thirteen are performance plans, and two of those are readings
    // of the same DMIT document. Picking one would be the removed default.
    for (const question of [
      "start an EPP for Marco",
      "I need a performance plan",
      "create a DMIT EPP",
    ]) {
      expect(detectTemplateIntent(question), question).toEqual({ kind: "ambiguous" });
    }
  });

  it("does not turn a question about the WORK into a form request", () => {
    /*
     * The new matchers name documents, never roles or subjects — the same rule
     * that keeps "how do I coach someone on tardiness?" a knowledge question.
     * "fttc", "prescreen" and "tsd" on their own are absent on purpose.
     */
    for (const question of [
      "how do I prescreen a candidate?",
      "is FTTC eligible for the quarterly bonus?",
      "what does a TSD review cover?",
      "who runs the first round of interviews?",
      "help me prepare for a coaching conversation",
    ]) {
      expect(detectTemplateIntent(question), question).toEqual({ kind: "none" });
    }
  });
});
