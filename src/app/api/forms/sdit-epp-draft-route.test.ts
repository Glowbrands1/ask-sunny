import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseFormDocument } from "@/lib/forms/document";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";

/**
 * ============================================================================
 * DRAFTING AN SDIT EPP, EXERCISED RATHER THAN READ
 * ============================================================================
 *
 * Same harness as `pm-draft-route.test.ts` and for the same reason: the
 * guarantees here are about WHAT THE MODEL WAS SENT and WHAT REACHED THE
 * WRITE, and a source scan cannot answer either. A mutation that flipped a
 * condition rather than deleting a call would pass a scan while disabling the
 * guard.
 *
 * The manual below is the real JB & Associates Employment Policy Manual's
 * shape — its headings, on the pages it prints them — so "punctuality reaches
 * Attendance on page 14" is checkable rather than asserted.
 */

const state = vi.hoisted(() => ({
  modelInput: null as Record<string, unknown> | null,
  modelCalls: 0,
  toolInput: {} as Record<string, unknown>,
  roleResults: {} as Record<string, unknown>,
  persisted: [] as {
    values: Record<string, string>;
    checked: Record<string, string[]>;
    provenance: Record<string, Record<string, unknown>>;
  }[],
  policyHits: [] as unknown[],
  policySearches: [] as { query: string }[],
  policyManual: null as unknown,
  employeeRole: "SDIT" as string | null,
}));

vi.mock("@/lib/api/respond", () => ({
  assertLiveMode: () => {},
  assertNoConfigurationProblems: () => {},
  assertWithinRateLimit: () => {},
  errorResponse: (error: unknown) => {
    throw error;
  },
}));

vi.mock("@/lib/forms/instance-scope", () => ({
  InstanceNotVisibleError: class InstanceNotVisibleError extends Error {},
  authorizeInstance: async () => {
    const seed = TEMPLATE_SEEDS.find((entry) => entry.key === "sdit-epp")!;
    return {
      actor: { id: "demo:district_manager:QA", role: "district_manager", verified: false, scope: null },
      loaded: {
        instance: {
          id: "form-1",
          templateKey: seed.key,
          templateName: seed.name,
          layoutFamily: seed.layoutFamily,
          variantKey: seed.variants[0]!.key,
          employeeName: "Paulyne Co (test)",
          employeeRole: state.employeeRole,
          locationName: "MO Kansas City Wornall",
          formDate: "2026-09-21",
          status: "draft",
        },
        version: {
          document: parseFormDocument(seed.document),
          variants: seed.variants,
        },
      },
    };
  },
}));

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    async fetchRoleGrounding(role: { id: string }) {
      return state.roleResults[role.id] ?? null;
    }
    async fetchOfficialPolicyManual() {
      return (
        state.policyManual ?? {
          ok: false,
          reason: "The official policy manual is not in the knowledge base.",
        }
      );
    }
  },
}));

vi.mock("@/lib/knowledge", () => ({
  getKnowledgeProvider: () => ({
    search: async (input: { query: string }) => {
      state.policySearches.push(input);
      return state.policyHits;
    },
  }),
}));

vi.mock("@/lib/forms/instances", () => ({
  applyAssistantDraft: async (
    _id: string,
    draft: { values: Record<string, string>; checked: Record<string, string[]> },
    _actor: string,
    provenance: Record<string, Record<string, unknown>> = {},
  ) => {
    state.persisted.push({
      values: draft.values ?? {},
      checked: draft.checked ?? {},
      provenance,
    });
    return {
      accepted: { values: draft.values ?? {}, checked: draft.checked ?? {} },
      rejected: [],
      policyRefused: [],
    };
  },
}));

vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (input: Record<string, unknown>) => {
        state.modelCalls += 1;
        state.modelInput = input;
        return {
          content: [{ type: "tool_use", name: "write_form_fields", input: state.toolInput }],
        };
      },
    },
  }),
}));

/* ------------------------------------------------------------- fixtures -- */

const PROGRESSION_ID = "performance_management_framework";

function healthyProgression() {
  return {
    ok: true as const,
    grounding: {
      role: { id: PROGRESSION_ID },
      documentId: "doc-progression",
      documentTitle: "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
      matchedBy: "tag" as const,
      rows: [
        {
          chunk_id: "pmf-0",
          document_id: "doc-progression",
          document_title: "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
          category: "leadership_coaching",
          locator: "SECTION 5 – EPP FRAMEWORK",
          page: null,
          section: null,
          content: "An EPP is a development plan with measurable objectives and a scheduled review.",
          similarity: 0,
        },
      ],
      presentGroups: ["escalation_ladder"],
    },
  };
}

function manualChunk(
  chunkIndex: number,
  printedPage: number,
  sections: { heading: string; page: number }[],
  content: string,
) {
  return { chunkIndex, page: printedPage + 1, printedPage, sections, content };
}

/** The pinned JBA manual, in the shape `fetchOfficialPolicyManual` returns. */
function jbaManual() {
  return {
    ok: true as const,
    documentId: "doc-jba",
    documentTitle: "JBA Policy Manual Edited 5.2025",
    matchedBy: "fallback" as const,
    chunks: [
      manualChunk(
        0,
        7,
        [{ heading: "Our Culture", page: 7 }],
        "Our Culture\nEvery employee contributes to a positive, professional environment for clients.",
      ),
      manualChunk(
        1,
        12,
        [{ heading: "Standards of Conduct", page: 12 }],
        "Standards of Conduct\nThe following infractions may result in disciplinary action.",
      ),
      manualChunk(
        2,
        14,
        [{ heading: "Attendance", page: 14 }],
        "Attendance\nEmployees are expected to know their schedule and always be on time and ready to work.",
      ),
      manualChunk(
        3,
        15,
        [{ heading: "Late Opening", page: 15 }],
        "Late Opening\nA location that opens late costs the company business.",
      ),
      manualChunk(
        4,
        36,
        [{ heading: "Time Records", page: 36 }],
        "Time Records\nEmployees record their own time accurately at the start and end of every shift.",
      ),
      manualChunk(
        5,
        37,
        [
          { heading: "Schedule Requests/General availability Changes", page: 37 },
          { heading: "Shift Replacement", page: 37 },
        ],
        "Schedule Requests/General availability Changes\nRequests are submitted in advance.\nShift Replacement\nAn employee who cannot work a scheduled shift arranges cover.",
      ),
    ],
  };
}

async function post(notes: string) {
  const { POST } = await import("./instances/[id]/draft/route");
  const request = new Request("http://localhost/api/forms/instances/form-1/draft", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ notes }),
  });
  const response = await POST(request, { params: Promise.resolve({ id: "form-1" }) });
  return (await response.json()) as Record<string, unknown>;
}

const prompt = () =>
  ((state.modelInput?.messages as { content: string }[] | undefined)?.[0]?.content ?? "");
const systemPrompt = () => String(state.modelInput?.system ?? "");
const written = () => state.persisted.at(-1)!;

const PUNCTUALITY =
  "Paulyne is doing well with customers but needs to improve punctuality. She has been late several times this month.";

beforeEach(() => {
  vi.resetModules();
  state.modelInput = null;
  state.modelCalls = 0;
  state.toolInput = {};
  state.roleResults = { [PROGRESSION_ID]: healthyProgression() };
  state.persisted = [];
  state.policyHits = [];
  state.policySearches = [];
  state.policyManual = jbaManual();
  state.employeeRole = "SDIT";
});

/* ==================================================== JBA reaches the draft */

describe("the JB & Associates manual is what the plan is reasoned against", () => {
  it("puts the Attendance section, with its printed page, in front of the model", async () => {
    await post(PUNCTUALITY);

    expect(state.modelCalls).toBe(1);
    expect(prompt()).toContain("APPLICABLE COMPANY POLICY — JBA Policy Manual");
    expect(prompt()).toContain("Attendance — Page 14");
    expect(prompt()).toContain("always be on time and ready to work");
    expect(prompt()).toContain("Time Records — Page 36");
  });

  it("retrieves only what the manager reported, never the whole manual", async () => {
    await post("Paulyne needs to improve punctuality. She has been late several times this month.");

    // Attendance was raised and is sent. The manual's conduct and culture
    // sections were not, so they are not — an EPP is not a review of
    // everything the company has written down.
    expect(prompt()).toContain("Attendance — Page 14");
    expect(prompt()).not.toContain("Standards of Conduct");
    expect(prompt()).not.toContain("Our Culture");
  });

  it("sends the culture section too when the manager praised client service", async () => {
    // Both halves of "doing well with customers but needs punctuality work"
    // are topics, and both resolve.
    await post(PUNCTUALITY);
    expect(prompt()).toContain("Our Culture — Page 7");
    expect(prompt()).toContain("Attendance — Page 14");
  });

  it("sends the schedule sections when the manager raised scheduling", async () => {
    await post(
      "Paulyne keeps changing her availability at the last minute and does not arrange shift cover.",
    );

    expect(prompt()).toContain("Schedule Requests/General availability Changes — Page 37");
    expect(prompt()).toContain("Shift Replacement — Page 37");
  });

  it("sends Standards of Conduct for a general performance concern", async () => {
    await post("Paulyne's closing duties are not being completed and her follow-through is weak.");

    expect(prompt()).toContain("Standards of Conduct — Page 12");
  });

  it("does not run the corrective forms' similarity search at all", async () => {
    /*
     * An EPP asks "what does the company expect", not "which rule was
     * broken". The pinned manual answers the first by identity; a similarity
     * search gated at the quotation floor answers the second, and running it
     * here would put "quote only from this" in front of a coaching document.
     */
    await post(PUNCTUALITY);
    expect(state.policySearches).toEqual([]);
    expect(prompt()).not.toContain("APPROVED POLICY: none found");
    expect(prompt()).not.toContain("quote only from this");
  });

  it("drafts as ordinary coaching when the observation raises no policy at all", async () => {
    await post("Paulyne is a strong presence on the floor but I want more initiative from her.");

    expect(state.modelCalls).toBe(1);
    expect(prompt()).not.toContain("APPLICABLE COMPANY POLICY");
    // And the plan is still drafted: no policy is not a reason to refuse.
    expect(systemPrompt()).toContain("This is a performance PLAN, not a warning");
  });
});

/* =================================================== the reference printed */

describe("the appendix reference is derived, never written by the model", () => {
  it("names the sections that actually resolved, with their pages", async () => {
    state.toolInput = { values: { where_succeeding: "Strong with clients." } };
    const body = await post(PUNCTUALITY);

    expect(written().values.policy_references).toBe(
      "JBA Policy Manual — Attendance — Page 14; Time Records — Page 36; Late Opening — Page 15; Our Culture — Page 7",
    );
    expect(body.policyDerived).toContain("policy_references");
  });

  it("overrides a reference the model invented", async () => {
    state.toolInput = {
      values: { policy_references: "Sun Tan City Attendance Policy, Section 4.2" },
    };
    await post(PUNCTUALITY);

    expect(written().values.policy_references).not.toContain("Section 4.2");
    expect(written().values.policy_references).toContain("Attendance — Page 14");
  });

  it("carries provenance that points at the manual and the sections", async () => {
    await post(PUNCTUALITY);

    const provenance = written().provenance.policy_references!;
    expect(provenance.source).toBe("official_policy_manual");
    expect(provenance.verified).toBe(true);
    expect(provenance.documentId).toBe("doc-jba");
    expect(provenance.sections).toEqual([
      { locator: "Attendance", page: 14, foundBy: "sheet_heading", chunkIndex: 2 },
      { locator: "Time Records", page: 36, foundBy: "sheet_heading", chunkIndex: 4 },
      { locator: "Late Opening", page: 15, foundBy: "sheet_heading", chunkIndex: 3 },
      { locator: "Our Culture", page: 7, foundBy: "sheet_heading", chunkIndex: 0 },
    ]);
  });

  it("leaves the line blank, and says so, when nothing resolved", async () => {
    state.toolInput = { values: { policy_references: "JBA Policy Manual — Initiative" } };
    const body = await post("I want more initiative from Paulyne.");

    expect(written().values.policy_references).toBeUndefined();
    expect(body.withheld).toContain("policy_references");
  });

  it("leaves the line blank when the manual is not in the knowledge base", async () => {
    state.policyManual = { ok: false, reason: "not indexed" };
    const body = await post(PUNCTUALITY);

    expect(written().values.policy_references).toBeUndefined();
    expect(body.withheld).toContain("policy_references");
    // And the rest of the plan is still drafted.
    expect(state.modelCalls).toBe(1);
  });
});

/* ================================================== no policy is invented */

describe("an opinion never becomes a company policy", () => {
  it("removes a rule attributed to a manual that does not state it", async () => {
    /*
     * THE CASE THE REQUIREMENT NAMES. "She doesn't have enough initiative" is
     * a manager's observation. There is no initiative policy, and a plan that
     * says there is will be read back to the employee at the follow-up as
     * though the manual said so.
     */
    state.toolInput = {
      values: {
        plan_of_action:
          "Paulyne will take more initiative on the floor during the review period. JBA policy requires employees to demonstrate initiative.",
      },
    };
    const body = await post("She doesn't have enough initiative.");

    const plan = written().values.plan_of_action ?? "";
    expect(plan.toLowerCase()).not.toContain("policy requires");
    // The coaching point itself survives — only the false authority goes.
    expect(plan).toContain("take more initiative");
    expect((body.policyAttributions as { adjusted: string[] }).adjusted).toContain(
      "plan_of_action",
    );
    expect(String(body.notice)).toMatch(/do not state it/i);
  });

  it("keeps an attribution the retrieved section really does state", async () => {
    state.toolInput = {
      values: {
        plan_of_action:
          "Paulyne will review her start times with her manager each week. Company policy states that employees are expected to know their schedule and always be on time.",
      },
    };
    const body = await post(PUNCTUALITY);

    expect(written().values.plan_of_action).toContain("always be on time");
    expect((body.policyAttributions as { adjusted: string[] }).adjusted).toEqual([]);
  });

  it("removes a breach finding even when policy WAS retrieved", async () => {
    /*
     * The corrective forms are allowed to assert a breach once the manual has
     * answered — that is what they are for. A development plan is not, and
     * retrieving Attendance does not license saying anybody violated it.
     */
    state.toolInput = {
      values: {
        needs_improvement:
          "Paulyne arrived late on three shifts, which is not in compliance with the attendance policy.",
      },
    };
    await post(PUNCTUALITY);

    const value = written().values.needs_improvement ?? "";
    expect(value).toContain("late");
    expect(value.toLowerCase()).not.toContain("not in compliance");
  });

  it("never mentions the legacy manual, in the prompt or on the record", async () => {
    state.toolInput = {
      values: {
        plan_of_action: "Uphold Sun Tan City policies per the Driven to Shine manual.",
      },
    };
    await post(PUNCTUALITY);

    const everything = JSON.stringify([prompt(), systemPrompt()]).toLowerCase();
    expect(everything).not.toContain("driven to shine");
    // The only manual named anywhere is the JB & Associates one.
    expect(prompt()).toContain("JBA Policy Manual");
  });
});

/* ===================================================== the form's own rules */

describe("what the form itself refuses to accept from a draft", () => {
  it("does not block on missing productivity", async () => {
    state.toolInput = {
      values: {
        where_succeeding: "Consistently warm and welcoming with clients.",
        needs_improvement: "Arriving ready to work at the scheduled start time.",
      },
    };
    const body = await post("No productivity numbers for her yet. " + PUNCTUALITY);

    expect(body.values).toBeDefined();
    expect(written().values.where_succeeding).toContain("welcoming");
    expect(written().values.employee_productivity).toBeUndefined();
    expect(written().values.salon_productivity).toBeUndefined();
  });

  it("leaves every expectation unmarked when the model marked none", async () => {
    state.toolInput = { values: { where_succeeding: "Strong with clients." }, checked: {} };
    await post(PUNCTUALITY);

    expect(written().checked.expectations_success).toBeUndefined();
    expect(written().checked.expectations_improvement).toBeUndefined();
  });

  it("stores the two mark columns separately when the model does mark them", async () => {
    state.toolInput = {
      values: {},
      checked: {
        expectations_success: ["client_service", "uphold_experience"],
        expectations_improvement: ["company_policies"],
      },
    };
    await post(PUNCTUALITY);

    expect(written().checked.expectations_success).toEqual([
      "client_service",
      "uphold_experience",
    ]);
    expect(written().checked.expectations_improvement).toEqual(["company_policies"]);
  });

  it("refuses an expectation key the form does not offer", async () => {
    state.toolInput = {
      values: {},
      checked: { expectations_success: ["client_service", "invented_expectation"] },
    };
    await post(PUNCTUALITY);

    expect(written().checked.expectations_success).toEqual(["client_service"]);
  });

  it("never marks the employee's own column, which is theirs to complete", async () => {
    state.toolInput = {
      values: { employee_strengths: "Client service" },
      checked: { employee_expectations_success: ["client_service"] },
    };
    const body = await post(PUNCTUALITY);

    expect(written().checked.employee_expectations_success).toBeUndefined();
    expect(written().values.employee_strengths).toBeUndefined();
    expect(JSON.stringify(body.rejected ?? [])).not.toBe("");
  });

  it("writes nothing into a signature, because a signature has no key", async () => {
    state.toolInput = {
      values: { employee_signature: "Paulyne Co", supervisor_signature: "A Manager" },
    };
    await post(PUNCTUALITY);

    expect(written().values.employee_signature).toBeUndefined();
    expect(written().values.supervisor_signature).toBeUndefined();
    expect(JSON.stringify(written().values).toLowerCase()).not.toContain("signature");
  });

  it("leaves the re-evaluation for the manager, because it has not happened", async () => {
    state.toolInput = {
      values: { objectives_met: "All of them", reevaluation_plan: "Continue as before" },
    };
    await post(PUNCTUALITY);

    expect(written().values.objectives_met).toBeUndefined();
    expect(written().values.reevaluation_plan).toBeUndefined();
  });
});
