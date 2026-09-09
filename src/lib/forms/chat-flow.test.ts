import { describe, expect, it } from "vitest";

import { DEMO_FORM_TEMPLATES } from "@/data/demo/templates";
import type { FormSelection, FormTemplate, TemplateField } from "@/types";
import {
  applyFillRules,
  buildFormCollection,
  buildFormDraft,
  buildFormSelection,
  buildFormSelectionModel,
  detectTemplate,
  findPendingFormTurn,
  formRequestPhrase,
  isFormIntent,
  namedTemplate,
  routeFormIntent,
  selectableTemplates,
  writableFieldIds,
} from "./chat-flow";

const CONTEXT = {
  userName: "Dana Reyes",
  locationName: "Riverbend Commons",
  todayIso: "2026-08-29",
};

function field(over: Partial<TemplateField> & { id: string }): TemplateField {
  return {
    label: over.id,
    type: "text",
    fillRule: "ai_populate",
    required: false,
    section: "Details",
    ...over,
  };
}

describe("form intent detection", () => {
  it("recognises the phrasings managers actually use", () => {
    expect(isFormIntent("Can you create a coaching form for Jane?")).toBe(true);
    expect(isFormIntent("I need to write up an employee")).toBe(true);
    expect(isFormIntent("draft a form please")).toBe(true);
  });

  it("does not treat a knowledge question as a form request", () => {
    expect(isFormIntent("What is the attendance policy?")).toBe(false);
    expect(isFormIntent("How do I read Daily Stats?")).toBe(false);
  });

  it("routes to the right template", () => {
    expect(detectTemplate("start a DPOA for Sam").id).toBe("tpl-dpoa");
    expect(detectTemplate("policy review form").id).toBe("tpl-policy-review");
    expect(detectTemplate("coaching form").id).toBe("tpl-coaching");
  });
});

describe("buildFormCollection", () => {
  it("keeps what it knows and asks only for what is missing", () => {
    const response = buildFormCollection(
      "Create a coaching form for Jane Kowalski about tardiness",
      CONTEXT,
    );

    expect(response.content).toContain("Jane Kowalski");
    expect(response.content).toContain("Riverbend Commons");
    expect(response.pendingFormTemplateId).toBe("tpl-coaching");
    expect(response.pendingFormValues?.employee_name).toBe("Jane Kowalski");
  });

  it("cites nothing while it is still collecting", () => {
    const response = buildFormCollection("create a form", CONTEXT);
    expect(response.citations).toEqual([]);
  });
});

describe("findPendingFormTurn", () => {
  it("finds the most recent collecting turn", () => {
    const pending = findPendingFormTurn([
      {
        id: "1",
        role: "assistant",
        content: "asking",
        createdAt: "",
        pendingFormTemplateId: "tpl-coaching",
        pendingFormValues: { employee_name: "Jane" },
      },
    ]);
    expect(pending?.templateId).toBe("tpl-coaching");
  });

  it("returns null when the last assistant turn was an ordinary answer", () => {
    expect(
      findPendingFormTurn([
        { id: "1", role: "assistant", content: "an answer", createdAt: "" },
      ]),
    ).toBeNull();
  });
});

describe("buildFormDraft", () => {
  it("produces a handoff carrying the manager's own words", () => {
    const response = buildFormDraft({
      reply:
        "Late on the 12th, 15th and 19th, between ten and twenty minutes each time.",
      pending: { templateId: "tpl-coaching", values: { employee_name: "Jane Kowalski", topic: "tardiness" } },
      context: CONTEXT,
      citations: [],
    });

    expect(response.formHandoff?.templateId).toBe("tpl-coaching");
    expect(response.formHandoff?.values.employee_name).toBe("Jane Kowalski");
    expect(response.formHandoff?.values.details).toContain("12th");
    expect(response.formHandoff?.checkedOptions.coaching_topic).toEqual([
      "Attendance / punctuality",
    ]);
  });

  it("leaves signature fields entirely alone", () => {
    const response = buildFormDraft({
      reply: "details here that are long enough to be used verbatim in the draft",
      pending: { templateId: "tpl-coaching", values: {} },
      context: CONTEXT,
      citations: [],
    });

    const values = response.formHandoff?.values ?? {};
    expect(Object.keys(values).some((key) => key.includes("signature"))).toBe(false);
  });

  it("uses whatever citations the caller retrieved, not invented ones", () => {
    const citation = {
      documentId: "doc-1",
      documentTitle: "Coaching Standards",
      locator: "Coaching Standards",
      category: "leadership_coaching" as const,
      excerpt: "Coach in private.",
      relevance: 0.7,
    };

    const response = buildFormDraft({
      reply: "x",
      pending: { templateId: "tpl-coaching", values: {} },
      context: CONTEXT,
      citations: [citation],
    });

    expect(response.citations).toEqual([citation]);
  });
});

describe("applyFillRules", () => {
  const fields: TemplateField[] = [
    field({ id: "details" }),
    field({ id: "manager_note", fillRule: "manager_completes" }),
    field({ id: "employee_signature", type: "signature", fillRule: "signature_never_ai" }),
    // A signature field mismarked as AI-populatable: still never written.
    field({ id: "manager_signature", type: "signature", fillRule: "ai_populate" }),
  ];

  it("writes only fields the template marks ai_populate", () => {
    const values = applyFillRules(fields, {
      details: "drafted text",
      manager_note: "model tried to write this",
    });
    expect(values).toEqual({ details: "drafted text" });
  });

  it("never writes a signature field, even one mismarked as AI-populatable", () => {
    const values = applyFillRules(fields, {
      employee_signature: "Jane Kowalski",
      manager_signature: "Dana Reyes",
    });
    expect(values).toEqual({});
  });

  it("drops empty strings rather than blanking a field", () => {
    expect(applyFillRules(fields, { details: "" })).toEqual({});
  });

  it("ignores keys the template does not define", () => {
    expect(applyFillRules(fields, { made_up_field: "x" })).toEqual({});
  });

  it("lists exactly the fields a model may fill", () => {
    expect(writableFieldIds(fields)).toEqual(["details"]);
  });
});

/**
 * ============================================================================
 * ASKING FOR "A FORM" IS NOT THE SAME AS ASKING FOR A FORM
 * ============================================================================
 *
 * "Create a form from this conversation" names no form. The old behaviour
 * treated that as a Coaching Form request, because "form" was a matcher on the
 * coaching template — so Sunny silently picked a template for a document that
 * ends up in someone's employment file.
 *
 * The rule these tests pin: a request that names a form goes straight into that
 * form's flow, and a request that names none is answered with the picker.
 * Nothing is selected on the manager's behalf either way.
 */
describe("routeFormIntent", () => {
  const templateOf = (question: string) => {
    const route = routeFormIntent(question);
    return route.kind === "template" ? route.template.id : route.kind;
  };

  it("shows the picker for a request that names no form", () => {
    for (const question of [
      "Create a form from this conversation.",
      "Create a form",
      "Make a form from this",
      "draft a form please",
      "I need to start a new form",
    ]) {
      expect(routeFormIntent(question), question).toEqual({ kind: "selection" });
    }
  });

  it("treats a colloquial write-up as unnamed rather than guessing DPOA", () => {
    // "Write up" is used for anything from a coaching note to a final written
    // warning. Which disciplinary step applies is the manager's call.
    expect(routeFormIntent("I need to write up an employee")).toEqual({ kind: "selection" });
  });

  it("goes straight into a form the manager named", () => {
    expect(templateOf("Create a Coaching Form from this conversation.")).toBe("tpl-coaching");
    expect(templateOf("Create a Disciplinary Plan of Action")).toBe("tpl-dpoa");
    expect(templateOf("start a DPOA for Sam")).toBe("tpl-dpoa");
    expect(templateOf("Create a Prescreen / Phone Interview Form from this conversation.")).toBe(
      "tpl-prescreen",
    );
    expect(templateOf("I need a policy review form for Dana")).toBe("tpl-policy-review");
  });

  it("names a form that carries no generic form wording at all", () => {
    // "Create an SDIT EPP" contains no phrase like "create a form"; the verb
    // plus a word that means a document is what makes it a request.
    expect(templateOf("Create an SDIT EPP for Marco")).toBe("tpl-sdit-epp");
    expect(templateOf("Draft a TSD EPP")).toBe("tpl-tsd-epp");
  });

  it("keeps the lookalike EPP templates apart", () => {
    expect(templateOf("Create a TSD EPP")).toBe("tpl-tsd-epp");
    expect(templateOf("Create a DMIT EPP — TSD Review")).toBe("tpl-dmit-tsd");
    expect(templateOf("Create a DMIT EPP — DMIT Review")).toBe("tpl-dmit-dmit");
    expect(templateOf("Create an ASD-SDIT Performance EPP")).toBe("tpl-asd-sdit");
    expect(templateOf("Create an FTTC Performance EPP")).toBe("tpl-fttc");
  });

  it("matches a name typed with a hyphen instead of an em dash", () => {
    expect(templateOf("Create a DMIT EPP - TSD Review")).toBe("tpl-dmit-tsd");
    expect(templateOf("Create a Prescreen/Phone Interview Form")).toBe("tpl-prescreen");
  });

  it("leaves a knowledge question as a knowledge question", () => {
    for (const question of [
      "What is the attendance policy?",
      "How do I read Daily Stats?",
      "What is an EPP?",
      "Help me prepare for a coaching conversation.",
      "Where is the interview guide stored?",
    ]) {
      expect(routeFormIntent(question), question).toEqual({ kind: "none" });
    }
  });

  it("routes the phrase a picker card sends back to that exact template", () => {
    /*
     * THE ROUND TRIP THAT MAKES THE PICKER WORK.
     *
     * Clicking a card sends `formRequestPhrase(name)` through the composer, so
     * every registered template must be nameable by its own name. A template
     * whose name did not resolve would land the manager back on the picker —
     * an infinite loop of being asked which form they want.
     */
    for (const template of DEMO_FORM_TEMPLATES) {
      const route = routeFormIntent(formRequestPhrase(template.name));
      expect(route.kind, template.name).toBe("template");
      expect(route.kind === "template" && route.template.id, template.name).toBe(template.id);
    }
  });

  it("does not mistake the request's own verb for the employee's name", () => {
    /*
     * Every picker card sends "Create a <form> from this conversation", and the
     * standalone-name heuristic used to read "Create" as the employee — so a
     * form chosen from the picker was drafted for a person called Create.
     */
    const response = buildFormCollection(
      formRequestPhrase("Coaching Form"),
      CONTEXT,
    );

    expect(response.pendingFormValues?.employee_name).toBe("");
    expect(response.content).toContain("The team member's name");
  });

  it("still reads a real name out of the same phrasing", () => {
    expect(
      buildFormCollection("Create a Coaching Form for Jane Kowalski", CONTEXT)
        .pendingFormValues?.employee_name,
    ).toBe("Jane Kowalski");
    expect(
      buildFormCollection("Jane Kowalski was late three times", CONTEXT)
        .pendingFormValues?.employee_name,
    ).toBe("Jane Kowalski");
  });

  it("still reports form intent for the phrasings managers use", () => {
    expect(isFormIntent("Create a form from this conversation.")).toBe(true);
    expect(namedTemplate("Create a form from this conversation.")).toBeNull();
  });
});

describe("buildFormSelection", () => {
  it("offers the Coaching Form and holds the rest back", () => {
    const response = buildFormSelection();

    expect(response.formSelection?.primaryTemplateId).toBe("tpl-coaching");
    expect(response.formSelection?.additionalTemplateIds).not.toContain("tpl-coaching");
    expect(response.content).toContain("Which form do you need?");
    expect(response.content).toContain("Coaching Form");
  });

  it("does not name any other form in the prose", () => {
    // The forms live in the picker, not in the answer text — putting them in
    // the prose is the wall of forms this replaced.
    const response = buildFormSelection();
    const others = DEMO_FORM_TEMPLATES.filter((template) => template.id !== "tpl-coaching");
    for (const template of others) {
      expect(response.content, template.name).not.toContain(template.name);
    }
  });

  it("selects nothing on the manager's behalf", () => {
    const response = buildFormSelection();
    expect(response.pendingFormTemplateId).toBeUndefined();
    expect(response.pendingFormValues).toBeUndefined();
    expect(response.formHandoff).toBeUndefined();
  });

  it("covers every registered template exactly once", () => {
    const selection = buildFormSelectionModel();
    const offered = [selection.primaryTemplateId, ...selection.additionalTemplateIds];

    expect(new Set(offered).size).toBe(offered.length);
    expect(offered.sort()).toEqual(DEMO_FORM_TEMPLATES.map((entry) => entry.id).sort());
  });

  it("cites nothing and reports coverage as not applicable", () => {
    const response = buildFormSelection();
    expect(response.citations).toEqual([]);
    expect(response.coverage).toBe("not_applicable");
  });
});

describe("selectableTemplates", () => {
  const template = (over: Partial<FormTemplate> & { id: string }): FormTemplate => ({
    name: over.id,
    shortName: over.id,
    description: `${over.id} description`,
    permission: "create_coaching_form",
    active: true,
    updatedAt: "",
    updatedBy: "",
    fields: [],
    acknowledgement: "",
    hasDocumentTemplate: false,
    pdf: {
      id: `${over.id}-pdf`,
      templateId: over.id,
      fileName: "f.pdf",
      isBundledDefault: true,
      sizeBytes: 1,
    },
    ...over,
  });

  const selection: FormSelection = {
    primaryTemplateId: "a",
    additionalTemplateIds: ["b", "c"],
  };

  it("resolves ids against the templates the app currently holds", () => {
    const resolved = selectableTemplates(
      [template({ id: "a", name: "A" }), template({ id: "b" }), template({ id: "c" })],
      selection,
    );

    expect(resolved.primary?.name).toBe("A");
    expect(resolved.additional.map((entry) => entry.id)).toEqual(["b", "c"]);
  });

  it("never repeats the primary form inside the expanded list", () => {
    const resolved = selectableTemplates(
      [template({ id: "a" }), template({ id: "b" })],
      { primaryTemplateId: "a", additionalTemplateIds: ["a", "b"] },
    );

    expect(resolved.additional.map((entry) => entry.id)).toEqual(["b"]);
  });

  it("drops a template that has been deactivated or removed", () => {
    const resolved = selectableTemplates(
      [template({ id: "a" }), template({ id: "b", active: false })],
      selection,
    );

    expect(resolved.additional).toEqual([]);
  });

  it("keeps the selection's order rather than the array's", () => {
    const resolved = selectableTemplates(
      [template({ id: "c" }), template({ id: "b" }), template({ id: "a" })],
      selection,
    );

    expect(resolved.additional.map((entry) => entry.id)).toEqual(["b", "c"]);
  });
});
