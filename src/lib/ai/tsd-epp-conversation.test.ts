import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * THE TSD MANAGEMENT PERFORMANCE PLAN, ASKED FOR THE WAY MANAGERS ASK
 * ============================================================================
 *
 * The same six routes the SDIT plan has — the document's name, the role spelled
 * out, the title printed on the paper, the family plus a role already stated,
 * and the card that sends `formRequestPhrase` — all landing on ONE proposal.
 *
 * WHAT IS DIFFERENT AND WHAT MUST NOT BE. The questions differ: eight rather
 * than eleven, five metrics rather than three, and no job-title question,
 * because this document is the Training Salon Director's own. The ENGINE does
 * not differ, and that is most of what this file asserts: a card click and a
 * typed sentence resolve through the same `proposeFormForTurn`, with the same
 * template resolution, the same permission check and the same variant.
 *
 * NOTHING HERE WRITES. `proposeFormForTurn` creates no form; `form-proposal.test.ts`
 * asserts that and it still holds.
 */

const SALON: AccessScope = { level: "salon", primaryAreaId: "loc-0101", alsoCoversAreaIds: [] };

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: "tpl-coaching-id",
    key: "coaching",
    name: "Coaching Form",
    shortName: "Coaching",
    description: "The everyday documented coaching conversation.",
    layoutFamily: "coaching",
    requiredPermission: "create_coaching_form",
    active: true,
    displayOrder: 1,
    currentVersion: { id: "v1", status: "published", variants: [] },
    draftVersion: null,
    versionCount: 1,
    activeAsset: null,
    assetCount: 0,
    ...overrides,
  };
}

/** The TSD plan as the published library carries it: one reading, the TSD's. */
const tsdEpp = (overrides: Record<string, unknown> = {}) =>
  summary({
    id: "tpl-tsd-epp-id",
    key: "tsd-epp",
    name: "TSD EPP",
    shortName: "TSD EPP",
    description: "Employee Performance Plan for a Training Salon Director.",
    layoutFamily: "epp",
    requiredPermission: "create_epp",
    displayOrder: 5,
    currentVersion: {
      id: "v2",
      status: "published",
      variants: [
        { key: "default", label: "TSD review", role: "District Manager", roleAbbr: "TSD" },
      ],
    },
    ...overrides,
  });

const sditEpp = () =>
  summary({
    id: "tpl-sdit-epp-id",
    key: "sdit-epp",
    name: "SDIT EPP",
    shortName: "SDIT EPP",
    description: "Employee Performance Plan for a Salon Director in training.",
    layoutFamily: "epp",
    requiredPermission: "create_epp",
    displayOrder: 4,
    currentVersion: {
      id: "v3",
      status: "published",
      variants: [
        { key: "default", label: "SDIT review", role: "Training Salon Director", roleAbbr: "SDIT" },
      ],
    },
  });

const fttcEpp = () =>
  summary({
    id: "tpl-fttc-epp-id",
    key: "fttc-epp",
    name: "FTTC Performance EPP",
    shortName: "FTTC",
    description: "Performance plan for a full-time tanning consultant.",
    layoutFamily: "epp",
    requiredPermission: "create_epp",
    displayOrder: 7,
    currentVersion: {
      id: "v1",
      status: "published",
      variants: [
        { key: "default", label: "FTTC review", role: "Salon Director", roleAbbr: "TC" },
      ],
    },
  });

let library: Record<string, unknown>[] = [];

async function load(summaries: Record<string, unknown>[]) {
  vi.resetModules();
  library = summaries;
  vi.doMock("@/lib/forms/repository", () => ({
    listTemplateSummaries: async () => {
      throw new Error("form-proposal must take the library from its caller");
    },
    getTemplateByKey: async () => {
      throw new Error("form-proposal must not read or write the library");
    },
  }));
  return import("./form-proposal");
}

function managerTurn(id: string, content: string): ChatMessage {
  return { id, role: "user", content, createdAt: "2026-09-21T12:00:00Z" };
}

function turn(question: string, history: ChatMessage[] = []) {
  return {
    history,
    question,
    questionMessageId: "msg-current",
    actor: { role: "district_manager" as never, scope: SALON },
    summaries: library as never,
  };
}

const LIBRARY = () => [summary(), sditEpp(), tsdEpp(), fttcEpp()];

function offered(response: {
  formSelection?: { primary: { templateName: string }; additional: { templateName: string }[] };
}): string[] {
  const selection = response.formSelection;
  if (!selection) return [];
  return [selection.primary.templateName, ...selection.additional.map((e) => e.templateName)];
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("@/lib/forms/repository");
  vi.resetModules();
});

/* ================================================================ naming == */

describe("every way a manager names this plan reaches the same workflow", () => {
  it.each([
    "TSD EPP",
    "create a TSD EPP",
    "TSD performance plan",
    "Training Salon Director EPP",
    "Training Salon Director performance plan",
    "Management Performance Plan for my TSD",
    "I need a TSD EPP for Sarah Johnson",
    "Create a TSD EPP from this conversation.",
  ])("resolves %j to the TSD plan", async (question) => {
    const proposals = await load(LIBRARY());
    const response = await proposals.proposeFormForTurn(turn(question));

    expect(response!.formProposal, question).toBeDefined();
    expect(response!.formProposal!.templateKey, question).toBe("tsd-epp");
    /* The name comes off the published row, never out of the sentence. */
    expect(response!.formProposal!.templateName, question).toBe("TSD EPP");
  });

  it("reads the form's own printed title as this document, not as the family", async () => {
    /*
     * "MANAGEMENT PERFORMANCE PLAN" IS WHAT IS ACROSS THE TOP OF THE PAPER.
     * It contains "performance plan", which is an EPP-family phrase, so
     * before this the manager who typed the form's own title got the picker
     * back and had to choose the document they had just named.
     */
    const { detectTemplateIntent } = await import("@/lib/forms/template-intent");
    expect(detectTemplateIntent("Create a Management Performance Plan")).toEqual({
      kind: "explicit",
      templateKey: "tsd-epp",
    });
  });

  it("does not read a management INTERVIEW as this plan", async () => {
    const { detectTemplateIntent } = await import("@/lib/forms/template-intent");
    expect(detectTemplateIntent("first round management interview")).toEqual({
      kind: "explicit",
      templateKey: "management-interview-round-1",
    });
  });

  it("pins the one reading the document prints, so no label says 'the employee'", async () => {
    const proposals = await load(LIBRARY());
    const response = await proposals.proposeFormForTurn(
      turn("Create a TSD EPP for Sarah Johnson"),
    );

    expect(response!.formProposal!.variantKey).toBe("default");
    expect(response!.formProposal!.supportsInlineDraft).toBe(true);
  });
});

/* ================================================== the family and a role == */

describe("'Employee Performance Plan' plus a role the manager already gave", () => {
  const SARAH = managerTurn(
    "m1",
    "Sarah is a TSD at Lincoln South. She's excellent at coaching her team and working with clients, but she's been late several times.",
  );

  it.each([
    "Create an Employee Performance Plan for Sarah",
    "Create an EPP from this conversation.",
    "Make an EPP for Sarah",
  ])("resolves %j to the TSD plan once the role is on the record", async (question) => {
    const proposals = await load(LIBRARY());
    const response = await proposals.proposeFormForTurn(turn(question, [SARAH]));

    expect(response!.formProposal, question).toBeDefined();
    expect(response!.formProposal!.templateKey, question).toBe("tsd-epp");
  });

  it("never guesses TSD from a generic request with no role stated", async () => {
    /*
     * THE RULE THIS WORKFLOW MUST NOT BREAK. Six published plans; naming the
     * family names none of them. Without a role in the manager's own words
     * the answer is the selector, and the TSD plan is one option among them.
     */
    const proposals = await load(LIBRARY());
    const response = await proposals.proposeFormForTurn(
      turn("Create an Employee Performance Plan.", [
        managerTurn("m1", "Sarah has been late several times this month."),
      ]),
    );

    expect(response!.formProposal).toBeUndefined();
    expect(response!.content).toMatch(/which form/i);
    expect(offered(response!)).toContain("TSD EPP");
    expect(offered(response!)).toContain("SDIT EPP");
  });

  it("carries the job title the manager stated onto the proposal", async () => {
    const proposals = await load(LIBRARY());
    const response = await proposals.proposeFormForTurn(turn("Make an EPP for Sarah", [SARAH]));

    expect(response!.formProposal!.employeeName).toBe("Sarah");
    /*
     * THE MANAGER'S OWN WORDS, NOT THE TEMPLATE'S. They wrote "TSD", so the
     * form's Job Title line reads TSD. Inferring "Training Salon Director"
     * from the template chosen would be a title printed on an employment
     * record because a form was picked.
     */
    expect(response!.formProposal!.employeeRole).toBe("TSD");
  });
});

/* ================================================================ intake == */

describe("the Ask Vicki-style intake, for a manager who has said nothing", () => {
  it("asks the concise eight when the manager clicked the card", async () => {
    const proposals = await load(LIBRARY());
    const response = await proposals.proposeFormForTurn(
      turn("Create a TSD EPP from this conversation."),
    );
    const content = response!.content;

    expect(content).toContain(
      "To create a Training Salon Director (TSD) Employee Performance Plan (EPP) form for you, I'll need a few details:",
    );
    for (const asked of [
      "The employee's full name",
      "The salon location",
      "The date for the form",
      "Where the manager is currently succeeding",
      "The biggest areas needing improvement",
      "The manager's productivity numbers",
      "The salon's current productivity numbers",
      "When the follow-up review should happen",
    ]) {
      expect(content, asked).toContain(asked);
    }
    expect(content).toContain("Please provide these details");
    expect(content).toContain("JB & Associates");
  });

  it("asks for those eight and nothing else", async () => {
    /*
     * NOT THE SDIT'S ELEVEN. The job title is not a question on the Training
     * Salon Director's own plan, and the nine expectation marks belong in the
     * review conversation rather than in an intake — reading a chat sentence
     * into nine tri-state marks is exactly the auto-marking this plan forbids.
     */
    const { TSD_EPP_INTAKE } = await import("@/lib/forms/epp-intake");
    expect(TSD_EPP_INTAKE.map((item) => item.key)).toEqual([
      "employee_name",
      "salon",
      "form_date",
      "succeeding",
      "needs_improvement",
      "employee_productivity",
      "salon_productivity",
      "follow_up",
    ]);

    const proposals = await load(LIBRARY());
    const content = (await proposals.proposeFormForTurn(
      turn("Create a TSD EPP from this conversation."),
    ))!.content;
    expect(content).not.toMatch(/job title/i);
    expect(content).not.toMatch(/there are nine/i);
    expect(content).not.toMatch(/expectations/i);
    /* Eight bullets, not eleven. */
    expect((content.match(/^- /gm) ?? []).length).toBe(8);
  });

  it("names the five metrics this plan actually has", async () => {
    const proposals = await load(LIBRARY());
    const content = (await proposals.proposeFormForTurn(
      turn("Create a TSD EPP from this conversation."),
    ))!.content;

    for (const metric of ["PPTA", "LPSVA", "UPTA", "Club Close", "Average Club Dollar"]) {
      expect(content, metric).toContain(metric);
    }
  });

  it("says the productivity numbers may be left blank", async () => {
    const proposals = await load(LIBRARY());
    const content = (await proposals.proposeFormForTurn(
      turn("Create a TSD EPP from this conversation."),
    ))!.content;

    expect(content).toMatch(/leave the productivity numbers blank/i);
    expect(content).toMatch(/won't hold the draft up/i);
  });

  it("leaves the SDIT plan's own intake exactly as it was", async () => {
    /*
     * THE APPROVED WORKFLOW IS FROZEN. A second plan sharing this module must
     * not move a word of the first one's opening.
     */
    const proposals = await load(LIBRARY());
    const content = (await proposals.proposeFormForTurn(
      turn("Create a SDIT EPP from this conversation."),
    ))!.content;

    expect(content).toContain(
      "For the **SDIT EPP**, I'll need a few details to create it for you:",
    );
    expect(content).toContain("there are seven");
    expect(content).not.toMatch(/leave the productivity numbers blank/i);
    expect(content).not.toContain("Club Close");
  });
});

/* ================================================= smarter than Ask Vicki == */

describe("what the conversation already answered is never asked again", () => {
  const SARAH = managerTurn(
    "m1",
    "Sarah is a TSD at Lincoln South. She's excellent with clients and coaching her team, but she's been late several times.",
  );

  it("drafts instead of re-asking when the context is already there", async () => {
    const proposals = await load(LIBRARY());
    const response = await proposals.proposeFormForTurn(
      turn("Create a TSD EPP.", [SARAH]),
    );

    expect(response!.formProposal!.templateKey).toBe("tsd-epp");
    expect(response!.content).not.toContain("I'll need a few details");
    expect(response!.content).toContain("I'll draft a **TSD EPP** for **Sarah**");
  });

  it("reads one natural-language answer in full", async () => {
    /*
     * THE WHOLE INTAKE IN ONE MESSAGE, which is how managers actually reply.
     * Nothing further is asked, and the two things the manager said they do
     * not have are recorded as answered rather than chased.
     */
    const { readEppIntake, TSD_EPP_PLAN } = await import("@/lib/forms/epp-intake");
    const reading = readEppIntake({
      text: "Sarah Johnson, Lincoln South, today. She's great with customers and coaching her team but has been late several times. I don't have productivity yet. Follow up in two weeks.",
      employeeKnown: true,
      salonSettled: true,
      plan: TSD_EPP_PLAN,
    });

    expect(reading.missing).toEqual([]);
    expect(reading.complete).toBe(true);
    expect(reading.nothingSupplied).toBe(false);
  });

  it("does not hold the plan up for productivity or a follow-up date", async () => {
    const { readEppIntake, TSD_EPP_PLAN } = await import("@/lib/forms/epp-intake");
    const reading = readEppIntake({
      text: "Sarah is a TSD at Lincoln South, great with clients, punctuality needs work. Today.",
      employeeKnown: true,
      salonSettled: true,
      plan: TSD_EPP_PLAN,
    });

    expect(reading.missingRequired.map((item) => item.key)).toEqual(["follow_up"]);
    expect(reading.missing.map((item) => item.key)).toContain("employee_productivity");
    expect(reading.missing.map((item) => item.key)).toContain("salon_productivity");

    const proposals = await load(LIBRARY());
    const response = await proposals.proposeFormForTurn(
      turn("Create a TSD EPP.", [
        managerTurn(
          "m1",
          "Sarah is a TSD at Lincoln South, great with clients, punctuality needs work. Today.",
        ),
      ]),
    );
    /* Named as open, never asked for, and the proposal is ready regardless. */
    expect(response!.formProposal!.status).toBe("ready");
    expect(response!.content).toMatch(/productivity numbers/);
    expect(response!.content).toMatch(/don't hold the plan up/);
  });

  it("calls the subject the manager, which is what the form calls them", async () => {
    const proposals = await load(LIBRARY());
    const response = await proposals.proposeFormForTurn(
      turn("Create a TSD EPP.", [
        managerTurn(
          "m1",
          "Sarah is a TSD at Lincoln South, great with clients, punctuality needs work. Today.",
        ),
      ]),
    );

    expect(response!.content).toContain("the manager's productivity numbers");
    expect(response!.content).not.toContain("the employee's productivity numbers");
  });

  it("stops for the employee, which is the one fact nothing downstream can undo", async () => {
    const proposals = await load(LIBRARY());
    const response = await proposals.proposeFormForTurn(
      turn("Create a TSD EPP", [
        managerTurn("m1", "One of my TSDs coaches well but keeps turning up late."),
      ]),
    );

    expect(response!.formProposal!.status).toBe("needs_employee");
    expect(response!.content).toMatch(/who is this \*\*TSD EPP\*\* for/i);
  });
});

/* ============================================================= permission == */

describe("the template's own permission still decides", () => {
  it("refuses a role that cannot create a performance plan, and substitutes nothing", async () => {
    const proposals = await load(LIBRARY());
    const response = await proposals.proposeFormForTurn({
      ...turn("Create a TSD EPP for Sarah Johnson"),
      actor: { role: "tanning_consultant" as never, scope: SALON },
    });

    expect(response!.formProposal).toBeUndefined();
    expect(response!.content).toMatch(/cannot create/i);
  });
});

/* ============================================================== proactive == */

describe("the forms a conversation is already about, offered unasked", () => {
  const brief = (content: string) => [managerTurn("m1", content)];

  async function suggest(question: string, history: ChatMessage[] = []) {
    const proposals = await load(LIBRARY());
    return proposals.suggestFormsForTurn(turn(question, history));
  }

  it("leads with the TSD plan when the role and a concern are both stated", async () => {
    const found = await suggest(
      "What should I do about this?",
      brief(
        "Sarah is a TSD at Lincoln South. She's excellent at coaching her team and working with customers, but she's been late several times.",
      ),
    );

    expect(found).not.toBeNull();
    expect(found!.lead).toBe("Based on what you've described, I can prepare:");
    expect(found!.selection.primary.templateName).toBe("TSD EPP");
    expect(found!.selection.additional.map((c) => c.templateName)).toEqual(["Coaching Form"]);
  });

  it("offers a short list, never the library", async () => {
    const found = await suggest(
      "How do I handle this?",
      brief("Sarah is a TSD, excellent at coaching but late several times."),
    );
    const names = [
      found!.selection.primary.templateName,
      ...found!.selection.additional.map((c) => c.templateName),
    ];
    expect(names).not.toContain("SDIT EPP");
    expect(names).not.toContain("FTTC Performance EPP");
  });

  it("says nothing about a passing mention, a bare role, or praise alone", async () => {
    expect(await suggest("Sarah is working Saturday.")).toBeNull();
    expect(await suggest("Sarah is a TSD.")).toBeNull();
    expect(await suggest("Sarah is great.")).toBeNull();
  });

  it("says nothing to a policy question", async () => {
    expect(await suggest("What is the attendance policy?")).toBeNull();
  });

  it("hands a chosen card back through the same engine a typed request uses", async () => {
    /*
     * THE PROPERTY THAT KEEPS ONE ENGINE. A card sends
     * `formRequestPhrase(name)`, and that sentence has to resolve to the same
     * template, the same variant and the same proposal a manager typing it
     * would get — otherwise the proactive path is a second implementation.
     */
    const history = brief(
      "Sarah is a TSD at Lincoln South. She's excellent at coaching her team and working with customers, but she's been late several times.",
    );
    const suggested = await suggest("What should I do about this?", history);

    const { formRequestPhrase } = await import("@/lib/forms/template-intent");
    const proposals = await load(LIBRARY());
    const chosen = await proposals.proposeFormForTurn(
      turn(formRequestPhrase(suggested!.selection.primary.templateName), history),
    );

    expect(chosen!.formProposal!.templateKey).toBe("tsd-epp");
    expect(chosen!.formProposal!.variantKey).toBe("default");
    expect(chosen!.formProposal!.employeeName).toBe("Sarah");
    expect(chosen!.formProposal!.employeeRole).toBe("TSD");
    /*
     * READY AND INLINE-DRAFTABLE, which is what lets the card click open the
     * draft rather than put the intake the manager just answered back in
     * front of them.
     */
    expect(chosen!.formProposal!.status).toBe("ready");
    expect(chosen!.formProposal!.supportsInlineDraft).toBe(true);
    expect(chosen!.content).not.toContain("I'll need a few details");
  });
});
