import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseFormDocument } from "@/lib/forms/document";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";

/**
 * ============================================================================
 * THE DRAFT ROUTE, EXERCISED RATHER THAN READ
 * ============================================================================
 *
 * The guards on this route were covered by source scans, and a source scan
 * cannot answer the questions that matter here: did the framework's text
 * actually reach the model, did the refusal actually skip the model, and did a
 * refused selection actually fail to reach the persistence call. A mutation that
 * changed a CONDITION rather than deleting a CALL passed every one of those
 * scans while disabling the guard.
 *
 * So this file runs `POST` with the model, the store and every provider mocked,
 * and asserts on WHAT CLAUDE WAS SENT and WHAT THE PERSISTENCE LAYER RECEIVED.
 */

const state = vi.hoisted(() => ({
  /** The prompt the model was given, or null if it was never called. */
  modelInput: null as Record<string, unknown> | null,
  modelCalls: 0,
  /** What the model returns as its tool input. */
  toolInput: {} as Record<string, unknown>,
  /** Role id -> result. */
  roleResults: {} as Record<string, unknown>,
  roleCalls: [] as string[],
  /** Everything handed to the persistence call, in order. */
  persisted: [] as { values: Record<string, string>; checked: Record<string, string[]> }[],
  /** Approved policy `groundPolicy` should find. Empty means none. */
  policyHits: [] as unknown[],
  /** The instance and version the route loads. */
  templateKey: "follow-up-coaching",
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
    const seed = TEMPLATE_SEEDS.find((entry) => entry.key === state.templateKey)!;
    return {
      actor: { id: "demo:salon_director:QA", role: "salon_director", verified: false, scope: null },
      loaded: {
        instance: {
          id: "form-1",
          templateKey: seed.key,
          templateName: seed.name,
          layoutFamily: seed.layoutFamily,
          variantKey: seed.variants[0]?.key ?? null,
          employeeName: "Jordan Vance (test)",
          locationName: "Riverbend Commons",
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
      state.roleCalls.push(role.id);
      return state.roleResults[role.id] ?? null;
    }
  },
}));

// `groundPolicy` searches through this. An empty result is "no approved policy".
vi.mock("@/lib/knowledge", () => ({
  getKnowledgeProvider: () => ({ search: async () => state.policyHits }),
}));

vi.mock("@/lib/forms/instances", () => ({
  applyAssistantDraft: async (
    _id: string,
    draft: { values: Record<string, string>; checked: Record<string, string[]> },
  ) => {
    state.persisted.push({ values: draft.values ?? {}, checked: draft.checked ?? {} });
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
          locator: "SECTION 2 – PERFORMANCE MANAGEMENT LADDER",
          page: null,
          section: null,
          content: "Solve the issue at the lowest appropriate level.",
          similarity: 0,
        },
        {
          chunk_id: "pmf-1",
          document_id: "doc-progression",
          document_title: "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
          category: "leadership_coaching",
          locator: "10.7 Final operating rule for Ask Sunny",
          page: null,
          section: null,
          content: "Classify the issue: skill, knowledge, confidence, effort, policy or leadership.",
          similarity: 0,
        },
      ],
      presentGroups: ["escalation_ladder", "final_operating_rule"],
    },
  };
}

const DOWN = { ok: false, failure: { code: "role_document_not_found", detail: "x" } };

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

/** The whole user-turn prompt the model was sent. */
function prompt(): string {
  const messages = state.modelInput?.messages as { content: string }[] | undefined;
  return messages?.[0]?.content ?? "";
}

function systemPrompt(): string {
  return String(state.modelInput?.system ?? "");
}

const NOTES =
  "She skipped the membership conversation with two eligible guests. We coached this last month and agreed to look again in two weeks.";

beforeEach(() => {
  vi.resetModules();
  state.modelInput = null;
  state.modelCalls = 0;
  state.toolInput = {};
  state.roleCalls = [];
  state.roleResults = { [PROGRESSION_ID]: healthyProgression() };
  state.persisted = [];
  state.policyHits = [];
  state.templateKey = "follow-up-coaching";
});

/* ==================================================================== */
/*  THE FRAMEWORK REACHES THE DRAFT                                     */
/* ==================================================================== */

describe("the progression framework reaches a governed draft", () => {
  it("sends the framework's own text, with its provenance, for Follow-Up Coaching", async () => {
    await post(NOTES);

    expect(state.roleCalls).toContain(PROGRESSION_ID);
    expect(state.modelCalls).toBe(1);

    // The framework's own rows, not a paraphrase living in the route.
    expect(prompt()).toContain("PERFORMANCE MANAGEMENT FRAMEWORK");
    expect(prompt()).toContain("Solve the issue at the lowest appropriate level.");
    // With provenance a reader could follow back to the Knowledge Base.
    expect(prompt()).toContain("ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT");
    expect(prompt()).toContain("SECTION 2 – PERFORMANCE MANAGEMENT LADDER");
  });

  it("sends it for the DPOA too", async () => {
    state.templateKey = "dpoa";
    await post(NOTES);

    expect(state.roleCalls).toContain(PROGRESSION_ID);
    expect(prompt()).toContain("Solve the issue at the lowest appropriate level.");
  });

  it("carries the reasoning order in the system prompt", async () => {
    await post(NOTES);

    expect(systemPrompt()).toMatch(/classify it as a skill, knowledge, confidence, effort, policy or leadership issue/i);
    expect(systemPrompt()).toMatch(/LOWEST rung that fits/);
    expect(systemPrompt()).toMatch(/NEVER SELECT A TERMINATION, DEMOTION OR SUSPENSION/);
    expect(systemPrompt()).toMatch(/LEAVE THE STEP UNSET/);
  });

  it("does NOT send it, or the rules, for the plain Coaching Form", async () => {
    /*
     * The exclusion, behaviourally. The framework fails closed, so governing
     * the everyday coaching form would mean a corpus missing one document could
     * not draft the form a Salon Director reaches for most.
     */
    state.templateKey = "coaching";
    await post(NOTES);

    expect(state.roleCalls).not.toContain(PROGRESSION_ID);
    expect(state.modelCalls).toBe(1);
    expect(prompt()).not.toContain("PERFORMANCE MANAGEMENT FRAMEWORK");
    expect(systemPrompt()).not.toMatch(/LOWEST rung that fits/);
  });
});

/* ==================================================================== */
/*  UNAVAILABLE MEANS NO AI DRAFT                                       */
/* ==================================================================== */

describe("a governed draft is blocked when the framework is unavailable", () => {
  it.each(["follow-up-coaching", "dpoa", "policy-review", "sdit-epp"])(
    "%s is not drafted at all",
    async (key) => {
      state.templateKey = key;
      state.roleResults = { [PROGRESSION_ID]: DOWN };

      const payload = await post(NOTES);

      // THE MODEL IS NEVER CALLED. No general-HR fallback.
      expect(state.modelCalls).toBe(0);
      // And nothing is written.
      expect(state.persisted).toEqual([]);

      // The form stays usable by hand, and the notice says why.
      expect(String(payload.notice)).toContain("Performance Management Framework");
      expect(payload.values).toEqual({});
      expect(payload.checked).toEqual({});
    },
  );

  it("blocks on a retrieval outage as well as a missing document", async () => {
    state.templateKey = "dpoa";
    state.roleResults = {};
    // The provider throwing, rather than returning an unhealthy result.
    const { SupabaseKnowledgeProvider } = await import("@/lib/knowledge/providers/supabase");
    vi.spyOn(SupabaseKnowledgeProvider.prototype, "fetchRoleGrounding").mockRejectedValue(
      new Error("network"),
    );

    const payload = await post(NOTES);

    expect(state.modelCalls).toBe(0);
    expect(String(payload.notice)).toContain("Performance Management Framework");
  });

  it("still drafts the Coaching Form when the framework is down", async () => {
    // The point of the exclusion: an ungoverned form is unaffected.
    state.templateKey = "coaching";
    state.roleResults = { [PROGRESSION_ID]: DOWN };

    await post(NOTES);

    expect(state.modelCalls).toBe(1);
  });
});

/* ==================================================================== */
/*  A TERMINATION NEVER REACHES THE STORE                               */
/* ==================================================================== */

describe("a sensitive final action never reaches the persistence call", () => {
  beforeEach(() => {
    state.templateKey = "dpoa";
    // Approved policy exists, so the policy fields are not the thing being
    // tested here.
    state.policyHits = [
      {
        chunkId: "c1",
        documentId: "doc-manual",
        documentTitle: "JBA Policy Manual",
        locator: "Page 12",
        content: "Attendance standards are set out as follows.",
        score: 0.9,
      },
    ];
  });

  it("strips a model-selected termination before anything is stored", async () => {
    state.toolInput = {
      values: { observation: "Arrived late three times in two weeks." },
      checked: { warning_type: ["written", "termination"] },
    };

    const payload = await post(NOTES);

    expect(state.persisted).toHaveLength(1);
    expect(state.persisted[0]!.checked.warning_type).toEqual(["written"]);
    expect(state.persisted[0]!.checked.warning_type).not.toContain("termination");

    // And the manager is told, because a silently unticked box reads as "Ask
    // Sunny judged this not to apply".
    expect(String(payload.notice)).toMatch(/termination, demotion or suspension/i);
    expect(payload.sensitiveRefused).toEqual({ warning_type: ["termination"] });
  });

  it("stores no selection at all when the sensitive action was the only one", async () => {
    state.toolInput = {
      values: { observation: "Repeated policy breach." },
      checked: { warning_type: ["termination"] },
    };

    await post(NOTES);

    expect(state.persisted[0]!.checked.warning_type).toBeUndefined();
  });

  it("leaves a legitimate written warning alone", async () => {
    state.toolInput = {
      values: { observation: "Third occurrence after documented coaching." },
      checked: { warning_type: ["written"] },
    };

    const payload = await post(NOTES);

    expect(state.persisted[0]!.checked.warning_type).toEqual(["written"]);
    expect(payload.sensitiveRefused).toEqual({});
  });
});

/* ==================================================================== */
/*  UNVERIFIED POLICY NEVER REACHES THE STORE                           */
/* ==================================================================== */

describe("an unverified policy value never reaches the persistence call", () => {
  it("withholds both policy fields when retrieval found nothing", async () => {
    state.templateKey = "dpoa";
    // No approved policy matched.
    state.policyHits = [];
    state.toolInput = {
      values: {
        observation: "Arrived twenty minutes late.",
        policy_violated: "Attendance Policy Section 4.2",
        policy_language: "Three unexcused absences result in immediate termination.",
      },
    };

    const payload = await post(NOTES);

    expect(state.persisted).toHaveLength(1);
    const values = state.persisted[0]!.values;

    // THE ASSERTION: the persistence layer receives neither.
    expect(values.policy_violated).toBeUndefined();
    expect(values.policy_language).toBeUndefined();
    // The ordinary field still went through.
    expect(values.observation).toBe("Arrived twenty minutes late.");

    expect(payload.withheld).toEqual(
      expect.arrayContaining(["policy_violated", "policy_language"]),
    );
  });
});

/* ==================================================================== */
/*  THE §9.2 TIMEFRAME                                                  */
/* ==================================================================== */

describe("the follow-up timeframe field", () => {
  it("is permitted, and kept when the manager gave a timeframe", async () => {
    state.toolInput = {
      values: {
        original_topic: "Membership conversations",
        next_follow_up: "In two weeks, at her next closing shift",
      },
    };

    await post(NOTES);

    // The generic no-scheduling rule is replaced for this form, not applied.
    expect(systemPrompt()).toMatch(/ONE FIELD ON THIS FORM ASKS FOR A FOLLOW-UP TIMEFRAME/);
    expect(systemPrompt()).not.toMatch(
      /Do not mention follow-up dates or scheduling at all/,
    );

    expect(state.persisted[0]!.values.next_follow_up).toBe(
      "In two weeks, at her next closing shift",
    );
  });

  it("is emptied when the manager gave nothing to base one on", async () => {
    state.toolInput = {
      values: {
        original_topic: "Membership conversations",
        next_follow_up: "In two weeks",
      },
    };

    const payload = await post(
      "She skipped the membership conversation with two eligible guests on the floor.",
    );

    expect(state.persisted[0]!.values.next_follow_up).toBeUndefined();
    expect(payload.timeframeEmptied).toEqual(["next_follow_up"]);
  });

  it("keeps the blanket rule on a form with no timeframe field", async () => {
    state.templateKey = "coaching";
    await post(NOTES);

    expect(systemPrompt()).toMatch(/Do not mention follow-up dates or scheduling at all/);
    expect(systemPrompt()).not.toMatch(/ONE FIELD ON THIS FORM ASKS FOR A FOLLOW-UP TIMEFRAME/);
  });
});
