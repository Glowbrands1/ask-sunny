import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * THE SDIT EPP, ASKED FOR THE WAY MANAGERS ACTUALLY ASK
 * ============================================================================
 *
 * One workflow, reached six ways: by the document's name, by the family plus a
 * role the manager already stated, and by the rail button that sends
 * `formRequestPhrase`. Every route lands on the SAME proposal — same template
 * key, same variant, same intake — and that sameness is what this file is
 * about, because a second way in is a second thing to keep correct.
 *
 * WHAT IS NOT TESTED HERE is anything that writes. `proposeFormForTurn` creates
 * nothing; `form-proposal.test.ts` asserts that and it still holds.
 */

const SALON: AccessScope = { level: "salon", primaryAreaId: "loc-0101", alsoCoversAreaIds: [] };

/** The SDIT EPP as the published library actually carries it: one reading. */
const SDIT_VARIANTS = [
  { key: "default", label: "SDIT review", role: "Training Salon Director", roleAbbr: "ASD" },
];

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

const sditEpp = (overrides: Record<string, unknown> = {}) =>
  summary({
    id: "tpl-sdit-epp-id",
    key: "sdit-epp",
    name: "SDIT EPP",
    shortName: "SDIT EPP",
    description: "Employee Performance Plan for a Salon Director in training.",
    layoutFamily: "epp",
    requiredPermission: "create_epp",
    displayOrder: 4,
    currentVersion: { id: "v1", status: "published", variants: SDIT_VARIANTS },
    ...overrides,
  });

const tsdEpp = () =>
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
      id: "v1",
      status: "published",
      variants: [
        { key: "default", label: "TSD review", role: "District Manager", roleAbbr: "SD" },
      ],
    },
  });

/** Two readings of one document: which review is a real question. */
const dmitEpp = () =>
  summary({
    id: "tpl-dmit-epp-id",
    key: "dmit-epp-tsd",
    name: "DMIT EPP — TSD Review",
    shortName: "DMIT / TSD",
    description: "The TSD reading of the DMIT Employee Performance Plan.",
    layoutFamily: "dmit_epp",
    requiredPermission: "create_epp",
    displayOrder: 8,
    currentVersion: {
      id: "v1",
      status: "published",
      variants: [
        { key: "tsd", label: "TSD review", role: "District Manager", roleAbbr: "TSD" },
        { key: "dmit", label: "DMIT review", role: "District Manager", roleAbbr: "DMIT" },
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

const LIBRARY = () => [summary(), sditEpp(), tsdEpp(), dmitEpp()];

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

describe("every way a manager names this form reaches the same workflow", () => {
  it.each([
    "SDIT EPP",
    "SDIT EPP form",
    "Form for SDIT EPP",
    "Create an SDIT EPP",
    "Make an SDIT EPP for Jessica Vance",
    "I need an SDIT performance plan for Jessica Vance",
    "Create a SDIT EPP from this conversation.",
  ])("resolves %j to the SDIT EPP", async (question) => {
    const proposals = await load(LIBRARY());
    const response = await proposals.proposeFormForTurn(turn(question));

    expect(response!.formProposal, question).toBeDefined();
    expect(response!.formProposal!.templateKey, question).toBe("sdit-epp");
    // The name comes off the published row, never out of the sentence.
    expect(response!.formProposal!.templateName, question).toBe("SDIT EPP");
  });

  it("pins the one reading the document prints, so no label says 'the employee'", async () => {
    const proposals = await load(LIBRARY());
    const response = await proposals.proposeFormForTurn(
      turn("Create an SDIT EPP for Jessica Vance"),
    );

    expect(response!.formProposal!.variantKey).toBe("default");
    expect(response!.formProposal!.supportsInlineDraft).toBe(true);
  });

  it("still refuses a plan with two readings, because which review is a question", async () => {
    const proposals = await load(LIBRARY());
    const response = await proposals.proposeFormForTurn(
      turn("Create a DMIT EPP — TSD review for Jessica Vance"),
    );

    expect(response!.formProposal!.templateKey).toBe("dmit-epp-tsd");
    expect(response!.formProposal!.variantKey).toBeNull();
    expect(response!.formProposal!.supportsInlineDraft).toBe(false);
    expect(response!.content).toMatch(/nothing has been created/i);
  });
});

/* ================================================== the family and a role == */

describe("'Employee Performance Plan' plus a role the manager already gave", () => {
  const JESSICA = managerTurn(
    "m1",
    "Jessica Vance is an SDIT at Lincoln South. She's great with clients but she's been late several times this month.",
  );

  it.each([
    "Employee Performance Plan",
    "Employee performance plan form",
    "Form for employee performance plan",
    "Create an employee performance plan",
    "Create an EPP from this conversation.",
    "Make an EPP for Jessica Vance",
  ])("resolves %j to the SDIT plan once the role is on the record", async (question) => {
    const proposals = await load(LIBRARY());
    const response = await proposals.proposeFormForTurn(turn(question, [JESSICA]));

    expect(response!.formProposal, question).toBeDefined();
    expect(response!.formProposal!.templateKey, question).toBe("sdit-epp");
  });

  it("carries the job title the manager stated onto the proposal", async () => {
    const proposals = await load(LIBRARY());
    const response = await proposals.proposeFormForTurn(
      turn("Make an EPP for Jessica Vance", [JESSICA]),
    );

    expect(response!.formProposal!.employeeName).toBe("Jessica Vance");
    expect(response!.formProposal!.employeeRole).toBe("SDIT");
  });

  it("asks which plan when no role was ever stated", async () => {
    /*
     * THE RULE THIS WORKFLOW MUST NOT BREAK. Six published plans; naming the
     * family names none of them. Without a role in the manager's own words the
     * answer is the selector, exactly as it was.
     */
    const proposals = await load(LIBRARY());
    const response = await proposals.proposeFormForTurn(
      turn("I need an employee performance plan", [
        managerTurn("m1", "Jessica Vance has been late several times this month."),
      ]),
    );

    expect(response!.formProposal).toBeUndefined();
    expect(response!.content).toMatch(/which form/i);
    expect(offered(response!)).toContain("SDIT EPP");
    expect(offered(response!)).toContain("TSD EPP");
  });

  it("asks which plan when the conversation named two roles", async () => {
    const proposals = await load(LIBRARY());
    const response = await proposals.proposeFormForTurn(
      turn("create an EPP", [
        managerTurn("m1", "Jessica is an SDIT and Marco is a TSD at the same salon."),
      ]),
    );

    expect(response!.formProposal).toBeUndefined();
    expect(response!.content).toMatch(/which form/i);
  });

  it("never reads the role out of an assistant turn", async () => {
    const proposals = await load(LIBRARY());
    const response = await proposals.proposeFormForTurn(
      turn("create an EPP for Jessica Vance", [
        managerTurn("m1", "Jessica Vance has been late several times."),
        {
          id: "a1",
          role: "assistant",
          content: "Jessica sounds like an SDIT — shall I open an SDIT EPP?",
          createdAt: "2026-09-21T12:01:00Z",
        },
      ]),
    );

    expect(response!.formProposal).toBeUndefined();
    expect(response!.content).toMatch(/which form/i);
  });
});

/* ================================================================ intake == */

describe("the intake asks for what is missing and nothing else", () => {
  it("asks the full list when the manager clicked the card and said nothing", async () => {
    const proposals = await load(LIBRARY());
    const response = await proposals.proposeFormForTurn(
      turn("Create a SDIT EPP from this conversation."),
    );

    expect(response!.content).toContain(
      "For the **SDIT EPP**, I'll need a few details to create it for you:",
    );
    expect(response!.content).toContain("The employee's full name");
    expect(response!.content).toContain("there are seven");
    expect(response!.content).toContain("JB & Associates");
  });

  it("does not restart the intake when the conversation already answered most of it", async () => {
    const proposals = await load(LIBRARY());
    const response = await proposals.proposeFormForTurn(
      turn("Create an EPP from this conversation.", [
        managerTurn(
          "m1",
          "Jessica Vance is an SDIT at Lincoln South. She's great with clients but she's been late several times this month. We'll re-evaluate the week of October 5.",
        ),
      ]),
    );

    expect(response!.formProposal!.templateKey).toBe("sdit-epp");
    expect(response!.content).not.toContain("I'll need a few details");
    expect(response!.content).toContain("I'll draft a **SDIT EPP** for **Jessica Vance**");
  });

  it("names the optional gaps and says they do not hold the plan up", async () => {
    const proposals = await load(LIBRARY());
    const response = await proposals.proposeFormForTurn(
      turn("Create an EPP from this conversation.", [
        managerTurn(
          "m1",
          "Jessica Vance is an SDIT at Lincoln South, great with clients, punctuality needs work. Today. We'll re-evaluate the week of October 5.",
        ),
      ]),
    );

    expect(response!.content).toMatch(/productivity numbers/);
    expect(response!.content).toMatch(/don't hold the plan up/);
    // Naming a gap is not asking for it: no question mark is put to the manager.
    expect(response!.content).not.toMatch(/what (are|is) (her|his|their|the) productivity/i);
  });

  it("stops for the employee, which is the one fact nothing downstream can undo", async () => {
    const proposals = await load(LIBRARY());
    const response = await proposals.proposeFormForTurn(
      turn("Create an SDIT EPP", [
        managerTurn("m1", "Someone on my team is great with clients but keeps turning up late."),
      ]),
    );

    expect(response!.formProposal!.status).toBe("needs_employee");
    expect(response!.content).toMatch(/who is this \*\*SDIT EPP\*\* for/i);
  });
});

/* ============================================================ permission == */

describe("the template's own permission still decides", () => {
  it("refuses a role that cannot create a performance plan, and substitutes nothing", async () => {
    const proposals = await load(LIBRARY());
    const response = await proposals.proposeFormForTurn({
      ...turn("Create an SDIT EPP for Jessica Vance"),
      actor: { role: "tanning_consultant" as never, scope: SALON },
    });

    expect(response!.formProposal).toBeUndefined();
    expect(response!.content).toMatch(/cannot create/i);
    expect(response!.content).not.toMatch(/here is what I put on/i);
  });
});
