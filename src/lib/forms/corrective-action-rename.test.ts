import { describe, expect, it } from "vitest";

import { parseFormDocument } from "./document";
import { performanceManagementGovernance } from "./pm-governance";
import { supportsInlineDraft } from "./inline-draft";
import { detectTemplateIntent, formRequestPhrase } from "./template-intent";
import { TEMPLATE_SEEDS } from "./library";

/**
 * ============================================================================
 * THE RENAME IS A DISPLAY CHANGE, AND THIS IS WHERE THAT IS PROVED
 * ============================================================================
 *
 * The business renamed the Disciplinary Plan of Action to the Corrective
 * Action Form. What a manager reads changed; what the data addresses did not,
 * and must not:
 *
 *   `form_templates.key`                 every filed instance points at the row
 *                                        this key identifies.
 *   `required_permission`                who may create the form.
 *   the field keys                        every row in `form_instance_values`.
 *   the `dpoa` Next Step option key       already ticked on filed Follow-Up
 *                                        Coaching Forms.
 *   the `corrective` layout family        one of the three signals that makes
 *                                        the Performance Management Framework
 *                                        mandatory for drafting.
 *
 * Renaming any of those would orphan real records for a word nobody outside
 * the code ever sees. So the display name is asserted to have CHANGED and each
 * of those is asserted to have NOT — in one file, because they are one
 * decision and a future rename should have to read them together.
 */

const corrective = TEMPLATE_SEEDS.find((seed) => seed.key === "dpoa")!;
const followUp = TEMPLATE_SEEDS.find((seed) => seed.key === "follow-up-coaching")!;

describe("1. what a manager reads", () => {
  it("is the Corrective Action Form, everywhere the seed names it", () => {
    expect(corrective.name).toBe("Corrective Action Form");
    expect(corrective.shortName).toBe("Corrective Action");
    expect(corrective.bundledPdfName).toBe("Corrective Action Form.pdf");
  });

  it("prints under that name, which is what the PDF and the preview show", () => {
    const document = parseFormDocument(corrective.document);
    const letterhead = document.blocks.find((block) => block.kind === "letterhead");

    expect(letterhead).toBeDefined();
    expect(letterhead!.kind === "letterhead" && letterhead!.title).toBe(
      "Corrective Action Form",
    );
  });

  it("asks about PREVIOUS CORRECTIVE ACTION rather than previous discipline", () => {
    const document = parseFormDocument(corrective.document);
    const labels = document.blocks.flatMap((block) =>
      block.kind === "field"
        ? [block.field.label]
        : block.kind === "field_row"
          ? block.fields.map((field) => field.label)
          : [],
    );

    expect(labels).toContain("Previous corrective action for this policy or issue");
    expect(labels).toContain("Date of previous corrective action");
    for (const label of labels) {
      expect(label, label).not.toMatch(/disciplin/i);
    }
  });

  /*
   * ==========================================================================
   * THE DETAILS LABELS, PINNED
   * ==========================================================================
   *
   * These three are what a manager reads on the printed form, in the preview,
   * on the chat card and in Form Templates — all four render from this one
   * document, so this one assertion covers every surface.
   *
   * "POLICY VIOLATED" STAYS "POLICY VIOLATED". What the field HOLDS changed
   * when the business settled it — the offense category ticked above it rather
   * than a policy title composed from a manual — and the LABEL deliberately did
   * not follow. Renaming it to something like "Violation Category" would be a
   * truer description of the contents and the wrong thing to print: this is
   * the wording on the paper form the business issues, managers read the two
   * as one pair, and the label is not ours to reword.
   */
  it("prints the Details labels the business uses, unchanged", () => {
    const document = parseFormDocument(corrective.document);
    const labels = document.blocks.flatMap((block) =>
      block.kind === "field" ? [block.field.label] : [],
    );

    expect(labels).toContain("Observation of Offense");
    expect(labels).toContain("Policy Violated");
    expect(labels).toContain("Direct policy from official manual");
    expect(labels).toContain("Action Plan");

    // And nothing has quietly become a description of the contents.
    for (const label of labels) {
      expect(label, label).not.toMatch(/violation category/i);
      expect(label, label).not.toMatch(/offense category/i);
    }
  });

  it("leaves no old wording anywhere a manager can see it", () => {
    const seen = JSON.stringify({
      name: corrective.name,
      shortName: corrective.shortName,
      description: corrective.description,
      pdf: corrective.bundledPdfName,
      document: corrective.document,
    });

    expect(seen).not.toMatch(/disciplinary/i);
    expect(seen).not.toMatch(/DPOA/);
  });

  it("renames the Follow-Up Coaching Form's Next Step option too", () => {
    const document = parseFormDocument(followUp.document);
    const nextStep = document.blocks.find(
      (block) => block.kind === "checkbox_group" && block.key === "next_step",
    );

    expect(nextStep?.kind === "checkbox_group" && nextStep.options).toContainEqual({
      key: "dpoa",
      label: "Corrective Action",
    });
  });
});

describe("2. what the data addresses, unchanged", () => {
  it("keeps the stored template key", () => {
    expect(corrective.key).toBe("dpoa");
  });

  it("keeps the permission, so no role gains or loses the form", () => {
    expect(corrective.requiredPermission).toBe("create_corrective_action");
  });

  it("keeps the layout family the framework governance reads", () => {
    expect(corrective.layoutFamily).toBe("corrective");

    const governance = performanceManagementGovernance({
      layoutFamily: corrective.layoutFamily,
      document: parseFormDocument(corrective.document),
      variantKey: null,
    });
    expect(governance.governed).toBe(true);
  });

  it("keeps every field key a stored value is addressed by", () => {
    const document = parseFormDocument(corrective.document);
    const keys = document.blocks
      .flatMap((block) =>
        block.kind === "field"
          ? [block.field.key]
          : block.kind === "field_row"
            ? block.fields.map((field) => field.key)
            : block.kind === "checkbox_group"
              ? [block.key]
              : [],
      )
      .sort();

    expect(keys).toEqual(
      [
        "employee_name",
        "form_date",
        "job_title",
        "location",
        "warning_type",
        "previous_action",
        "previous_action_date",
        "offense_type",
        "other_offense",
        "observation",
        "policy_violated",
        "policy_language",
        "action_plan",
      ].sort(),
    );
  });

  /*
   * THE FIELD THAT NAMES A MANUAL STILL FAILS CLOSED.
   *
   * `policy_violated` was grounded while it meant "the policy's own title".
   * The business settled that it holds the offense CATEGORY ticked above it,
   * which is a classification already printed on the page rather than a claim
   * about a document — so there is nothing for it to fail closed against, and
   * it is derived from the tick instead. `policy_language` names the approved
   * manual, and that is the one that must never be written unsourced.
   */
  it("keeps the manual-naming field grounded, so it still fails closed", () => {
    const document = parseFormDocument(corrective.document);
    const grounded = document.blocks
      .filter((block) => block.kind === "field" && block.field.policyGrounded)
      .map((block) => (block.kind === "field" ? block.field.key : ""));

    expect(grounded).toEqual(["policy_language"]);
  });

  it("stays creatable inside the conversation", () => {
    expect(supportsInlineDraft(corrective.key, corrective.variants)).toBe(true);
  });
});

describe("3. how a manager can ask for it", () => {
  it("resolves the form's own published name, so the picker's card works", () => {
    expect(detectTemplateIntent(formRequestPhrase(corrective.name))).toEqual({
      kind: "explicit",
      templateKey: "dpoa",
    });
  });

  it.each([
    "corrective action form",
    "create a corrective action form for Sarah",
    "I need a corrective action write-up",
  ])("names the document — %s", (question) => {
    expect(detectTemplateIntent(question)).toEqual({
      kind: "explicit",
      templateKey: "dpoa",
    });
  });

  /*
   * THE LEGACY NAMES ARE INPUT ALIASES, FOREVER AS FAR AS THIS FILE IS
   * CONCERNED. Managers have said "DPOA" for years and old chats are full of
   * it; a rename that stops recognising the word people type is a rename that
   * breaks the product. Nothing here makes Ask Sunny SAY any of them.
   */
  it.each([
    "create a DPOA for Sarah",
    "disciplinary plan of action",
    "start a disciplinary form",
    "I need to do a disciplinary action",
    "write her up",
    "write him up",
    "I need to write up an employee",
    "give her a written warning",
    "verbal warning for Sarah",
  ])("still recognises the legacy naming — %s", (question) => {
    expect(detectTemplateIntent(question)).toEqual({
      kind: "explicit",
      templateKey: "dpoa",
    });
  });

  /*
   * AND THE UMBRELLA IS STILL NOT THE DOCUMENT. §2 of the approved framework
   * names the whole progression "corrective action"; reading that as its
   * seventh rung is the substitution this routing has always refused.
   */
  it.each(["corrective action", "what is corrective action?", "corrective actions"])(
    "still reads the bare progression as the progression — %s",
    (question) => {
      expect(detectTemplateIntent(question).kind).toBe("corrective_action");
    },
  );

  it("still leaves a bare write-up ambiguous, because it could be any of them", () => {
    expect(detectTemplateIntent("let's do a write-up")).toEqual({ kind: "ambiguous" });
  });
});
