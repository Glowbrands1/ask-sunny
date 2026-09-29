import { describe, expect, it } from "vitest";

import { detectTemplateIntent, eppTemplateForRole, formRequestPhrase, isFormVocabulary, leadingFormRequest } from "./template-intent";
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
  /*
   * "corrective action" TYPED ON ITS OWN is no longer here: Operations asked
   * (29 September 2026) that the form's name alone open the form — see
   * "2c" below. A sentence ABOUT the progression is still a knowledge question.
   */
  it.each([
    "what is our corrective action process",
    "tell me about corrective actions",
  ])("%s is a knowledge question, not a creation request", (question) => {
    expect(detectTemplateIntent(question)).toEqual({
      kind: "corrective_action",
      requestedCreation: false,
    });
  });

  it("I need to do a corrective action for Sarah asks for a document and must be classified first", () => {
    expect(detectTemplateIntent("I need to do a corrective action for Sarah")).toEqual({
      kind: "corrective_action",
      requestedCreation: true,
    });
  });

  /*
   * THE FORM'S NAME LEADING THE REQUEST NAMES THE FORM (Operations, 29
   * September 2026) — see "2e". The same Corrective Action Form either way,
   * and §7 still applies to it downstream.
   */
  it.each(["create a corrective action for Marcus", "start a corrective action"])(
    "%s names the Corrective Action Form",
    (question) => {
      expect(detectTemplateIntent(question)).toEqual({ kind: "explicit", templateKey: "dpoa" });
    },
  );

  it("never returns the DPOA for the umbrella phrase inside a sentence", () => {
    for (const question of ["corrective action for repeated lateness"]) {
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

/*
 * ============================================================================
 * 2c. "CA" AND THE FORM'S NAME ON ITS OWN OPEN THE CORRECTIVE ACTION FORM
 * ============================================================================
 *
 * Requested by Operations, 29 September 2026. Shorthand, capitalisation,
 * spacing, hyphens and near-misses all name the ONE Corrective Action Form
 * (`dpoa`); nothing here is a second template.
 */
describe("2c. CA and the Corrective Action Form's own name", () => {
  it.each([
    "CA",
    "ca",
    "Ca",
    "cA",
    "CA form",
    "ca form",
    "C.A.",
    "ca.",
    "CA please",
    "new CA",
    "corrective action",
    "Corrective Action",
    "corrective actions",
    "corrective action form",
    "Corrective Action Form",
    "corrective-action",
    "corrective-action form",
    "Corrective-Action Form",
    "  corrective   action   form  ",
    "Corective Action",
    "corrective acton",
    "correctve action form",
    "corrective actoin form",
    "pull up the ca form",
    "pull up the CA form for Dana Moss",
    "I need the CA form",
  ])("%s names the Corrective Action Form", (question) => {
    expect(detectTemplateIntent(question)).toEqual({ kind: "explicit", templateKey: "dpoa" });
  });

  it.each([
    "I need a CA for Dana Moss",
    "create corrective action",
    "create a CA for Sarah",
    "start a ca for jane doe",
    "pull up a corrective action for Dana",
    "can you do a CA for Marcus",
  ])("%s asks for the form", (question) => {
    expect(detectTemplateIntent(question)).toEqual({ kind: "explicit", templateKey: "dpoa" });
  });

  it.each([
    "what is corrective action?",
    "what is a CA?",
    "how does corrective action work",
  ])("%s is still a question about the progression", (question) => {
    expect(detectTemplateIntent(question)).toEqual({
      kind: "corrective_action",
      requestedCreation: false,
    });
  });

  it.each([
    "collective action",
    "can you call me",
    "cash was short",
    "she was at the career fair",
    "correct action was taken",
  ])("%s is not the Corrective Action Form", (question) => {
    expect(detectTemplateIntent(question).kind).toBe("none");
  });

  it("keeps every other form's naming exactly as it was", () => {
    expect(detectTemplateIntent("policy review for Sarah")).toEqual({ kind: "explicit", templateKey: "policy-review" });
    expect(detectTemplateIntent("coaching form for Sarah")).toEqual({ kind: "explicit", templateKey: "coaching" });
    expect(detectTemplateIntent("I need an exit form for Jane")).toEqual({ kind: "explicit", templateKey: "stc-exit" });
    expect(detectTemplateIntent("demote paulyne effective october 5")).toEqual({ kind: "explicit", templateKey: "demotion" });
    expect(detectTemplateIntent("start an EPP")).toEqual({ kind: "ambiguous", family: "epp" });
    expect(detectTemplateIntent("create a form")).toEqual({ kind: "ambiguous" });
  });

  it("treats CA as form vocabulary, never as part of somebody's name", () => {
    expect(isFormVocabulary("CA")).toBe(true);
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

    /*
     * `family: "epp"` NAMES THE GROUP AND CHOOSES NOTHING FROM IT. The kind is
     * still `ambiguous`, which is the property this test is about: no template
     * key comes back, so nothing downstream can treat one of six plans as
     * decided on the strength of the word "EPP".
     */
    for (const question of ["start an EPP for Dana", "she needs a performance plan"]) {
      const intent = detectTemplateIntent(question);
      expect(intent, question).toEqual({ kind: "ambiguous", family: "epp" });
      expect(JSON.stringify(intent), question).not.toContain("templateKey");
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
    /*
     * Six of the thirteen are performance plans, and two of those are readings
     * of the same DMIT document. Picking one would be the removed default.
     *
     * THE FAMILY IS NAMED IN THE ANSWER, and that changes nothing about the
     * rule: `ambiguous` is still `ambiguous`, so the manager still gets the
     * form selector from this function alone. What `family: "epp"` buys is a
     * CALLER that can see the conversation being able to settle it from a role
     * the manager already stated — see `eppTemplateForRole`.
     */
    for (const question of [
      "start an EPP for Marco",
      "I need a performance plan",
      "create an employee performance plan",
      "create a DMIT EPP",
    ]) {
      expect(detectTemplateIntent(question), question).toEqual({
        kind: "ambiguous",
        family: "epp",
      });
    }

    // A request that names no family at all carries none.
    expect(detectTemplateIntent("I need a form")).toEqual({ kind: "ambiguous" });
  });

  it("settles the plan only when the manager's words name exactly one role", () => {
    expect(
      eppTemplateForRole("Jessica is an SDIT at Lincoln South. She's been late several times."),
    ).toBe("sdit-epp");
    expect(eppTemplateForRole("Marco is a Training Salon Director")).toBe("tsd-epp");
    expect(eppTemplateForRole("Dana is an FTTC")).toBe("fttc-epp");

    // No role stated, an ambiguous one, or two at once: the manager chooses.
    expect(eppTemplateForRole("Jessica has been late several times")).toBeNull();
    expect(eppTemplateForRole("Jessica is an ASD")).toBeNull();
    expect(eppTemplateForRole("Jessica is a DMIT")).toBeNull();
    expect(eppTemplateForRole("Jessica is an SDIT and Marco is a TSD")).toBeNull();
    // A substring is not a role: "sdit" inside another word must not match.
    expect(eppTemplateForRole("the asdit code")).toBeNull();
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

describe("2d. the form's name leading straight into the details", () => {
  it.each([
    "CA, she was late today",
    "CA for Dana Moss",
    "ca for Dana Moss, late again",
    "Corrective Action: Dana Moss was late",
    "corrective action - Dana Moss, tardiness",
    "CA, yes payroll deduct applies",
  ])("%s asks for the form", (question) => {
    expect(detectTemplateIntent(question)).toEqual({ kind: "explicit", templateKey: "dpoa" });
  });

  it.each([
    "corrective action for repeated lateness",
    "CA for tardiness?",
    "corrective action, how does it work?",
  ])("%s is still a question about the progression", (question) => {
    expect(detectTemplateIntent(question)).toEqual({ kind: "corrective_action", requestedCreation: false });
  });
});

/*
 * ============================================================================
 * 2e. ANY FORM'S NAME LEADING THE MESSAGE IS THE REQUEST — NO VERB REQUIRED
 * ============================================================================
 *
 * One shared rule, derived from the configured namings (Operations, 29
 * September 2026). The verb stays optional, and a question stays a question.
 */
describe("2e. a form's name leading the message, for every form", () => {
  it.each([
    ["CA", "dpoa"],
    ["ca", "dpoa"],
    ["CA for paulyne co", "dpoa"],
    ["ca for Dana Moss", "dpoa"],
    ["Corrective Action for John Smith", "dpoa"],
    ["create ca for paulyne co she was late today, got verbal warning on september 21", "dpoa"],
    ["Coaching for paulyne co", "coaching"],
    ["coaching Dana Moss", "coaching"],
    ["COACHING FOR DANA MOSS", "coaching"],
    ["coaching", "coaching"],
    ["Follow-up coaching for Dana Moss", "follow-up-coaching"],
    ["Demotion for Jane Smith", "demotion"],
    ["Demotion jane smith", "demotion"],
    ["demotion", "demotion"],
    ["Position Transfer for Mary Cruz", "position-transfer"],
    ["Transfer for Mary Cruz", "position-transfer"],
    ["Exit for John Doe", "stc-exit"],
    ["Exit John Doe", "stc-exit"],
    ["Resignation for John Doe", "stc-exit"],
    ["Policy review for Dana Moss", "policy-review"],
    ["SDIT EPP for Jessica Vance", "sdit-epp"],
    ["Prescreen for Jordan Lee", "prescreen-phone-interview"],
    // The verb still works; it is just no longer needed.
    ["create a coaching form for Dana Moss", "coaching"],
    ["make a demotion form for Jane Smith", "demotion"],
    ["open an exit form for John Doe", "stc-exit"],
    ["can you pull up a coaching form for Dana?", "coaching"],
    ["where's the exit form", "stc-exit"],
  ])("%s -> %s", (question, key) => {
    expect(detectTemplateIntent(question)).toEqual({ kind: "explicit", templateKey: key });
  });

  it.each([
    "what is a coaching form?",
    "when should I use a demotion form?",
    "how does a demotion work?",
    "how does the exit process work?",
    "what information is needed for a transfer form?",
    "which form do I use for a transfer?",
    "coaching tips for new managers",
    "coaching went well today",
    "exit interview questions",
    "transfer policy",
    "demotion policy for managers",
  ])("%s does not open a form", (question) => {
    expect(detectTemplateIntent(question).kind).toBe("none");
  });

  it("keeps questions about the Corrective Action Form as questions about the progression", () => {
    expect(detectTemplateIntent("what is a CA?")).toEqual({ kind: "corrective_action", requestedCreation: false });
    expect(detectTemplateIntent("what is a corrective action form?")).toEqual({
      kind: "corrective_action",
      requestedCreation: false,
    });
  });

  it("never opens a record from the escalation words on their own", () => {
    expect(detectTemplateIntent("termination for John Doe").kind).not.toBe("explicit");
    expect(detectTemplateIntent("separation for John Doe").kind).not.toBe("explicit");
  });

  it("returns the words after the form's name, as typed", () => {
    expect(leadingFormRequest("CA for paulyne co she was late today")).toEqual({
      templateKey: "dpoa",
      subject: ["paulyne", "co", "she", "was", "late", "today"],
    });
    expect(leadingFormRequest("Exit John Doe")).toEqual({ templateKey: "stc-exit", subject: ["John", "Doe"] });
    expect(leadingFormRequest("Coaching")).toEqual({ templateKey: "coaching", subject: [] });
    expect(leadingFormRequest("the exit process")).toBeNull();
  });
});
