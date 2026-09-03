import { describe, expect, it } from "vitest";

import type { TemplateField } from "@/types";
import { TEMPLATE_SEEDS } from "./library";
import {
  applyFillRules,
  buildFormCollection,
  buildFormDraft,
  detectTemplate,
  extractEmployeeName,
  publishedTemplateKeyFor,
  findPendingFormTurn,
  isFormIntent,
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

describe("the bridge from a conversation to the published library", () => {
  /*
   * The chat flow names an INTENT ("tpl-coaching"); Create a Form works from a
   * published template KEY ("coaching"). If those two ever drift, the handoff
   * silently drops and the manager lands on the wrong form with no explanation
   * — so the mapping is asserted against the real library rather than against a
   * copy of itself.
   */
  const published = new Set(TEMPLATE_SEEDS.map((seed) => seed.key));

  it("maps every template the chat flow can propose to one that exists", () => {
    for (const id of ["tpl-coaching", "tpl-dpoa", "tpl-policy-review"]) {
      const key = publishedTemplateKeyFor(id);
      expect(key, `${id} has no published key`).not.toBeNull();
      expect(published.has(key as string), `${key} is not in the library`).toBe(true);
    }
  });

  it("maps whatever detectTemplate returns, for the phrasings managers use", () => {
    for (const question of [
      "Can you create a coaching form for Jane?",
      "I need a DPOA for repeated tardiness",
      "start a policy review",
    ]) {
      const key = publishedTemplateKeyFor(detectTemplate(question).id);
      expect(key, question).not.toBeNull();
      expect(published.has(key as string)).toBe(true);
    }
  });

  it("drops an id it does not recognise rather than guessing at one", () => {
    // A guess here would open a disciplinary form for a coaching conversation.
    expect(publishedTemplateKeyFor("tpl-invented")).toBeNull();
    expect(publishedTemplateKeyFor("")).toBeNull();
  });
});

describe("who a form is about", () => {
  it("takes the name after \"for\"", () => {
    expect(extractEmployeeName("Create a coaching form for Jordan Vance")).toBe("Jordan Vance");
    expect(extractEmployeeName("I need a DPOA for Sam")).toBe("Sam");
  });

  it("does not mistake the first word of an instruction for a name", () => {
    /*
     * THE REGRESSION. Both of these open with a capitalised verb and name
     * nobody; the old rule returned "Create" and "Draft", which the chat
     * handoff would then write into the Employee field of a disciplinary
     * record.
     */
    expect(extractEmployeeName("Create a coaching form for a performance concern.")).toBeNull();
    expect(extractEmployeeName("Draft a form for the team member I mentioned")).toBeNull();
    expect(extractEmployeeName("Start a policy review for my consultant")).toBeNull();
  });

  it("still accepts a bare name, which is what a manager types when asked", () => {
    expect(extractEmployeeName("Jordan Vance")).toBe("Jordan Vance");
    expect(extractEmployeeName("Riley.")).toBe("Riley");
  });

  it("returns nothing rather than guessing when there is no name at all", () => {
    expect(extractEmployeeName("what does the attendance policy say?")).toBeNull();
    expect(extractEmployeeName("")).toBeNull();
  });
});
