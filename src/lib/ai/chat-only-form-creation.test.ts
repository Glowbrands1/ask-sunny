import { describe, expect, it, vi } from "vitest";

import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * ASK SUNNY IS THE ONLY PLACE A FORM IS STARTED
 * ============================================================================
 *
 * The standalone Create a Form screen was removed. These are the requests a
 * manager types instead, run through the real proposal path: each one must be
 * understood, carried to an inline draft in the conversation, and never sent
 * to a screen that no longer exists.
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
    name: "Corrective Action Form",
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

/**
 * The library snapshot the turn under test carries.
 *
 * `proposeFormForTurn` no longer reads the library itself — `answerQuestion`
 * reads it ONCE per turn and passes the same rows to the proposal, to the
 * inventory the prompt is given, and to any inventory answer. Two reads could
 * land either side of a publish, and then a proposal card would offer a form
 * the sentence beside it said did not exist.
 *
 * Held in a module-scoped variable so every existing `turn(...)` call keeps
 * working unchanged: `load()` sets it, `turn()` attaches it.
 */
let library: Record<string, unknown>[] = [];

async function load(summaries: Record<string, unknown>[]) {
  vi.resetModules();
  library = summaries;
  const calls: string[] = [];

  /*
   * BOTH READS THROW. This module is now a pure function of what it was given:
   * if it ever reaches for the library or starts writing, these are what say so
   * rather than a silently different answer.
   */
  vi.doMock("@/lib/forms/repository", () => ({
    listTemplateSummaries: async () => {
      calls.push("listTemplateSummaries");
      throw new Error("form-proposal must take the library from its caller, not read it");
    },
    getTemplateByKey: async () => {
      throw new Error("form-proposal must not read or write the library");
    },
  }));

  const proposals = await import("@/lib/ai/form-proposal");
  return { proposals, calls };
}

function turn(
  question: string,
  options: {
    role?: string | null;
    scope?: AccessScope | null;
    history?: ChatMessage[];
    continueTemplateKey?: string;
  } = {},
) {
  return {
    history: options.history ?? [],
    question,
    questionMessageId: "msg-current",
    actor: {
      role: (options.role === undefined ? "salon_director" : options.role) as never,
      scope: options.scope === undefined ? SALON : options.scope,
    },
    summaries: library as never,
    ...(options.continueTemplateKey ? { continueTemplateKey: options.continueTemplateKey } : {}),
  };
}


function policyReview(o: Record<string, unknown> = {}) {
  return template({ id: "tpl-pr-id", key: "policy-review", name: "Policy Review", shortName: "Policy Review",
    description: "Review of a policy.", layoutFamily: "policy", requiredPermission: "create_policy_review", displayOrder: 3, ...o });
}
function followUp(o: Record<string, unknown> = {}) {
  return template({ id: "tpl-fu-id", key: "follow-up-coaching", name: "Follow-up Coaching Form", shortName: "Follow-up",
    description: "Follow-up.", layoutFamily: "coaching", requiredPermission: "create_coaching_form", displayOrder: 5, ...o });
}
function tsd(o: Record<string, unknown> = {}) {
  return template({ id: "tpl-tsd-id", key: "tsd-epp", name: "TSD EPP", shortName: "TSD EPP",
    description: "TSD plan.", layoutFamily: "epp", requiredPermission: "create_epp", displayOrder: 6, ...o });
}
const LIBRARY = () => [template(), dpoa(), policyReview(), followUp(), epp(), tsd()];

const INLINE: [question: string, templateKey: string, employee: string, role: string][] = [
  ["Create a coaching form for Jane Smith", "coaching", "Jane Smith", "salon_director"],
  ["Create a corrective action form for Jane Smith", "dpoa", "Jane Smith", "salon_director"],
  ["Create a policy review for Jane Smith", "policy-review", "Jane Smith", "salon_director"],
  ["Start a policy review for John", "policy-review", "John", "salon_director"],
  ["Create a follow-up coaching form for Jane Smith", "follow-up-coaching", "Jane Smith", "salon_director"],
  ["Create an SDIT EPP for Jane Smith", "sdit-epp", "Jane Smith", "district_manager"],
  ["Create a TSD EPP for Jane Smith", "tsd-epp", "Jane Smith", "district_manager"],
];

describe("a form request typed into Ask Sunny", () => {
  it.each(INLINE)("%s → an inline %s draft", async (question, templateKey, employee, role) => {
    const { proposals } = await load(LIBRARY());
    const response = await proposals.proposeFormForTurn(turn(question, { role }));

    expect(response!.formProposal!.templateKey).toBe(templateKey);
    expect(response!.formProposal!.supportsInlineDraft).toBe(true);
    expect(response!.formProposal!.employeeName).toBe(employee);
    expect(response!.content).toMatch(/create the draft here/i);
    expect(response!.content).not.toMatch(/Create a Form|Start the form there/);
    expect(response!.content).not.toContain("/forms/create");
  });

  it("keeps the tolerant reading of lower-case names, dates and details", async () => {
    const { proposals } = await load(LIBRARY());
    const response = await proposals.proposeFormForTurn(
      turn("create a coaching form for jane smith, she was late on 9/24"),
    );

    expect(response!.formProposal!.templateKey).toBe("coaching");
    expect(response!.formProposal!.employeeName?.toLowerCase()).toBe("jane smith");
    expect(response!.formProposal!.formDate).toMatch(/^\d{4}-09-24$/);
  });

  it("asks for what is missing, in the conversation, when only the form is named", async () => {
    const { proposals } = await load(LIBRARY());
    const response = await proposals.proposeFormForTurn(turn("Create a corrective action form"));

    expect(response!.formProposal!.templateKey).toBe("dpoa");
    expect(response!.content).toMatch(/Employee's full name/);
    expect(response!.content).not.toMatch(/Create a Form/);
  });

  it("still refuses a form the role may not create", async () => {
    const { proposals } = await load(LIBRARY());
    const response = await proposals.proposeFormForTurn(
      turn("Create an SDIT EPP for Jane Smith", { role: "salon_director" }),
    );

    expect(response!.formProposal).toBeUndefined();
    expect(response!.content).toMatch(/Your role cannot create/);
  });
});
