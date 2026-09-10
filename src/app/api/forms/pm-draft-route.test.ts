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
          locationName: "MO Kansas City Wornall",
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

/* ==================================================================== */
/*  THE CORRECTIVE ACTION FORM'S ACCEPTANCE CASES                       */
/* ==================================================================== */

/**
 * ============================================================================
 * THE FOUR GENERATION CASES THE BUSINESS ASKED FOR
 * ============================================================================
 *
 * Attendance, dress code, no policy found, and the policy-title echo. All four
 * turn on ONE distinction, which is the whole reason this form is treated
 * differently from every other template in the library:
 *
 *   THE PERFORMANCE MANAGEMENT FRAMEWORK says HOW to reason, classify,
 *   document and structure. It is retrieved deterministically, by the
 *   document's canonical role rather than by hoping semantic search ranks it
 *   highly, and drafting fails closed without it.
 *
 *   THE APPROVED POLICY MANUAL says WHAT THE POLICY IS. It is retrieved
 *   separately, from the manager's own words, filtered to the corpus category
 *   the manual lives in, and it is the ONLY thing that may populate a policy
 *   field or support a claim that a rule was broken.
 *
 * The framework is never allowed to answer the second question. That is what
 * these tests hold in place, and it is why every one of them asserts on both
 * retrievals rather than on the prose that came out.
 */
describe("the Corrective Action Form's generation behaviour", () => {
  beforeEach(() => {
    state.templateKey = "dpoa";
  });

  /** An approved manual entry `groundPolicy` will find. */
  function approvedPolicy(title: string, locator: string, content: string) {
    return [
      {
        chunkId: "policy-1",
        documentId: "doc-manual",
        documentTitle: title,
        locator,
        content,
        score: 0.82,
      },
    ];
  }

  /* ---------------------------------------------------------- attendance -- */

  describe("B. attendance — an employee was late today", () => {
    const LATE = "She was late today. Her shift started at 10 and she clocked in at 10:20.";

    it("retrieves the framework and the approved attendance policy, separately", async () => {
      state.policyHits = approvedPolicy(
        "JBA Policy Manual",
        "Attendance & Punctuality, page 12",
        "Employees are expected to be clocked in and ready to work at their scheduled start time.",
      );
      state.toolInput = {
        values: {
          observation: "Sarah clocked in twenty minutes after her scheduled start time.",
          policy_violated: "Attendance & Punctuality",
          policy_language:
            "Employees are expected to be clocked in and ready to work at their scheduled start time.",
        },
        checked: { offense_type: ["tardiness"] },
      };

      const payload = await post(LATE);

      // HOW: the framework, pinned by its role, with its own provenance.
      expect(state.roleCalls).toContain(PROGRESSION_ID);
      expect(prompt()).toContain("PERFORMANCE MANAGEMENT FRAMEWORK");

      // WHAT: the manual, in its own block, quoted verbatim only.
      expect(prompt()).toContain("APPROVED POLICY (quote only from this, verbatim)");
      expect(prompt()).toContain("Attendance & Punctuality, page 12");

      // Both policy fields survive, because an approved source backed them.
      expect(state.persisted[0]!.values.policy_violated).toBe("Attendance & Punctuality");
      expect(state.persisted[0]!.values.policy_language).toContain("scheduled start time");
      expect(payload.withheld).toEqual([]);

      // Classified as tardiness, from the manager's own account.
      expect(state.persisted[0]!.checked.offense_type).toEqual(["tardiness"]);
    });

    it("keeps the observation to what was seen", async () => {
      state.policyHits = [];
      state.toolInput = {
        values: {
          observation:
            "Sarah clocked in twenty minutes after her scheduled start time, which is a violation of the attendance policy.",
        },
      };

      const payload = await post(LATE);

      expect(state.persisted[0]!.values.observation).toBe(
        "Sarah clocked in twenty minutes after her scheduled start time.",
      );
      expect(payload.policyClaims).toEqual({ adjusted: ["observation"], emptied: [] });
    });
  });

  /* ---------------------------------------------------------- dress code -- */

  describe("C. dress code — the QA case, verbatim", () => {
    const SKIRT = "She was wearing a mini skirt today at the Kearny salon.";

    it("does not invent a uniform requirement when the manual has none", async () => {
      state.policyHits = [];
      /*
       * WRITTEN IN THE SHAPE THE FIELD ASKS FOR. Observation of Offense is
       * marked `observed_expectation`, so a draft that ignored the three
       * labelled sections would be emptied by the narrative guard before this
       * one ever saw it — a different rule, correctly applied, and not the
       * one under test here.
       *
       * The date is the manager's own word, "today", for the same reason: an
       * invented calendar date is an ungrounded specific and the narrative
       * guard removes the sentence carrying it. What is left for THIS guard is
       * the finding — the clause that says a rule was broken.
       */
      state.toolInput = {
        values: {
          observation: [
            "Observed: Sarah Test was observed wearing a mini skirt at the Kearny salon today, which is not in compliance with the Sun Tan City dress code policy.",
            "",
            "Expectation: employees are expected to meet the salon's appearance standards for every scheduled shift.",
            "",
            "Going Forward: Sarah checks her outfit against the current standard before her shift and asks a manager when she is unsure.",
          ].join("\n"),
          policy_violated: "Dress Code Violation",
          policy_language: "Employees must wear approved company attire at all times.",
          action_plan: "Sarah must wear pants instead of skirts on every shift.",
        },
        checked: { offense_type: ["dress_code"] },
      };

      const payload = await post(SKIRT);

      // The framework still structures the form.
      expect(state.roleCalls).toContain(PROGRESSION_ID);
      expect(state.persisted).toHaveLength(1);

      // The finding is cut; the fact, and the rest of the shape, survive.
      // The narrative guard puts each label on its own line, so the fact is
      // asserted as its own line rather than as part of the label's.
      const observation = state.persisted[0]!.values.observation!;
      expect(observation).toContain(
        "Sarah Test was observed wearing a mini skirt at the Kearny salon today.",
      );
      expect(observation).not.toMatch(/not in compliance/i);
      expect(observation).not.toMatch(/dress code policy/i);
      expect(observation).toContain("Expectation:");
      expect(observation).toContain("Going Forward:");
      expect(payload.policyClaims).toEqual({ adjusted: ["observation"], emptied: [] });

      // Neither policy field is written at all.
      expect(state.persisted[0]!.values.policy_violated).toBeUndefined();
      expect(state.persisted[0]!.values.policy_language).toBeUndefined();
      expect(payload.withheld).toEqual(
        expect.arrayContaining(["policy_violated", "policy_language"]),
      );

      // And the classification the manager's account supports is still ticked.
      expect(state.persisted[0]!.checked.offense_type).toEqual(["dress_code"]);
    });

    it("tells the manager the exact policy still has to be verified", async () => {
      state.policyHits = [];
      state.toolInput = { values: { policy_violated: "Dress Code Violation" } };

      const payload = await post(SKIRT);

      expect(String(payload.notice)).toMatch(/no approved policy matched/i);
    });

    it("populates the policy fields once the manual actually answers", async () => {
      state.policyHits = approvedPolicy(
        "JBA Policy Manual",
        "Appearance Standards, page 8",
        "Skirts and dresses must reach mid-thigh or longer while on the salon floor.",
      );
      state.toolInput = {
        values: {
          observation: "Sarah was observed wearing a mini skirt on the salon floor.",
          policy_violated: "Appearance Standards",
          policy_language:
            "Skirts and dresses must reach mid-thigh or longer while on the salon floor.",
        },
      };

      const payload = await post(SKIRT);

      expect(state.persisted[0]!.values.policy_violated).toBe("Appearance Standards");
      expect(state.persisted[0]!.values.policy_language).toContain("mid-thigh");
      expect(payload.withheld).toEqual([]);
      // Nothing was cut, because nothing unsupported was claimed.
      expect(payload.policyClaims).toEqual({ adjusted: [], emptied: [] });
    });
  });

  /* --------------------------------------------------- the category echo -- */

  /**
   * "Dress Code Violation" is a tick box. It is not a policy, it is in no
   * manual, and a manager who later has to defend the record cannot look it
   * up. It is a DISTINCT failure from an invented quotation, because it only
   * arises when retrieval SUCCEEDED — with nothing retrieved the field is
   * withheld outright and there is nothing to echo.
   */
  it("refuses an offense category used as the policy title, even with policy retrieved", async () => {
    state.policyHits = approvedPolicy(
      "JBA Policy Manual",
      "Appearance Standards, page 8",
      "Skirts and dresses must reach mid-thigh or longer while on the salon floor.",
    );
    state.toolInput = {
      values: {
        policy_violated: "Dress Code Violation",
        policy_language:
          "Skirts and dresses must reach mid-thigh or longer while on the salon floor.",
      },
    };

    const payload = await post("She was wearing a mini skirt today.");

    expect(state.persisted[0]!.values.policy_violated).toBeUndefined();
    // The real quotation, which IS in the retrieved passage, is untouched.
    expect(state.persisted[0]!.values.policy_language).toContain("mid-thigh");
    expect(payload.withheld).toContain("policy_violated");
  });

  /* ------------------------------------------------------- no policy at all */

  describe("D. no approved policy is found", () => {
    it("still structures the form from the framework, and invents nothing", async () => {
      state.policyHits = [];
      state.toolInput = {
        values: {
          observation: "Sarah left the salon floor unattended for fifteen minutes.",
          policy_violated: "Standards of Conduct",
          policy_language: "[Verify exact policy language from official manual]",
          action_plan:
            "Sarah is expected to remain on the salon floor for the duration of her shift.",
        },
      };

      const payload = await post(
        "She left the floor unattended for about fifteen minutes this afternoon.",
      );

      // The framework was still retrieved and still governs the draft.
      expect(state.roleCalls).toContain(PROGRESSION_ID);
      expect(prompt()).toContain("APPROVED POLICY: none found. Leave every policy field empty.");

      // Nothing policy-shaped is written, the bracketed placeholder included.
      expect(state.persisted[0]!.values.policy_violated).toBeUndefined();
      expect(state.persisted[0]!.values.policy_language).toBeUndefined();
      expect(JSON.stringify(state.persisted[0]!.values)).not.toContain("Verify exact policy");

      // The rest of the form is drafted normally.
      expect(state.persisted[0]!.values.observation).toContain("unattended");
      expect(state.persisted[0]!.values.action_plan).toContain("remain on the salon floor");

      // And the manager is told why the two fields are theirs.
      expect(String(payload.notice)).toMatch(/policy fields are left for the manager/i);
    });

    it("says so through the separation rules in the prompt as well", async () => {
      state.policyHits = [];
      await post("She left the floor unattended this afternoon.");

      expect(systemPrompt()).toMatch(
        /An observation states WHAT WAS SEEN OR HEARD and never whether it broke a rule/,
      );
      expect(systemPrompt()).toMatch(
        /The Type of Offense boxes are CATEGORIES you may tick\. They are not policies\./,
      );
    });

    it("sends no separation rules to a form with no policy fields", async () => {
      state.templateKey = "coaching";
      await post("She skipped the membership conversation with two eligible guests.");

      expect(systemPrompt()).not.toMatch(/The Type of Offense boxes are CATEGORIES/);
    });
  });
});
