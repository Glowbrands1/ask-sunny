import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseFormDocument } from "@/lib/forms/document";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";

/**
 * ============================================================================
 * DRAFTING A TSD MANAGEMENT PERFORMANCE PLAN, EXERCISED RATHER THAN READ
 * ============================================================================
 *
 * Same harness as `sdit-epp-draft-route.test.ts` and for the same reason: the
 * guarantees here are about WHAT THE MODEL WAS SENT and WHAT REACHED THE
 * WRITE, and a source scan cannot answer either. A mutation that flipped a
 * condition rather than deleting a call would pass a scan while disabling the
 * guard.
 *
 * ============================================================================
 * WHAT IS DIFFERENT ABOUT THIS DOCUMENT AND WHY IT NEEDS ITS OWN FILE
 * ============================================================================
 *
 * EIGHT EMPTY PLAN ROWS. The plan of action here is eight named objectives
 * rather than one paragraph, and eight empty boxes in front of a model asked
 * to write a plan is eight invitations to invent a weakness. The rule that
 * keeps the unsupported ones blank is asserted in the prompt AND the
 * behaviour is asserted at the write.
 *
 * A SECTION ASK SUNNY MAY NEVER ANSWER. The self-assessment is the Training
 * Salon Director's own, and every key in it is `employee` — which is not
 * AI-writable. A model that writes into one has it dropped, and that is
 * asserted here rather than trusted to the prompt.
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
  employeeRole: "TSD" as string | null,
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
    const seed = TEMPLATE_SEEDS.find((entry) => entry.key === "tsd-epp")!;
    return {
      actor: { id: "demo:district_manager:QA", role: "district_manager", verified: false, scope: null },
      loaded: {
        instance: {
          id: "form-1",
          templateKey: seed.key,
          templateName: seed.name,
          layoutFamily: seed.layoutFamily,
          variantKey: seed.variants[0]!.key,
          employeeName: "Sarah Johnson (test)",
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
  "Sarah is excellent at coaching her team and working with clients, but she has been late several times this month.";

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
  state.employeeRole = "TSD";
});


/* ==================================================== the fields it is sent */

describe("what the model is allowed to write, and what it never sees", () => {
  it("offers the ten productivity lines this plan actually has", async () => {
    await post(PUNCTUALITY);

    for (const key of [
      "manager_ppta",
      "manager_lpsva",
      "manager_upta",
      "manager_club_close",
      "manager_average_club_dollar",
      "salon_ppta",
      "salon_lpsva",
      "salon_upta",
      "salon_club_close",
      "salon_average_club_dollar",
    ]) {
      expect(prompt(), key).toContain(`- ${key}:`);
    }
  });

  it("never offers the manager's own self-assessment", async () => {
    /*
     * NOT A PROMPT PREFERENCE — A STRUCTURAL FACT. These keys are `employee`,
     * which is absent from `AI_WRITABLE`, so they are not in the list the
     * route builds and there is nothing for the model to fill in.
     */
    await post(PUNCTUALITY);

    for (const key of [
      "self_important_skill",
      "self_strengths",
      "self_improvements",
      "salon_goals",
      "self_expectations_success",
      "self_expectations_improvement",
    ]) {
      expect(prompt(), key).not.toContain(key);
    }
  });

  it("never offers the re-evaluation, because it has not happened yet", async () => {
    await post(PUNCTUALITY);

    for (const key of ["objectives_met", "reevaluation_plan", "reevaluation_met"]) {
      expect(prompt(), key).not.toContain(key);
    }
  });

  it("offers each plan row with the objective the business printed beside it", async () => {
    await post(PUNCTUALITY);

    expect(prompt()).toContain("- bench: Plan of Action — Bench");
    expect(prompt()).toContain(
      "Ability to find and select quality talent, and retain at bench goals set by DM",
    );
    expect(prompt()).toContain("- district_outreach: Plan of Action — District Outreach");
    expect(prompt()).toContain(
      "- salon_standards: Plan of Action — Salon Standards of Cleanliness and Safety",
    );
  });

  it("tells the model to leave the categories nothing supports alone", async () => {
    await post(PUNCTUALITY);

    expect(systemPrompt()).toContain("is one of 8 FIXED objectives printed on this form");
    expect(systemPrompt()).toMatch(/only for the categories the manager's own description/i);
    expect(systemPrompt()).toMatch(/never write a plan for a category merely because the row exists/i);
  });

  it("sends that rule to no form that has no objective table", async () => {
    /*
     * DERIVED FROM THE DOCUMENT. The SDIT plan's plan of action is one
     * paragraph, so a rule about eight categories would be eight categories
     * it does not have.
     */
    const { TEMPLATE_SEEDS: seeds } = await import("@/lib/forms/library");
    const sdit = seeds.find((entry) => entry.key === "sdit-epp")!;
    expect(sdit.document.blocks.some((block) => block.kind === "objective_rows")).toBe(false);
  });

  it("names the subject as the TSD the manager stated", async () => {
    await post(PUNCTUALITY);

    expect(prompt()).toContain("REVIEWER: District Manager. SUBJECT: TSD.");
    expect(prompt()).toContain("EMPLOYEE: Sarah Johnson (test)");
  });
});

/* ==================================================== JBA reaches the draft */

describe("the JB & Associates manual is what this plan is reasoned against", () => {
  it("puts the Attendance section, with its printed page, in front of the model", async () => {
    await post(PUNCTUALITY);

    expect(state.modelCalls).toBe(1);
    expect(prompt()).toContain("APPLICABLE COMPANY POLICY — JBA Policy Manual");
    expect(prompt()).toContain("Attendance — Page 14");
    expect(prompt()).toContain("always be on time and ready to work");
    expect(prompt()).toContain("Time Records — Page 36");
  });

  it("retrieves only what the manager reported, never the whole manual", async () => {
    await post("Sarah needs to improve punctuality. She has been late several times this month.");

    expect(prompt()).toContain("Attendance — Page 14");
    expect(prompt()).not.toContain("Standards of Conduct");
  });

  it("says nothing about the manual Ask Sunny cannot read", async () => {
    await post(PUNCTUALITY);

    expect(prompt()).not.toMatch(/driven to shine/i);
    expect(systemPrompt()).not.toMatch(/driven to shine/i);
  });

  it("refuses to attribute a TSD expectation to JBA policy", async () => {
    /*
     * "BENCH PLANNING" IS A TSD PERFORMANCE EXPECTATION, not a company rule.
     * The guard that strips an unsupported attribution is the same one the
     * SDIT plan uses, and this asserts it reaches this document too.
     */
    state.toolInput = {
      values: {
        bench: "JBA policy requires Sarah to maintain bench planning at all times.",
      },
    };
    await post(PUNCTUALITY);

    expect(written().values.bench ?? "").not.toMatch(/jba policy requires/i);
  });
});

/* ============================================ what actually reaches the write */

describe("what reaches the record", () => {
  it("writes only the plan rows the model supported, and leaves the rest blank", async () => {
    state.toolInput = {
      values: {
        coaching_and_development:
          "Coach the team on shift-start readiness each week and follow up at the next visit.",
      },
    };
    await post(PUNCTUALITY);

    expect(written().values.coaching_and_development).toContain("shift-start readiness");
    for (const key of [
      "bench",
      "management_bench",
      "personal_primary_productivity",
      "salon_primary_productivity",
      "salon_secondary_productivity",
      "district_outreach",
      "salon_standards",
    ]) {
      expect(written().values[key], key).toBeUndefined();
    }
  });

  it("drops anything written into the manager's own self-assessment", async () => {
    state.toolInput = {
      values: {
        self_important_skill: "Coaching",
        self_strengths: "Client service",
        salon_goals: "Grow memberships",
      },
      checked: { self_expectations_success: ["coach_client_service"] },
    };
    const body = await post(PUNCTUALITY);

    expect(written().values.self_important_skill).toBeUndefined();
    expect(written().values.self_strengths).toBeUndefined();
    expect(written().values.salon_goals).toBeUndefined();
    expect(written().checked.self_expectations_success).toBeUndefined();
    expect(JSON.stringify(body.rejected ?? [])).not.toBe("");
  });

  it("drops anything written into the re-evaluation", async () => {
    state.toolInput = {
      values: { objectives_met: "All of them", reevaluation_plan: "Continue as before" },
      checked: { reevaluation_met: ["bench"] },
    };
    await post(PUNCTUALITY);

    expect(written().values.objectives_met).toBeUndefined();
    expect(written().values.reevaluation_plan).toBeUndefined();
    expect(written().checked.reevaluation_met).toBeUndefined();
  });

  it("writes nothing into a signature, because a signature has no key", async () => {
    state.toolInput = {
      values: { employee_signature: "Sarah Johnson", supervisor_signature: "A Manager" },
    };
    await post(PUNCTUALITY);

    expect(JSON.stringify(written().values).toLowerCase()).not.toContain("signature");
  });

  it("refuses a management expectation the form does not offer", async () => {
    state.toolInput = {
      values: {},
      checked: {
        expectations_success: ["coach_client_service", "invented_expectation"],
        expectations_improvement: ["lead_by_example"],
      },
    };
    await post(PUNCTUALITY);

    expect(written().checked.expectations_success).toEqual(["coach_client_service"]);
    expect(written().checked.expectations_improvement).toEqual(["lead_by_example"]);
  });

  it("leaves a metric the manager never supplied empty", async () => {
    state.toolInput = { values: { manager_ppta: "14.20" } };
    await post(PUNCTUALITY);

    expect(written().values.manager_ppta).toBe("14.20");
    expect(written().values.manager_club_close).toBeUndefined();
    expect(written().values.salon_average_club_dollar).toBeUndefined();
  });
});
