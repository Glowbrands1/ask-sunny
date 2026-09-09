import { describe, expect, it } from "vitest";

import { TEMPLATE_SEEDS } from "./library";
import {
  isEllipticalRegisterReference,
  MAX_ANCHOR_HOPS,
  resolveRegisterAnchor,
} from "./register-anchor";

/**
 * ============================================================================
 * WHICH REGISTER "THOSE DOCUMENTS" MEANT
 * ============================================================================
 *
 * The acceptance conversation asked "I need to find those documents" after
 * being shown a list of TEMPLATES, and Forms was the right answer. The same
 * sentence after being shown two FRAMEWORKS has a different right answer, and
 * the sentence cannot tell you which — only the turn before it can.
 *
 * THE TEMPLATE NAMES COME FROM THE REAL LIBRARY. `TEMPLATE_SEEDS` rather than a
 * hand-written list, so a template renamed or retired changes what these tests
 * resolve without anybody editing this file — and so no test here can assert
 * against a name the product no longer publishes.
 */

const TEMPLATE_NAMES = TEMPLATE_SEEDS.map((seed) => seed.name);

function turn(role: "user" | "assistant", content: string) {
  return { role, content };
}

function resolve(history: { role: string; content: string }[]) {
  return resolveRegisterAnchor({ history, templateNames: TEMPLATE_NAMES });
}

/* ==================================================================== */
/*  IS THE SENTENCE EVEN A REFERENCE?                                   */
/* ==================================================================== */

describe("recognising a reference with no subject", () => {
  it.each([
    "i need to find those documents",
    "where is this information stored",
    "is this under operations",
    "where are they?",
    "where is this stored",
    "where do i find those",
    "how do i get to them",
    "which category are these under",
  ])("%s points at something it does not name", (question) => {
    expect(isEllipticalRegisterReference(question)).toBe(true);
  });

  /*
   * THE SENTENCE ALREADY SAID WHICH REGISTER. Walking back could only agree
   * with the manager or overrule them, and overruling somebody's own word with
   * an inference about the previous turn is the worse of the two failures.
   */
  it.each([
    "where do i find those forms?",
    "where are those templates kept",
    "where is the coaching form?",
    "where is the attendance policy?",
    "where is this policy stored",
    "which category is that framework under",
  ])("%s names its own register, so it is not resolved from context", (question) => {
    expect(isEllipticalRegisterReference(question)).toBe(false);
  });

  /*
   * NOT EVERY PRONOUN IS A LOCATION QUESTION. "What does it say?" is about
   * content, and claiming it here would put the forms menu in front of somebody
   * asking what a policy says.
   */
  it.each([
    "what does it say",
    "what about those",
    "tell me more about that",
    "corrective action",
    "",
  ])("%s is not a location question at all", (question) => {
    expect(isEllipticalRegisterReference(question)).toBe(false);
  });

  it("stands down on a creation request, whatever pronouns it carries", () => {
    // "Create one of those" is a request to file paperwork, not to find it.
    expect(isEllipticalRegisterReference("create one of those for sarah")).toBe(false);
    expect(isEllipticalRegisterReference("start that for me")).toBe(false);
  });

  /*
   * A DEMONSTRATIVE BOUND TO A REAL NOUN is not elliptical, and this is the
   * case the `BARE_FOLLOWERS` list exists to separate: "is this under
   * Operations" points at nothing, "is this report under Operations" points at
   * a report.
   */
  it("does not claim a demonstrative bound to some other noun", () => {
    expect(isEllipticalRegisterReference("is this report under operations")).toBe(false);
    expect(isEllipticalRegisterReference("where is this employee's record")).toBe(false);
  });
});

/* ==================================================================== */
/*  THE WALK                                                            */
/* ==================================================================== */

/** The deterministic Forms location answer, as `form-answers.ts` writes it. */
const FORMS_LOCATION_ANSWER = [
  "The templates are in Forms > Create a Form.",
  "",
  "They are grouped as **HR & Performance Forms** and **Hiring & Interview Forms**.",
  "",
  "The **templates** are in Forms. The **guidance** is Knowledge Base material, and I cite it when I answer from it.",
].join("\n");

/** A grounded answer about the two frameworks, naming neither template. */
const FRAMEWORK_ANSWER =
  "The Employee Performance Framework explains how to read the metrics, and the Performance Management Framework sets out the corrective-action progression. [S1]";

describe("resolving against the nearest anchor", () => {
  it("reads a list of templates as the forms register", () => {
    const answer = [
      "These are the forms published in Ask Sunny that you can use:",
      `- **${TEMPLATE_NAMES[0]}**`,
      `- **${TEMPLATE_NAMES[1]}**`,
      "The **guidance** is Knowledge Base material.",
    ].join("\n");

    const resolved = resolve([turn("user", "what forms do we have"), turn("assistant", answer)]);

    expect(resolved.register).toBe("forms");
    expect(resolved.ambiguous).toBe(false);
    expect(resolved.hops).toBe(1);
  });

  /*
   * THE REGRESSION THE FIX EXISTS FOR. Two frameworks named, no template, and
   * the register note's incidental "Knowledge Base" is not what carries it —
   * the framework names are.
   */
  it("reads two named frameworks as the knowledge register", () => {
    const resolved = resolve([
      turn("user", "corrective action"),
      turn("assistant", FRAMEWORK_ANSWER),
    ]);

    expect(resolved.register).toBe("knowledge");
    expect(resolved.named).toContain("performance management framework");
    expect(resolved.named).toContain("employee performance framework");
  });

  /*
   * A TEMPLATE NAME IS NOT A KNOWLEDGE DOCUMENT, even when it ends in a
   * document word. "Policy Review" is a form; redacting the known template
   * names before the knowledge scan is what keeps it off both sides of the
   * comparison.
   */
  it("does not count a template whose name reads like a policy as knowledge", () => {
    const policyReview = TEMPLATE_SEEDS.find((seed) => seed.key === "policy-review");
    expect(policyReview, "the library still publishes a Policy Review").toBeDefined();

    const resolved = resolve([
      turn("assistant", `Use the **${policyReview!.name}** to record it.`),
    ]);

    expect(resolved.register).toBe("forms");
    expect(resolved.named).toEqual([policyReview!.name.toLowerCase()]);
  });

  it("walks past turns that name neither register", () => {
    const resolved = resolve([
      turn("user", "corrective action"),
      turn("assistant", FRAMEWORK_ANSWER),
      turn("user", "all of it"),
      turn("assistant", "Here is the whole progression. [S1]"),
      turn("user", "what about follow-up"),
      turn("assistant", "Follow up every time. [S1]"),
    ]);

    expect(resolved.register).toBe("knowledge");
    expect(resolved.hops).toBe(5);
  });

  it("stops at the NEAREST anchor, so a change of subject is not overruled", () => {
    /*
     * The whole reason this is a walk and not a memory. Forms was the subject
     * five turns ago; the frameworks are the subject now, and the answer is the
     * frameworks.
     */
    const resolved = resolve([
      turn("user", "what forms do we have"),
      turn("assistant", FORMS_LOCATION_ANSWER),
      turn("user", "corrective action"),
      turn("assistant", FRAMEWORK_ANSWER),
    ]);

    expect(resolved.register).toBe("knowledge");
    expect(resolved.hops).toBe(1);
  });

  it("stops at the nearest anchor in the other direction too", () => {
    const resolved = resolve([
      turn("user", "corrective action"),
      turn("assistant", FRAMEWORK_ANSWER),
      turn("user", "what forms do we have"),
      turn("assistant", FORMS_LOCATION_ANSWER),
    ]);

    expect(resolved.register).toBe("forms");
    expect(resolved.hops).toBe(1);
  });

  it("asks rather than guessing when one turn named both, equally", () => {
    const resolved = resolve([
      turn(
        "assistant",
        `The Performance Management Framework sets the progression, and the **${TEMPLATE_NAMES[0]}** records the first step.`,
      ),
    ]);

    expect(resolved.ambiguous).toBe(true);
    expect(resolved.register).toBeNull();
    expect(resolved.named).toContain("performance management framework");
  });

  it("reports nothing rather than ambiguity on a cold open", () => {
    /*
     * A DIFFERENT ANSWER FROM AMBIGUOUS, and the difference matters: there is
     * no antecedent to have got wrong, so the caller keeps whatever it would
     * have done. Asking "which did you mean?" about a first message the manager
     * has not yet given context for would be pedantic rather than careful.
     */
    const resolved = resolve([]);

    expect(resolved.register).toBeNull();
    expect(resolved.ambiguous).toBe(false);
    expect(resolved.hops).toBe(0);
  });

  it("gives up rather than reaching back past the window", () => {
    const filler = Array.from({ length: MAX_ANCHOR_HOPS }, () =>
      turn("assistant", "Understood. [S1]"),
    );
    const resolved = resolve([turn("assistant", FRAMEWORK_ANSWER), ...filler]);

    expect(resolved.register).toBeNull();
    expect(resolved.ambiguous).toBe(false);
  });

  it("counts distinct things named, not how often they were named", () => {
    /*
     * Otherwise emphasis outvotes substance: a framework answer that repeats
     * "Coaching Form" three times while naming two frameworks once each would
     * resolve to Forms.
     */
    const resolved = resolve([
      turn(
        "assistant",
        [
          `The **${TEMPLATE_NAMES[0]}** is the one to use. Open the **${TEMPLATE_NAMES[0]}**,`,
          `fill in the **${TEMPLATE_NAMES[0]}**, and file it.`,
          "The Performance Management Framework and the Employee Performance Framework both cover it. [S1]",
        ].join(" "),
      ),
    ]);

    expect(resolved.register).toBe("knowledge");
  });

  it("reads a bare mention of the knowledge base as the knowledge register", () => {
    const resolved = resolve([
      turn("assistant", "That is in the knowledge base, under Operations. [S1]"),
    ]);

    expect(resolved.register).toBe("knowledge");
  });

  it("reads the user's own turns, not only the assistant's", () => {
    // Managers name the register themselves at least as often as answers do.
    const resolved = resolve([
      turn("user", "tell me about the performance management framework"),
    ]);

    expect(resolved.register).toBe("knowledge");
  });

  it("resolves nothing when the library publishes nothing to name", () => {
    // A deployment with no templates cannot have a forms anchor, and must not
    // invent one from the word "form" appearing in prose.
    const resolved = resolveRegisterAnchor({
      history: [turn("assistant", "Coaching Form and Policy Review.")],
      templateNames: [],
    });

    expect(resolved.register).toBeNull();
  });
});
