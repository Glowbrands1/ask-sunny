import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * REQUIREMENTS 37–43 — WHAT HAS TO BE TRUE BEFORE A PROPOSAL EXISTS
 * ============================================================================
 *
 * `proposal.ts` reads a conversation. This layer decides whether what it read
 * corresponds to a form THIS PERSON MAY ACTUALLY CREATE, and it is the layer
 * the prototype had nothing at all in place of: `detectTemplate` returned an
 * invented `tpl-coaching` id that no published template answered to, and
 * `publishedTemplateKeyFor` mapped it across afterwards.
 *
 * NOTHING HERE WRITES. Asserted, not assumed — see requirement 42.
 */

const SALON: AccessScope = {
  level: "salon",
  primaryAreaId: "loc-0101",
  alsoCoversAreaIds: [],
};

function template(overrides: Record<string, unknown> = {}) {
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
    currentVersion: { id: "v1", status: "published" },
    draftVersion: null,
    versionCount: 1,
    activeAsset: null,
    assetCount: 0,
    ...overrides,
  };
}

function dpoa(overrides: Record<string, unknown> = {}) {
  return template({
    id: "tpl-dpoa-id",
    key: "dpoa",
    name: "Disciplinary Plan of Action",
    shortName: "DPOA",
    description: "The formal corrective step after coaching.",
    layoutFamily: "corrective",
    requiredPermission: "create_corrective_action",
    displayOrder: 2,
    ...overrides,
  });
}

function epp(overrides: Record<string, unknown> = {}) {
  return template({
    id: "tpl-sdit-epp-id",
    key: "sdit-epp",
    name: "SDIT EPP",
    shortName: "SDIT EPP",
    description: "Employee Performance Plan for a Salon Director in training.",
    layoutFamily: "epp",
    requiredPermission: "create_epp",
    displayOrder: 4,
    ...overrides,
  });
}

async function load(summaries: Record<string, unknown>[]) {
  vi.resetModules();
  const calls: string[] = [];

  vi.doMock("@/lib/forms/repository", () => ({
    listTemplateSummaries: async () => {
      calls.push("listTemplateSummaries");
      return summaries;
    },
    // Deliberately present and deliberately throwing: if this layer ever starts
    // writing, the test that catches it is the one that failed to mock a write.
    getTemplateByKey: async () => {
      throw new Error("form-proposal must read the library once, through listTemplateSummaries");
    },
  }));

  const proposals = await import("./form-proposal");
  return { proposals, calls };
}

function turn(
  question: string,
  options: { role?: string | null; scope?: AccessScope | null; history?: ChatMessage[] } = {},
) {
  return {
    history: options.history ?? [],
    question,
    questionMessageId: "msg-current",
    actor: {
      role: (options.role === undefined ? "salon_director" : options.role) as never,
      scope: options.scope === undefined ? SALON : options.scope,
    },
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("@/lib/forms/repository");
  vi.resetModules();
});

/* ============================================================ the happy == */

describe("37. an explicit, published, permitted template becomes a proposal", () => {
  it("names the template from the LIBRARY, not from the sentence", async () => {
    const { proposals } = await load([template(), dpoa()]);
    const response = await proposals.proposeFormForTurn(
      turn("I need a coaching form for Sarah Jones"),
    );

    expect(response).not.toBeNull();
    expect(response!.formProposal).toBeDefined();
    expect(response!.formProposal!.templateKey).toBe("coaching");
    // The published name, which is what will appear on the document — never a
    // label this module made up.
    expect(response!.formProposal!.templateName).toBe("Coaching Form");
    expect(response!.formProposal!.employeeName).toBe("Sarah Jones");
    expect(response!.formProposal!.locationId).toBe("loc-0101");
    expect(response!.formProposal!.status).toBe("ready");
  });
});

/* ==================================================== template validation == */

describe("38. a named template the library does not publish is refused, not substituted", () => {
  it.each([
    ["absent from the library", [dpoa()]],
    ["present but inactive", [template({ active: false }), dpoa()]],
    ["present but never published", [template({ currentVersion: null }), dpoa()]],
    ["present with only a draft version", [template({ currentVersion: { id: "v1", status: "draft" } }), dpoa()]],
  ])("%s", async (_name, summaries) => {
    const { proposals } = await load(summaries);
    const response = await proposals.proposeFormForTurn(
      turn("I need a coaching form for Sarah Jones"),
    );

    expect(response).not.toBeNull();
    // No proposal at all: a card with no validated template behind it is a
    // frame around nothing.
    expect(response!.formProposal).toBeUndefined();
    expect(response!.content).toMatch(/not published/i);
    // And specifically NOT quietly answered with the other form that is.
    expect(response!.content).not.toMatch(/here is what I would put on/i);
  });
});

/* ========================================================== permissions == */

describe("39. the TEMPLATE's own permission decides, and chat cannot widen it", () => {
  it("refuses a DPOA to a role that cannot create corrective action", async () => {
    const { proposals } = await load([template(), dpoa()]);
    // An Assistant Salon Director holds `create_coaching` — which is a
    // different permission from `create_coaching_form` — and no form
    // permission at all.
    const response = await proposals.proposeFormForTurn(
      turn("write a DPOA for Sarah Jones", { role: "assistant_salon_director" }),
    );

    expect(response!.formProposal).toBeUndefined();
    expect(response!.content).toMatch(/your role cannot create/i);
  });

  it("refuses everything to an actor with no role at all", async () => {
    const { proposals } = await load([template(), dpoa()]);
    const response = await proposals.proposeFormForTurn(
      turn("coaching form for Sarah Jones", { role: null }),
    );
    expect(response!.formProposal).toBeUndefined();
  });

  it("allows a Salon Director the forms they already hold", async () => {
    const { proposals } = await load([template(), dpoa()]);
    const response = await proposals.proposeFormForTurn(
      turn("write a DPOA for Sarah Jones", { role: "salon_director" }),
    );
    expect(response!.formProposal!.templateKey).toBe("dpoa");
  });

  it("lists only what the asking role may actually create", async () => {
    const { proposals } = await load([template(), dpoa(), epp()]);
    const response = await proposals.proposeFormForTurn(
      // Ambiguous, so the answer is the list.
      turn("can you create a form for me", { role: "salon_director" }),
    );

    expect(response!.content).toContain("Coaching Form");
    expect(response!.content).toContain("Disciplinary Plan of Action");
    // A Salon Director does not hold `create_epp`, so offering it would be an
    // invitation to a refusal.
    expect(response!.content).not.toContain("SDIT EPP");
  });
});

/* ============================================================ ambiguity == */

describe("40. an ambiguous request produces a question, never a default", () => {
  it("returns no proposal and does not reach for the Coaching Form", async () => {
    const { proposals } = await load([template(), dpoa()]);
    const response = await proposals.proposeFormForTurn(turn("create a form for Sarah Jones"));

    expect(response!.formProposal).toBeUndefined();
    expect(response!.content).toMatch(/which form do you need/i);
    // The regression in one line: this must not have become a coaching form.
    expect(response!.content).not.toMatch(/here is what I would put on/i);
  });

  it("says so plainly when the role may create nothing", async () => {
    const { proposals } = await load([template(), dpoa()]);
    const response = await proposals.proposeFormForTurn(
      turn("create a form", { role: "employee" }),
    );

    expect(response!.formProposal).toBeUndefined();
    expect(response!.content).toMatch(/no published forms available to you/i);
  });
});

/* ====================================================== not a form turn == */

describe("41. a question that is not a form request falls through untouched", () => {
  it.each([
    "what is the tardiness policy?",
    "how do I coach someone who keeps arriving late?",
  ])("%s", async (question) => {
    const { proposals, calls } = await load([template()]);
    const response = await proposals.proposeFormForTurn(turn(question));

    // null, so `answerQuestion` continues to retrieval and Claude.
    expect(response).toBeNull();
    // And the template library was not even read: a knowledge question costs
    // nothing extra.
    expect(calls).toEqual([]);
  });
});

/* ======================================================= nothing is written == */

describe("42. a proposal creates nothing", () => {
  it("never touches the instances module", async () => {
    const source = (await import("node:fs")).readFileSync("src/lib/ai/form-proposal.ts", "utf8");

    expect(source).not.toContain("createInstance");
    expect(source).not.toContain("forms/instances");
    expect(source).not.toContain("getSupabaseAdmin");
    // No PDF, no finalize, no follow-up scheduling either.
    expect(source).not.toMatch(/finalize|renderPdf|follow_up/i);
  });

  it("returns no field values, no handoff and no pending bag", async () => {
    const { proposals } = await load([template()]);
    const response = await proposals.proposeFormForTurn(
      turn("coaching form for Sarah Jones about attendance"),
    );

    expect(Object.keys(response!)).not.toContain("formHandoff");
    expect(Object.keys(response!)).not.toContain("pendingFormTemplateId");
    expect(Object.keys(response!)).not.toContain("pendingFormValues");
    expect(response!.citations).toEqual([]);
    expect(response!.recommendedVideoIds).toEqual([]);
  });

  it("tells the manager plainly that nothing has been created", async () => {
    const { proposals } = await load([template()]);
    const response = await proposals.proposeFormForTurn(
      turn("coaching form for Sarah Jones"),
    );
    expect(response!.content).toMatch(/nothing has been created/i);
  });
});

describe("43. the proposal id is the server's, not the caller's", () => {
  it("differs between two identical requests", async () => {
    const { proposals } = await load([template()]);
    const first = await proposals.proposeFormForTurn(turn("coaching form for Sarah Jones"));
    const second = await proposals.proposeFormForTurn(turn("coaching form for Sarah Jones"));

    expect(first!.formProposal!.proposalId).not.toBe(second!.formProposal!.proposalId);
  });

  it("is not read from the request", async () => {
    const source = (await import("node:fs")).readFileSync("src/lib/ai/form-proposal.ts", "utf8");
    expect(source).toContain("randomUUID()");
    expect(source).not.toMatch(/input\.proposalId|body\.proposalId/);
  });
});
