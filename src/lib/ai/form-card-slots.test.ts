import { describe, expect, it } from "vitest";

import { PRODUCTION_SALONS } from "@/data/salons";
import { HR_TEMPLATE_SEEDS } from "@/lib/forms/library";
import { detectTemplateIntent } from "@/lib/forms/template-intent";
import type { AccessScope, ChatFormProposal } from "@/types";

import { attachFormTurnSources, enrichFormCard, formTurnCitations } from "./form-card-slots";
import { EMPTY_FORM_STATE, type ConversationFormState } from "./form-state";
import { applyGroundedProposal, prepareGroundedQuestion, type GroundedPerson } from "./grounded-entities";
import { proposeFormForTurn } from "./form-proposal";
import { decideIntentTurn, headingFromAccount, type IntentTurnInput } from "./intent-slots";
import { promoteSeparateForm, wantsSeparateDocument } from "./second-form";
import type { AskResponse } from "./types";

/**
 * Live form-flow failures, 23 Oct 2026. The prompts are the ones that were sent.
 * The tool payload is a copy of those words. Nothing here names a policy the
 * retrieved headings do not contain.
 */

const TODAY = "2026-10-23";

const ELIN_PROMPT = "CA for Elin Haskett, she was rude to Tavaeh on 9-28-26, follow up 10-16-26";
const MANHATTAN_PROMPT =
  "manhattan salon opened late on 9/20/26, assistant salon director test testy, CA with $25 payroll deduction";
const CORENA_PROMPT = "coaching for cell phone use on 9-29-26 for Corena Schardt at Lawrence";
const LISA_PROMPT = "Lisa smith, tanning consultant at lawrence, coaching form today";

const SALONS = PRODUCTION_SALONS.map((salon) => ({ id: salon.id, name: salon.name }));
const TEMPLATES = [
  { key: "dpoa", name: "Corrective Action Form" },
  { key: "coaching", name: "Coaching Form" },
] as const;
const HEADINGS = ["Attendance", "Late Opening", "Standards of Conduct", "Cell Phone/Smart Watch Policy"];
const PAGES: Record<string, number> = {
  Attendance: 14,
  "Late Opening": 15,
  "Standards of Conduct": 12,
  "Cell Phone/Smart Watch Policy": 19,
};

const SCOPE: AccessScope = {
  level: "salon",
  primaryAreaId: "loc-0468",
  alsoCoversAreaIds: ["loc-0462", "loc-0313", "loc-0314"],
};

const LIBRARY = HR_TEMPLATE_SEEDS.filter((seed) => ["coaching", "dpoa"].includes(seed.key)).map((seed) => ({
  id: `tpl-${seed.key}`,
  key: seed.key,
  name: seed.name,
  shortName: seed.shortName,
  description: seed.description,
  category: seed.category,
  layoutFamily: seed.layoutFamily,
  requiredPermission: seed.requiredPermission,
  active: true,
  displayOrder: seed.displayOrder,
  currentVersion: { id: `v-${seed.key}`, status: "published" as const, document: seed.document, variants: seed.variants },
  draftVersion: null,
  versionCount: 1,
  activeAsset: null,
  assetCount: 0,
}));

function person(input: {
  id: string;
  first: string;
  last: string;
  salonIds: string[];
  title: string | null;
  primarySalonId?: string | null;
  primaryLocationName?: string | null;
}): GroundedPerson {
  return {
    id: input.id,
    firstName: input.first,
    lastName: input.last,
    preferredFirstName: null,
    salonIds: input.salonIds,
    title: input.title,
    primaryLocationName: input.primaryLocationName ?? null,
    primarySalonId: input.primarySalonId ?? null,
  };
}

const ELIN = person({
  id: "emp-elin",
  first: "Elin",
  last: "Haskett",
  salonIds: ["loc-0313", "loc-0314", "loc-0410"],
  title: "Salon Director",
  primarySalonId: "loc-0313",
  primaryLocationName: "NE Omaha 132nd and Maple",
});

const JORDAN = person({
  id: "emp-jordan",
  first: "Jordan",
  last: "Hale",
  salonIds: ["loc-0468"],
  title: "Tanning Consultant",
  primarySalonId: "loc-0468",
  primaryLocationName: "KS Lawrence",
});

const LISA_CLOSE = person({
  id: "emp-lisa",
  first: "Lisa",
  last: "Smyth",
  salonIds: ["loc-0468"],
  title: "Tanning Consultant",
  primarySalonId: "loc-0468",
  primaryLocationName: "KS Lawrence",
});

function turn(overrides: Partial<IntentTurnInput>): IntentTurnInput {
  return {
    question: "",
    history: [],
    today: TODAY,
    saved: null,
    raw: null,
    people: [JORDAN],
    salons: SALONS,
    headings: HEADINGS,
    headingPages: PAGES,
    templates: TEMPLATES,
    formInProgress: false,
    ...overrides,
  };
}

function proposal(partial: Partial<ChatFormProposal> & Pick<ChatFormProposal, "templateKey" | "templateName">): ChatFormProposal {
  return {
    proposalId: "prop-1",
    supportsInlineDraft: false,
    variantKey: null,
    employeeName: null,
    employeeRole: null,
    formDate: null,
    locationId: null,
    locationName: null,
    locationResolution: "needs_selection",
    authorizedLocationIds: [],
    status: "needs_employee",
    sourceMessageIds: [],
    ...partial,
  };
}

function answer(content: string, formProposal: ChatFormProposal): AskResponse {
  return { content, citations: [], recommendedVideoIds: [], formProposal };
}

const STANDARDS = {
  chunkIndex: 2,
  page: 13,
  printedPage: 12,
  section: "Standards of Conduct",
  content: "Standards of Conduct\n12 | P a g e\nEmployees treat every customer with respect.",
  sections: [{ heading: "Standards of Conduct", page: 12 }],
};

const LATE = {
  chunkIndex: 4,
  page: 16,
  printedPage: 15,
  section: "Late Opening",
  content: "Late Opening\n15 | P a g e\nWhen a salon opens late the employee reimburses the company.",
  sections: [{ heading: "Late Opening", page: 15 }],
};

const PHONE = {
  chunkIndex: 8,
  page: 20,
  printedPage: 19,
  section: "Cell Phone/Smart Watch Policy",
  content: "Cell Phone/Smart Watch Policy\n19 | P a g e\nPersonal cell phones stay out of sight during the shift.",
  sections: [{ heading: "Cell Phone/Smart Watch Policy", page: 19 }],
};

describe("live form cards, 23 Oct 2026", () => {
  it("CA for Elin Haskett, she was rude to Tavaeh on 9-28-26, follow up 10-16-26", () => {
    const decision = decideIntentTurn(
      turn({
        question: ELIN_PROMPT,
        people: [ELIN],
        raw: {
          employee: "Elin Haskett",
          incidentType: "rude to Tavaeh",
          incidentDate: "9-28-26",
          formType: "CA",
          formTurn: true,
          policyHeading: "Standards of Conduct",
        },
      }),
    );
    expect(decision.clarification ?? "").not.toMatch(/which salon/i);
    expect(decision.state.employeeName).toBe("Elin Haskett");
    expect(decision.state.employeeId).toBe("emp-elin");
    expect(decision.state.salonId).toBe("loc-0313");
    expect(decision.state.formDate).toBe("2026-09-28");
    expect(decision.state.policyHeading).toBe("Standards of Conduct");
    expect(decision.state.policyPage).toBe(12);
    expect(headingFromAccount(ELIN_PROMPT, HEADINGS)).toBeNull();

    const asked = answer("I won't choose which salon this belongs to. Which salon is this about?", proposal({
      templateKey: "dpoa",
      templateName: "Corrective Action Form",
      employeeName: "Elin Haskett",
      status: "needs_location",
      locationResolution: "needs_selection",
      authorizedLocationIds: ["loc-0313", "loc-0314", "loc-0410"],
    }));
    const prep = prepareGroundedQuestion({ question: ELIN_PROMPT, history: [], people: [ELIN], saved: decision.state });
    const applied = applyGroundedProposal(asked, { people: [ELIN], prep, rosterEmpty: false });
    expect(applied.formProposal?.locationId).toBe("loc-0313");
    expect(applied.formProposal?.locationResolution).toBe("resolved");

    const card = enrichFormCard({
      response: applied,
      question: decision.question,
      today: TODAY,
      people: [ELIN],
      saved: decision.state,
    });
    expect(card.formProposal?.locationId).toBe("loc-0313");
    expect(card.formProposal?.formDate).toBe("2026-09-28");
    expect(card.formProposal?.status).toBe("ready");
    expect(card.content).not.toMatch(/which salon is this about/i);
    expect(card.content).toContain("9/28/2026");
    expect(card.content).toContain("10/16/2026");
    expect(card.content).toMatch(/Standards of Conduct/);

    const sources = attachFormTurnSources({
      content: card.content,
      citations: [],
      notes: decision.question,
      chunks: [STANDARDS, LATE],
      documentId: "doc-manual",
      documentTitle: "JBA Policy Manual",
      documentCategory: "policies_compliance",
      modelHeading: decision.state.policyHeading,
    });
    expect(sources.citations).toEqual([
      expect.objectContaining({ documentTitle: "JBA Policy Manual", locator: "Page 12", category: "policies_compliance" }),
    ]);
    expect(formTurnCitations({
      notes: ELIN_PROMPT,
      chunks: [STANDARDS],
      documentId: "doc-manual",
      documentTitle: "JBA Policy Manual",
      modelHeading: null,
    })).toEqual([]);
    expect(promoteSeparateForm(ELIN_PROMPT)).toBeNull();
  });

  it("manhattan salon opened late on 9/20/26, assistant salon director test testy, CA with $25 payroll deduction", () => {
    const raw = {
      employee: "test testy",
      salon: "manhattan",
      title: "assistant salon director",
      incidentDate: "9/20/26",
      payrollAmount: "$25",
      formType: "CA",
      formTurn: true,
      policyHeading: "Late Opening",
    };
    const first = decideIntentTurn(turn({ question: MANHATTAN_PROMPT, people: [JORDAN], raw }));
    expect(first.clarification ?? "").not.toMatch(/verbal or written/i);
    expect(first.state.employeeName).toBe("test testy");
    expect(first.state.employeeId).toBeNull();
    expect(first.state.salonId).toBe("loc-0462");
    expect(first.state.formDate).toBe("2026-09-20");
    // The form prints the abbreviation extractJobTitle already returns.
    // "assistant salon director" in the manager's turn is ASD on the card.
    expect(first.state.title).toBe("ASD");
    expect(first.state.payrollAmount).toBe("25");
    expect(first.state.policyHeading).toBe("Late Opening");
    expect(first.state.policyPage).toBe(15);
    expect(first.formTurn).toBe(true);

    const resent = decideIntentTurn(
      turn({
        question: MANHATTAN_PROMPT,
        people: [JORDAN],
        saved: first.state,
        formInProgress: true,
        raw: { formTurn: true, formType: "CA" },
      }),
    );
    expect(resent.clarification ?? "").not.toMatch(/verbal or written/i);
    expect(resent.state.formDate).toBe("2026-09-20");
    expect(resent.state.payrollAmount).toBe("25");
    expect(resent.state.employeeName).toBe("test testy");
    expect(resent.state.salonId).toBe("loc-0462");

    const dropped = answer("Who is this **Corrective Action Form** for? Give me their name and I'll draft it from what you've told me.", proposal({
      templateKey: "dpoa",
      templateName: "Corrective Action Form",
      locationId: "loc-0462",
      locationResolution: "resolved",
      status: "needs_employee",
    }));
    const card = enrichFormCard({
      response: dropped,
      question: MANHATTAN_PROMPT,
      today: TODAY,
      people: [JORDAN],
      saved: first.state,
    });
    expect(card.content).not.toMatch(/who is this/i);
    expect(card.formProposal?.employeeName).toBe("test testy");
    expect(card.formProposal?.locationId).toBe("loc-0462");
    expect(card.formProposal?.formDate).toBe("2026-09-20");
    expect(card.formProposal?.employeeRole).toBe("ASD");
    expect(card.formProposal?.payrollDeduct).toBe("yes");
    expect(card.content).toContain("9/20/2026");
    expect(card.content).toContain("$25");
    expect(card.content).toMatch(/Late Opening/);
    // A name Woven does not have stays on the card and is not reported as an error.
    expect(card.content).not.toMatch(/couldn'?t find|didn'?t find/i);

    const again = enrichFormCard({ response: card, question: MANHATTAN_PROMPT, today: TODAY, people: [JORDAN], saved: resent.state });
    expect(again.formProposal?.formDate).toBe("2026-09-20");
    expect(again.formProposal?.payrollDeduct).toBe("yes");
    expect(again.content).not.toMatch(/couldn'?t find|didn'?t find/i);
    expect(again.content).not.toMatch(/verbal or written/i);
  });

  it("puts a stated amount on the card and does not take $25 from the policy", () => {
    process.env.PAYROLL_AMOUNT_FIELD_ENABLED = "1";
    const policy =
      "The employee will reimburse The Company $25.00 via payroll deduction. payroll deduct yes";
    const quoted = enrichFormCard({
      response: answer("Here is the form.", proposal({
        templateKey: "dpoa",
        templateName: "Corrective Action Form",
        payrollDeduct: "yes",
        status: "ready",
      })),
      question: policy,
      today: TODAY,
      people: [],
      saved: null,
    });
    expect(quoted.formProposal?.payrollDeductAmount ?? null).toBeNull();
    expect(quoted.content).not.toContain("$25");

    const stated = enrichFormCard({
      response: answer("Here is the form.", proposal({
        templateKey: "dpoa",
        templateName: "Corrective Action Form",
        payrollDeduct: "yes",
        status: "ready",
      })),
      question: "payroll deduct yes $40",
      today: TODAY,
      people: [],
      saved: null,
    });
    expect(stated.formProposal?.payrollDeductAmount).toBe("$40");

    const carried = enrichFormCard({
      response: answer("Redraft it.", proposal({
        templateKey: "dpoa",
        templateName: "Corrective Action Form",
        payrollDeduct: "yes",
        status: "ready",
      })),
      question: "redraft it",
      today: TODAY,
      people: [],
      saved: {
        employeeId: null,
        employeeName: "Dana Moss",
        keptTypedName: null,
        salonId: null,
        title: null,
        formDate: null,
        warningLevel: null,
        payrollDeduct: "yes",
        policyHeading: null,
        policyPage: null,
        templateKey: "dpoa",
        incident: null,
        incidentType: null,
        payrollAmount: "25",
        payrollDeductAmount: "$40",
      },
    });
    expect(carried.formProposal?.payrollDeductAmount).toBe("$40");
    expect(carried.content).not.toContain("$25");
    delete process.env.PAYROLL_AMOUNT_FIELD_ENABLED;
  });

  it("coaching for cell phone use on 9-29-26 for Corena Schardt at Lawrence", async () => {
    expect(detectTemplateIntent(CORENA_PROMPT).kind).toBe("none");
    const lead = promoteSeparateForm(CORENA_PROMPT);
    expect(lead).toContain("coaching form for Corena Schardt");
    expect(lead).toContain(CORENA_PROMPT);
    expect(detectTemplateIntent(lead ?? "").kind).toBe("explicit");
    expect(wantsSeparateDocument(CORENA_PROMPT)).toBe(true);
    expect(wantsSeparateDocument("please redraft the coaching form")).toBe(false);
    expect(wantsSeparateDocument("create a verbal corrective action")).toBe(false);

    const proposed = await proposeFormForTurn({
      history: [],
      question: lead ?? CORENA_PROMPT,
      questionMessageId: "msg-corena",
      actor: { role: "salon_director", scope: SCOPE },
      summaries: LIBRARY as never,
      today: TODAY,
    });
    expect(proposed?.formProposal?.templateKey).toBe("coaching");
    expect(proposed?.formProposal?.employeeName).toMatch(/Corena Schardt/i);
    expect(proposed?.formProposal?.formDate).toBe("2026-09-29");
    expect(proposed?.formProposal?.locationId).toBe("loc-0468");
    expect(proposed?.content ?? "").not.toMatch(/finalized/i);

    const sources = formTurnCitations({
      notes: CORENA_PROMPT,
      chunks: [PHONE, STANDARDS, LATE],
      documentId: "doc-manual",
      documentTitle: "JBA Policy Manual",
      documentCategory: "policies_compliance",
      modelHeading: null,
    });
    expect(sources.map((citation) => citation.locator)).toEqual(["Page 19"]);
    expect(sources[0]?.excerpt).toContain("cell phones");
  });

  it("builds the card from the typed name in the same turn, and does not ask the note again", async () => {
    process.env.TYPED_NAME_PROCEEDS_ENABLED = "1";
    try {
      const first = await proposeFormForTurn({
        history: [],
        question: "coaching form for Corena Shardt, tanning consultant at Lawrence, today",
        questionMessageId: "msg-shardt",
        actor: { role: "salon_director", scope: SCOPE },
        summaries: LIBRARY as never,
        today: TODAY,
      });
      expect(first?.formProposal).toBeTruthy();
      expect(first?.formProposal?.employeeName).toMatch(/^Corena Shardt$/i);
      expect(first?.content).not.toMatch(/did you mean|who is this|want to be sure|didn't find|employee list for your salons/i);

      const missing = await proposeFormForTurn({
        history: [],
        question: "coaching form for Jane Doe at Lawrence today",
        questionMessageId: "msg-jane",
        actor: { role: "salon_director", scope: SCOPE },
        summaries: LIBRARY as never,
        today: TODAY,
      });
      expect(missing?.formProposal?.employeeName).toMatch(/jane doe/i);
      expect(missing?.formProposal?.wovenCloseMatch ?? null).toBeNull();
      expect(missing?.content ?? "").not.toMatch(/didn't find|didn’t find|employee list for your salons|Woven has/i);
      expect(first?.content ?? "").not.toMatch(/Woven has/);
    } finally {
      delete process.env.TYPED_NAME_PROCEEDS_ENABLED;
    }
  });

  it("Lisa smith, tanning consultant at lawrence, coaching form today", () => {
    const decision = decideIntentTurn(
      turn({
        question: LISA_PROMPT,
        people: [JORDAN],
        raw: {
          employee: "Lisa smith",
          salon: "lawrence",
          title: "tanning consultant",
          formType: "coaching form",
          formTurn: true,
          incidentDate: null,
        },
      }),
    );
    expect(decision.clarification ?? "").not.toMatch(/which employee|who is this/i);
    expect(decision.state.employeeName).toBe("Lisa smith");
    expect(decision.state.employeeId).toBeNull();
    expect(decision.state.salonId).toBe("loc-0468");
    expect(decision.state.formDate).toBe(TODAY);
    expect(decision.state.title?.toLowerCase()).toContain("tanning consultant");

    const asked = answer("Who is this **Coaching Form** for?", proposal({
      templateKey: "coaching",
      templateName: "Coaching Form",
    }));
    const card = enrichFormCard({
      response: asked,
      question: LISA_PROMPT,
      today: TODAY,
      people: [JORDAN],
      saved: decision.state,
    });
    expect(card.formProposal?.employeeName).toBe("Lisa smith");
    expect(card.formProposal?.employeeRole?.toLowerCase()).toContain("tanning consultant");
    expect(card.formProposal?.locationId).toBe("loc-0468");
    expect(card.formProposal?.formDate).toBe(TODAY);
    expect(card.content).toContain("Lisa smith");
    expect(card.content).toContain("10/23/2026");
    expect(card.content).not.toMatch(/couldn'?t find|didn'?t find/i);
    expect(card.content).not.toMatch(/who is this/i);

    const suggested = enrichFormCard({
      response: asked,
      question: LISA_PROMPT,
      today: TODAY,
      people: [LISA_CLOSE],
      saved: { ...EMPTY_FORM_STATE, ...decision.state } satisfies ConversationFormState,
    });
    expect(suggested.formProposal?.employeeName).toBe("Lisa smith");
    expect(suggested.content).toContain("Did you mean **Lisa Smyth**");
    expect(suggested.formProposal?.locationId).toBe("loc-0468");
    expect(suggested.formProposal?.formDate).toBe(TODAY);

    process.env.TYPED_NAME_PROCEEDS_ENABLED = "1";
    try {
      const noted = enrichFormCard({
        response: asked,
        question: LISA_PROMPT,
        today: TODAY,
        people: [LISA_CLOSE],
        saved: { ...EMPTY_FORM_STATE, ...decision.state } satisfies ConversationFormState,
      });
      expect(noted.formProposal?.employeeName).toBe("Lisa smith");
      expect(noted.formProposal?.wovenCloseMatch).toBe("Woven has Lisa Smyth");
      expect(noted.content).not.toMatch(/Woven has|did you mean|say so if|who is this|want to be sure/i);
      const later = enrichFormCard({
        response: { ...asked, content: "Here is the card for Lisa smith." },
        question: LISA_PROMPT,
        today: TODAY,
        people: [LISA_CLOSE],
        saved: { ...EMPTY_FORM_STATE, ...decision.state } satisfies ConversationFormState,
        wovenNoteShown: true,
      });
      expect(later.formProposal?.employeeName).toBe("Lisa smith");
      expect(later.formProposal?.wovenCloseMatch).toBe("Woven has Lisa Smyth");
      expect(later.content).not.toMatch(/Woven has|did you mean/i);
      const nobody = enrichFormCard({
        response: asked,
        question: LISA_PROMPT,
        today: TODAY,
        people: [JORDAN],
        saved: { ...EMPTY_FORM_STATE, ...decision.state } satisfies ConversationFormState,
      });
      expect(nobody.formProposal?.employeeName).toBe("Lisa smith");
      expect(nobody.formProposal?.wovenCloseMatch ?? null).toBeNull();
      expect(nobody.content).not.toMatch(/Woven has|didn'?t find/i);
    } finally {
      delete process.env.TYPED_NAME_PROCEEDS_ENABLED;
    }
  });

  it("puts the words after job title on the title, never on the employee", () => {
    const s8 = enrichFormCard({
      response: answer("An answer.", proposal({
        templateKey: "stc-exit",
        templateName: "Exit Form",
        employeeName: "Job title",
        employeeRole: "Job title",
      })),
      question: "evangeline pembury, tanning consultant at shawnee",
      today: TODAY,
      people: [],
      saved: null,
    });
    expect(s8.formProposal?.employeeName).toBe("evangeline pembury");
    expect(s8.formProposal?.employeeName?.toLowerCase()).not.toBe("job title");
    expect(s8.formProposal?.employeeRole).toBe("Tanning Consultant");

    const s17 = enrichFormCard({
      response: answer("An answer.", proposal({
        templateKey: "dpoa",
        templateName: "Corrective Action Form",
        employeeName: "Larissa Venko Job",
        employeeRole: null,
      })),
      question: "Larissa Venko Job title: Tanning Consultant",
      today: TODAY,
      people: [],
      saved: null,
    });
    expect(s17.formProposal?.employeeName).toBe("Larissa Venko");
    expect(s17.formProposal?.employeeName).not.toBe("Larissa Venko Job");
    expect(s17.formProposal?.employeeRole).toBe("Tanning Consultant");

    const named = enrichFormCard({
      response: answer("An answer.", proposal({
        templateKey: "stc-exit",
        templateName: "Exit Form",
        employeeName: "Job title",
        employeeRole: "Job title",
      })),
      question: "Name: Evangeline Pembury, job title tanning consultant",
      today: TODAY,
      people: [],
      saved: null,
    });
    expect(named.formProposal?.employeeName).toBe("Evangeline Pembury");
    expect(named.formProposal?.employeeName?.toLowerCase()).not.toBe("job title");
    expect(named.formProposal?.employeeRole).toBe("Tanning Consultant");

    const store = enrichFormCard({
      response: answer("An answer.", proposal({
        templateKey: "dpoa",
        templateName: "Corrective Action Form",
        employeeName: "Store",
        employeeRole: null,
      })),
      question: "create a corrective action for Jane Store, tanning consultant",
      today: TODAY,
      people: [],
      saved: null,
    });
    expect(store.formProposal?.employeeName).toBe("Jane Store");
    expect(store.formProposal?.employeeRole).toBe("Tanning Consultant");

    const salon = enrichFormCard({
      response: answer("An answer.", proposal({
        templateKey: "dpoa",
        templateName: "Corrective Action Form",
        employeeName: "Jane Salon",
        employeeRole: null,
      })),
      question: "create a corrective action for Jane Salon, tanning consultant",
      today: TODAY,
      people: [],
      saved: null,
    });
    expect(salon.formProposal?.employeeName).toBe("Jane Salon");
  });
});
