import { describe, expect, it } from "vitest";

import { detectFormOpportunity, suggestedTemplateKeys } from "./form-opportunity";

/**
 * ============================================================================
 * WHEN A CONVERSATION IS ALREADY A FORM — AND WHEN IT IS JUST A SENTENCE
 * ============================================================================
 *
 * Both halves matter equally. Missing the obvious case is the friction this
 * exists to remove; firing on a rota note is a product that nags, and a
 * product that nags gets ignored precisely when it is right.
 */

const read = (text: string, employeeKnown = true) =>
  detectFormOpportunity({ context: { text }, employeeKnown });

describe("a conversation worth offering a form for", () => {
  it("reads praise plus a development point as a performance plan", () => {
    const found = read(
      "Jessica is an SDIT at Lincoln South. She's great with customers but she's been late several times.",
    )!;
    expect(found.kind).toBe("development");
    expect(found.role).toBe("SDIT");
    expect(found.signals).toContain("concern");
    expect(found.signals).toContain("strength");
  });

  it("reads a coaching request", () => {
    expect(read("I need to coach Jessica about punctuality.")!.kind).toBe("concern");
  });

  it("reads improvement set against a remaining gap", () => {
    const found = read("Jessica has improved with clients but still struggles with attendance.")!;
    expect(found.kind).toBe("development");
  });

  it("reads a role stated without a name attached to it", () => {
    const found = read(
      "My SDIT has been doing really well with customers but needs to work on productivity.",
    )!;
    expect(found.kind).toBe("development");
    expect(found.role).toBe("SDIT");
  });

  it("knows when the manager has already reached for the formal ladder", () => {
    expect(read("Jessica was late again. I think this needs a written warning.")!.kind).toBe(
      "formal",
    );
  });
});

describe("what it refuses to fire on", () => {
  it("says nothing when no employee has been named", () => {
    expect(read("People keep turning up late on Saturdays.", false)).toBeNull();
  });

  it("says nothing about praise on its own", () => {
    /*
     * "Jessica is great with customers" is a nice thing to say about somebody
     * and the beginning of no document.
     */
    expect(read("Jessica is great with customers.")).toBeNull();
    expect(read("Jessica is an SDIT at Lincoln South and she's doing really well.")).toBeNull();
  });

  it("says nothing about a rota note that happens to contain a trigger word", () => {
    expect(read("Jessica is on the late shift tomorrow.")).toBeNull();
    expect(read("Jessica is working Saturday.")).toBeNull();
  });

  it("says nothing about a passing remark with no management frame", () => {
    expect(read("Jessica was late once, no big deal.")).toBeNull();
  });

  it("says nothing about a question", () => {
    expect(read("What is the attendance policy for Jessica's role?")).toBeNull();
  });

  it("says nothing about an empty conversation", () => {
    expect(read("")).toBeNull();
    expect(read("   ")).toBeNull();
  });
});

describe("which forms get offered, and in what order", () => {
  it("leads with the plan the stated role names", () => {
    const opportunity = read("Jessica is an SDIT, great with clients but late several times.")!;
    expect(suggestedTemplateKeys({ opportunity, rolePlanKey: "sdit-epp" })).toEqual([
      "sdit-epp",
      "coaching",
    ]);
  });

  it("leads with coaching when no role settles a plan", () => {
    const opportunity = read("I need to coach Jessica about punctuality.")!;
    expect(suggestedTemplateKeys({ opportunity, rolePlanKey: null })).toEqual(["coaching"]);
  });

  it("never puts the corrective form first, and only offers it when asked for", () => {
    /*
     * §7 OF THE FRAMEWORK. Underperformance enters at coaching. A product that
     * answered "she's been late" with a warning card first would be making the
     * substitution this whole area exists to prevent.
     */
    const concern = read("I need to coach Jessica about punctuality.")!;
    expect(suggestedTemplateKeys({ opportunity: concern, rolePlanKey: null })).not.toContain(
      "dpoa",
    );

    const formal = read("Jessica was late again. I think this needs a written warning.")!;
    const keys = suggestedTemplateKeys({ opportunity: formal, rolePlanKey: "sdit-epp" });
    expect(keys).toEqual(["sdit-epp", "coaching", "dpoa"]);
    expect(keys[keys.length - 1]).toBe("dpoa");
  });

  it("offers a short list, never the library", () => {
    const opportunity = read("Jessica is an SDIT, great with clients but late several times.")!;
    expect(
      suggestedTemplateKeys({ opportunity, rolePlanKey: "sdit-epp" }).length,
    ).toBeLessThanOrEqual(3);
  });
});
