import { describe, expect, it } from "vitest";

import { detectInventoryQuestion } from "./inventory-question";
import { detectTemplateIntent } from "./template-intent";

/**
 * ============================================================================
 * ASKING ABOUT THE LIBRARY vs ASKING FOR A FORM
 * ============================================================================
 *
 * Both sentences name the same template. Only one of them should put a document
 * in somebody's employment file, and before this module the first one produced a
 * proposal card — an offer to create a coaching record for an employee nobody
 * had named.
 *
 * The other half of the job is knowing when to stand down. A question about the
 * library that reached retrieval is a worse answer; a POLICY question hijacked
 * by a list of forms is a failed one, so most of what follows is the negative
 * matrix.
 */

describe("questions about the library", () => {
  it.each([
    "what forms do we have?",
    "which forms are available for corrective action?",
    "what documents are you referring to in the knowledge base or forms?",
    "and what forms are you using for this?",
    "what form should I use?",
    "what forms are under HR & Performance?",
    "list of forms please",
  ])("%s -> list", (question) => {
    expect(detectInventoryQuestion(question).kind).toBe("list");
  });

  it.each([
    "where are those forms?",
    "where do I find the coaching form?",
    "i need to find those documents",
    "which category is the DPOA form under?",
    "where are the templates kept?",
  ])("%s -> location", (question) => {
    expect(detectInventoryQuestion(question).kind).toBe("location");
  });

  it.each([
    "do we have a role-play form?",
    "do we have a follow-up coaching form?",
    "is there a policy review form?",
    "do you have an exit interview document?",
    // The looser artifact noun, which is how the reference platform's invented
    // document was named — so it is what a manager who read that answer types.
    "do we have a role-play evaluation?",
  ])("%s -> availability", (question) => {
    expect(detectInventoryQuestion(question).kind).toBe("availability");
  });
});

describe("it stands down for everything else", () => {
  it.each([
    // Policy questions. The failure to avoid: answering these with the Forms
    // menu.
    "what is the attendance policy?",
    "where is the attendance policy?",
    "where can I find the discipline policy?",
    "what does the handbook say about tardiness?",
    "how do I coach someone who keeps arriving late?",
    "what should I focus on in today's Daily Stats?",
    // Guidance about a process, not a template.
    "do we have an evaluation process?",
    "is there a policy for role-play training?",
    // A follow-up with no library noun in it. Deliberately not claimed: which
    // register "this information" meant is not knowable from the sentence.
    "where is this information stored",
    "is this under operations",
  ])("%s -> none", (question) => {
    expect(detectInventoryQuestion(question).kind).toBe("none");
  });

  it.each([
    "create a coaching form for Sarah",
    "start a form",
    "draft a DPOA for Marcus",
    "I need a policy review form for Dana",
    "fill out a coaching form",
    "make a form",
  ])("%s is a creation request, not a question -> none", (question) => {
    expect(detectInventoryQuestion(question).kind).toBe("none");
  });
});

describe("the two readers agree about the same sentence", () => {
  /*
   * The pairing that matters: a question about the Coaching Form must be read as
   * a question by THIS module even though `detectTemplateIntent` still reads the
   * template out of it. The template key is what makes the availability answer
   * specific — "yes, the Coaching Form" rather than "yes, something" — so both
   * readings are wanted, and the ORDER in `answerQuestion` is what decides which
   * one answers.
   */
  it("reads both a question and a template out of \"do we have a coaching form?\"", () => {
    const question = "do we have a coaching form?";
    expect(detectInventoryQuestion(question).kind).toBe("availability");
    expect(detectTemplateIntent(question)).toEqual({
      kind: "explicit",
      templateKey: "coaching",
    });
  });

  it("reads only a creation intent out of \"create a coaching form for Sarah\"", () => {
    const question = "create a coaching form for Sarah";
    expect(detectInventoryQuestion(question).kind).toBe("none");
    expect(detectTemplateIntent(question)).toEqual({
      kind: "explicit",
      templateKey: "coaching",
    });
  });

  it("finds no template in a question about a form nobody publishes", () => {
    // Which is what makes the availability answer a plain "no" rather than a
    // substitution: there is no key to resolve, so there is nothing to offer.
    expect(detectInventoryQuestion("do we have a role-play evaluation?").kind).toBe(
      "availability",
    );
    expect(detectTemplateIntent("do we have a role-play evaluation?").kind).toBe("none");
  });
});
