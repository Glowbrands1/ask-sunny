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
  persisted: [] as {
    values: Record<string, string>;
    checked: Record<string, string[]>;
    /* The write-time guard reads this, so it is asserted rather than assumed. */
    provenance: Record<string, Record<string, unknown>>;
  }[],
  /** Approved policy `groundPolicy` should find. Empty means none. */
  policyHits: [] as unknown[],
  /** Every call `groundPolicy` made, so the filter itself is assertable. */
  policySearches: [] as { query: string; categories?: string[] }[],
  /** The instance and version the route loads. */
  templateKey: "follow-up-coaching",
  /*
   * THE PUBLISHED VERSION THIS INSTANCE IS PINNED TO, in the one respect that
   * differs between them. An instance created before `policy_violated` was
   * redefined is pinned to a version where the field is still `policyGrounded`,
   * and re-publishing cannot reach it — pinned versions are immutable. Set this
   * to stand where those instances stand.
   */
  policyViolatedGroundedOnPinnedVersion: false,
  /*
   * The official policy manual, as `fetchOfficialPolicyManual` returns it.
   * Null means the knowledge base holds no manual — which is the state every
   * test that does not care about citations runs in.
   */
  policyManual: null as unknown,
  /** The role recorded on the instance. Decides which section of a split. */
  employeeRole: null as string | null,
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
    const document = parseFormDocument(seed.document);

    if (state.policyViolatedGroundedOnPinnedVersion) {
      for (const block of document.blocks) {
        if (block.kind === "field" && block.field.key === "policy_violated") {
          (block.field as { policyGrounded?: boolean }).policyGrounded = true;
        }
      }
    }

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
          employeeRole: state.employeeRole,
          locationName: "MO Kansas City Wornall",
          /*
           * `form_date` is set when the record is created and defaults to
           * today, so a manager answering "3. today" has already had it
           * resolved server-side. The corrective path reads it rather than
           * asking the model for a date. See `form-date-grounding.ts`.
           */
          formDate: "2026-09-10",
          status: "draft",
        },
        version: {
          document,
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

// `groundPolicy` searches through this. An empty result is "no approved policy".
vi.mock("@/lib/knowledge", () => ({
  getKnowledgeProvider: () => ({
    search: async (input: { query: string; categories?: string[] }) => {
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
  state.policySearches = [];
  state.templateKey = "follow-up-coaching";
  state.policyViolatedGroundedOnPinnedVersion = false;
  state.policyManual = null;
  state.employeeRole = null;
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
  /*
   * THE MODEL'S OWN POLICY WORDING NEVER REACHES THE RECORD.
   *
   * Both fields are derived now — Policy Violated from the ticked offense,
   * Direct policy from the retrieved manual — so a model that composed a
   * plausible policy title and a consequence quoted from memory has both
   * replaced. With nothing retrieved and no box ticked, both come out empty.
   */
  it("never persists a policy title or quotation the model composed", async () => {
    state.templateKey = "dpoa";
    // No approved policy matched, and the model ticked nothing.
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

    expect(values.policy_violated).toBeUndefined();
    expect(values.policy_language).toBeUndefined();
    // Neither invention survives anywhere on the record.
    expect(JSON.stringify(values)).not.toContain("Attendance Policy Section 4.2");
    expect(JSON.stringify(values)).not.toContain("immediate termination");
    // The ordinary field still went through.
    expect(values.observation).toBe("Arrived twenty minutes late.");

    /*
     * BOTH ARE REPORTED AS WANTED AND NOT WRITTEN, for two different reasons:
     * no box was ticked, so there is no category to copy; and no manual
     * answered, so there is none to name. The manager fills both.
     */
    expect(payload.withheld).toEqual(["policy_violated", "policy_language"]);
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

      /*
       * BOTH FIELDS FILLED, AND NEITHER COMPOSED. Policy Violated is the box
       * the manager's account ticked; Direct policy names the manual that
       * answered, with its section and page.
       */
      expect(state.persisted[0]!.values.policy_violated).toBe("Tardiness/Leaving Early");
      expect(state.persisted[0]!.values.policy_language).toBe(
        "JBA Policy Manual — Attendance & Punctuality, page 12",
      );
      expect(payload.policyDerived).toEqual(["policy_violated", "policy_language"]);
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

      /*
       * POLICY VIOLATED IS THE TICKED CATEGORY, which is a restatement of the
       * box printed above it rather than a claim about a manual. DIRECT POLICY
       * is empty, because no manual answered — and the model's invented title
       * and placeholder are both gone.
       */
      expect(state.persisted[0]!.values.policy_violated).toBe("Dress Code Violation");
      expect(state.persisted[0]!.values.policy_language).toBeUndefined();
      expect(payload.withheld).toEqual(["policy_language"]);

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
        },
        checked: { offense_type: ["dress_code"] },
      };

      const payload = await post(SKIRT);

      expect(state.persisted[0]!.values.policy_violated).toBe("Dress Code Violation");
      expect(state.persisted[0]!.values.policy_language).toBe(
        "JBA Policy Manual — Appearance Standards, page 8",
      );
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
  /*
   * ==========================================================================
   * THE DERIVATION IS WHAT SETTLES THIS NOW
   * ==========================================================================
   *
   * This used to assert that "Dress Code Violation" was REFUSED as a policy
   * title, because Policy Violated meant "the policy's own title". The business
   * settled that the field holds the offense CATEGORY, so the refusal no longer
   * applies to it — and a stronger property took its place: neither field is
   * the model's to write at all. Whatever it composed is overridden by the tick
   * and by the retrieval.
   */
  it("overrides whatever the model composed in either policy field", async () => {
    state.policyHits = approvedPolicy(
      "JBA Policy Manual",
      "Appearance Standards, page 8",
      "Skirts and dresses must reach mid-thigh or longer while on the salon floor.",
    );
    state.toolInput = {
      values: {
        policy_violated: "Sun Tan City Handbook 4.1 (invented)",
        policy_language: "Employees may never wear skirts of any length. (invented)",
      },
      checked: { offense_type: ["dress_code"] },
    };

    const payload = await post("She was wearing a mini skirt today.");

    expect(state.persisted[0]!.values.policy_violated).toBe("Dress Code Violation");
    expect(state.persisted[0]!.values.policy_language).toBe(
      "JBA Policy Manual — Appearance Standards, page 8",
    );
    expect(JSON.stringify(state.persisted[0]!.values)).not.toContain("invented");
    expect(payload.policyDerived).toEqual(["policy_violated", "policy_language"]);
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

/* ==================================================================== */
/*  THE MINI-SKIRT CASE, END TO END, THROUGH THE REAL CHAIN             */
/* ==================================================================== */

/**
 * ============================================================================
 * QA'S CONVERSATION, AND THE THREE THINGS THAT WENT WRONG IN IT
 * ============================================================================
 *
 *   "corrective action form"
 *   1. Sarah Test / 2. Kearny / 3. today / 4. she was wearing mini skirt today
 *   5. verbal warning / 6. this is the first time
 *
 * The model output below is the reference platform's own, replayed verbatim,
 * because it contains all three defects at once:
 *
 *   an invented calendar date, where the manager said "today";
 *   a breach conclusion, on a form whose policy fields nothing could fill;
 *   an invented clothing rule in the Action Plan.
 *
 * Every guard in the chain runs. What comes out is what a manager would sign.
 */
describe("the mini-skirt case, end to end", () => {
  const NOTES = [
    "1. Sarah Test",
    "2. Kearny",
    "3.today",
    "4.she was wearing mini skirt today",
    "5. verbal warning",
    "6.this is the first time",
  ].join("\n");

  /** The reference platform's output, defects and all. */
  const QA_MODEL_OUTPUT = {
    values: {
      observation: [
        "Observed: On September 10, 2026, Sarah Test was observed wearing a mini skirt at the Kearny salon location, which is not in compliance with the Sun Tan City dress code policy.",
        "",
        "Expectation: Sarah is expected to adhere to the Sun Tan City dress code by wearing appropriate attire.",
        "",
        "Going Forward: She should check her outfit against the current standard before her shift.",
      ].join("\n"),
      policy_violated: "Dress Code Violation",
      policy_language: "[Verify exact policy language from official manual]",
      action_plan:
        "Sarah must wear pants instead of skirts. Management will monitor compliance and provide coaching as needed.",
      previous_action: "None - first occurrence",
    },
    checked: { offense_type: ["dress_code"], warning_type: ["verbal"] },
  };

  beforeEach(() => {
    state.templateKey = "dpoa";
    state.policyHits = [];
    state.toolInput = QA_MODEL_OUTPUT;
  });

  it("keeps the observation factual, dated from the form rather than the model", async () => {
    const payload = await post(NOTES);

    const observation = state.persisted[0]!.values.observation!;

    // The fact is there. Before this work the whole sentence was deleted,
    // because the model's invented date made it ungrounded.
    expect(observation).toContain("Sarah Test was observed wearing a mini skirt");
    expect(observation).toContain("Kearny");

    // The date is the form's own, resolved from `form_date`, not the model's.
    expect(observation).toContain("September 10, 2026");
    expect(payload.datesCorrected).toEqual([]);

    // And no breach conclusion, because nothing was retrieved to support one.
    expect(observation).not.toMatch(/not in compliance/i);
    expect(observation).not.toMatch(/violat/i);
    expect(payload.policyClaims).toEqual({ adjusted: ["observation"], emptied: [] });

    // The concurrent narrative shape is untouched.
    expect(observation).toContain("Observed:");
    expect(observation).toContain("Expectation:");
    expect(observation).toContain("Going Forward:");
  });

  it("fills Policy Violated from the tick and leaves the manual unnamed", async () => {
    const payload = await post(NOTES);

    // The category the manager's account ticked — a restatement of the box.
    expect(state.persisted[0]!.values.policy_violated).toBe("Dress Code Violation");
    // No manual answered, so none is named, and the placeholder is gone.
    expect(state.persisted[0]!.values.policy_language).toBeUndefined();
    expect(JSON.stringify(state.persisted[0]!.values)).not.toContain("Verify exact policy");

    /*
     * TWO DIFFERENT GUARDS REFUSED THE TWO FIELDS, and the payload says which.
     * `policy_language` never reached the policy guard: it was a bracketed
     * placeholder, so `stripPlaceholdersFromDraft` emptied it first. That is
     * the chain working, not a gap — what matters is that neither value is on
     * the record and the manager is told why.
     */
    expect(payload.withheld).toEqual(["policy_language"]);
  });

  it("refuses the invented clothing rule and states the expectation it can support", async () => {
    const payload = await post(NOTES);

    const plan = state.persisted[0]!.values.action_plan!;

    expect(plan).not.toMatch(/must wear pants/i);
    expect(plan).not.toMatch(/instead of skirts/i);
    // What the manager gets instead commits the employee without inventing
    // what the requirement is, and commits management to checking it.
    expect(plan).toMatch(/expected to comply with the current .* requirements/i);
    expect(plan).toMatch(/review the applicable expectation/i);
    // The sentence that was always fine survives beside it.
    expect(plan).toContain("Management will monitor compliance");
    expect(payload.policyRequirements).toEqual({ adjusted: ["action_plan"], replaced: [] });
  });

  it("classifies the offense and the warning level from the manager's own answers", async () => {
    await post(NOTES);

    expect(state.persisted[0]!.checked.offense_type).toEqual(["dress_code"]);
    expect(state.persisted[0]!.checked.warning_type).toEqual(["verbal"]);
    expect(state.persisted[0]!.values.previous_action).toBe("None - first occurrence");
  });

  it("tells the manager everything it removed and why", async () => {
    const payload = await post(NOTES);

    expect(String(payload.notice)).toMatch(/no approved policy matched/i);
    expect(String(payload.notice)).toMatch(/removed the statement that a policy was breached/i);
    expect(String(payload.notice)).toMatch(/removed a specific requirement/i);
  });

  it("still retrieves the framework deterministically, by its role", async () => {
    await post(NOTES);

    expect(state.roleCalls).toContain(PROGRESSION_ID);
    expect(prompt()).toContain("PERFORMANCE MANAGEMENT FRAMEWORK");
    // And the form's own date is given rather than left to be invented.
    expect(systemPrompt()).toMatch(/FORM DATE: September 10, 2026 \(Thursday\)/);
  });

  /*
   * THE SAME TURN WITH THE MANUAL ANSWERING. Everything the guards removed
   * above is exactly what the form is for once an approved source backs it.
   */
  it("keeps the finding, the policy and a sourced requirement once the manual answers", async () => {
    state.policyHits = [
      {
        chunkId: "c1",
        documentId: "doc-manual",
        documentTitle: "JBA Policy Manual",
        locator: "Appearance Standards, Section 3.2",
        content: "Skirts and dresses must reach mid-thigh or longer while on the salon floor.",
        score: 0.81,
      },
    ];
    state.toolInput = {
      ...QA_MODEL_OUTPUT,
      values: {
        ...QA_MODEL_OUTPUT.values,
        policy_violated: "Appearance Standards, Section 3.2",
        policy_language:
          "Skirts and dresses must reach mid-thigh or longer while on the salon floor.",
        action_plan: "Sarah must ensure skirts reach mid-thigh or longer on every shift.",
      },
    };

    const payload = await post(NOTES);

    expect(state.persisted[0]!.values.policy_violated).toBe("Dress Code Violation");
    expect(state.persisted[0]!.values.policy_language).toBe(
      "JBA Policy Manual — Appearance Standards, Section 3.2",
    );
    // The requirement the manual actually states survives untouched.
    expect(state.persisted[0]!.values.action_plan).toBe(
      "Sarah must ensure skirts reach mid-thigh or longer on every shift.",
    );
    expect(payload.withheld).toEqual([]);
    expect(payload.policyRequirements).toEqual({ adjusted: [], replaced: [] });
    // And the observation may now say a rule was broken, because one was named.
    expect(state.persisted[0]!.values.observation).toMatch(/not in compliance/i);
  });
});

/* ==================================================================== */
/*  THE VERSION AN INSTANCE IS PINNED TO MUST NOT EMPTY THE FIELD       */
/* ==================================================================== */

/**
 * ============================================================================
 * POLICY VIOLATED CAME BACK BLANK ON FORMS WHOSE OFFENSE BOX WAS TICKED
 * ============================================================================
 *
 * The business reported the field still empty after the field was redefined and
 * the policy search was widened, and the reason was neither of those: the form
 * in front of them was PINNED to the version published before the redefinition,
 * where `policy_violated` still carried `policyGrounded`.
 *
 * On that version the retrieval gate ran over a value copied off a tick box,
 * found no verified retrieval standing behind it — because there is none to
 * have, and none is needed — and withheld it. The manager saw
 *
 *     Type of Offense: ☑ Dress Code Violation
 *     Policy Violated:
 *
 * which is the app refusing to repeat a word printed two lines above it.
 *
 * RE-PUBLISHING CANNOT FIX IT AND MUST NOT TRY. A pinned version is immutable
 * by design; a filed form keeps the document it was filed under. So the
 * exemption is keyed on what the FIELD MEANS, which does not change with the
 * version, and this block runs the same turn against both — the new version and
 * the old one — and demands the same answer.
 */
describe("an instance pinned to the older published version", () => {
  const NOTES = [
    "1. Sarah Test",
    "2. Kearny",
    "3.today",
    "4.she was wearing mini skirt today",
    "5. verbal warning",
    "6.this is the first time",
  ].join("\n");

  beforeEach(() => {
    state.templateKey = "dpoa";
    state.policyHits = [];
    state.toolInput = {
      values: {
        observation: "Observed: Sarah Test wore a mini skirt.",
        policy_violated: "Sun Tan City Dress Code Policy 4.1",
        policy_language: "[Verify exact policy language from official manual]",
      },
      checked: { offense_type: ["dress_code"], warning_type: ["verbal"] },
    };
  });

  it.each([false, true])(
    "fills Policy Violated from the tick — older pinned version: %s",
    async (older) => {
      state.policyViolatedGroundedOnPinnedVersion = older;

      const payload = await post(NOTES);

      expect(state.persisted[0]!.values.policy_violated).toBe("Dress Code Violation");
      // And the title the model invented is nowhere on the record.
      expect(JSON.stringify(state.persisted[0]!.values)).not.toContain("4.1");
      // Nor is the manager told to go and fill in a line that is filled.
      expect(payload.withheld).toEqual(["policy_language"]);
      expect(payload.policyDerived).toEqual(["policy_violated"]);
    },
  );

  /*
   * THE WRITE-TIME GUARD IS THE ONE THAT ACTUALLY REFUSES, and on the older
   * version it reads `policy_violated` as policy-grounded. It allows a value
   * through only on provenance that says verified, so the derived value has to
   * carry its own — naming the form as the source rather than a manual, which
   * is the distinction the audit trail has to keep.
   */
  it("sends the tick's own provenance to the write, not a retrieval's", async () => {
    state.policyViolatedGroundedOnPinnedVersion = true;

    await post(NOTES);

    expect(state.persisted[0]!.provenance.policy_violated).toEqual({
      grounded: false,
      derived: true,
      source: "offense_type",
      verified: true,
    });
  });

  /*
   * AND THE FIELD THAT NAMES A MANUAL IS NOT EXEMPTED WITH IT. This is the half
   * that must not have been loosened: on the older version, exactly as on the
   * new one, an unsourced `policy_language` stays off the record.
   */
  it("still fails closed on the field that names a manual", async () => {
    state.policyViolatedGroundedOnPinnedVersion = true;
    state.toolInput = {
      values: {
        observation: "Observed: Sarah Test wore a mini skirt.",
        policy_language: "Skirts must reach mid-thigh.",
      },
      checked: { offense_type: ["dress_code"] },
    };

    const payload = await post(NOTES);

    expect(state.persisted[0]!.values.policy_language).toBeUndefined();
    expect(state.persisted[0]!.provenance.policy_language).toBeUndefined();
    expect(payload.withheld).toContain("policy_language");
  });

  /*
   * ONCE A MANUAL DOES ANSWER, the older version behaves like the new one in
   * both fields — the reference is written with the retrieval's own provenance,
   * which is what the finalize gate and the form card read.
   */
  it("names the manual on the older version too, with the retrieval's provenance", async () => {
    state.policyViolatedGroundedOnPinnedVersion = true;
    state.policyHits = [
      {
        chunkId: "c1",
        documentId: "doc-manual",
        documentTitle: "Driven to Shine Policy Manual 2.2025",
        locator: "Dress for Success — Tanning Consultant, page 12",
        content: "Skirts and dresses must reach mid-thigh or longer while on the salon floor.",
        score: 0.79,
      },
    ];
    state.toolInput = {
      values: {
        observation: "Observed: Sarah Test wore a mini skirt.",
        policy_language: "Skirts and dresses must reach mid-thigh or longer while on the salon floor.",
      },
      checked: { offense_type: ["dress_code"] },
    };

    const payload = await post(NOTES);

    expect(state.persisted[0]!.values.policy_violated).toBe("Dress Code Violation");
    expect(state.persisted[0]!.values.policy_language).toBe(
      "Driven to Shine Policy Manual 2.2025 — Dress for Success — Tanning Consultant, page 12",
    );
    expect(state.persisted[0]!.provenance.policy_language).toMatchObject({
      grounded: true,
      verified: true,
    });
    expect(payload.withheld).toEqual([]);
  });
});

/* ==================================================================== */
/*  THE MANUAL IS NAMED BY IDENTITY, NOT FOUND BY SIMILARITY            */
/* ==================================================================== */

/**
 * ============================================================================
 * "REFER ALWAYS TO THIS"
 * ============================================================================
 *
 * Direct policy from official manual stayed blank on a form whose offense box
 * was ticked, and the manual was in the corpus the whole time — indexed, 105
 * chunks, holding the section the business names. What it was not was
 * RETRIEVABLE from the sentence a manager types: "she was wearing slippers
 * today" carries none of the manual's vocabulary, and the reference was built
 * from a semantic search gated at the threshold the open-ended chat path uses.
 *
 * So the manual is pinned by identity and the ticked offense chooses the
 * section, which is what the business asked for in those words. These are the
 * two halves that have to hold together: the citation appears when the manual
 * answers, and NOTHING appears when it does not.
 */
describe("the official policy manual, pinned", () => {
  const NOTES = "Paulyne was wearing slippers on shift today.";

  /** The real manual's shapes: a running title, a printed page, a heading. */
  const SHEET = (page: number, heading: string, body: string) => ({
    chunkIndex: page,
    page: page + 1,
    content: `Driven to Shine Policy Manual\n- ${page} -\n${heading}\n${body}`,
  });

  const MANUAL = {
    ok: true,
    documentId: "doc-manual",
    documentTitle: "Driven to Shine Policy Manual 2.2025",
    matchedBy: "fallback",
    chunks: [
      SHEET(11, "Dress for Success - Store Management", "THE COMPANY encourages all store management"),
      SHEET(12, "Dress for Success - Tanning Consultant", "No dress code can cover all contingencies,"),
      SHEET(13, "Personal Hygiene, Body Art, Piercings, Hair", "All employees are to maintain"),
    ],
  };

  beforeEach(() => {
    state.templateKey = "dpoa";
    state.policyHits = [];
    state.policyManual = MANUAL;
    state.toolInput = {
      values: { observation: "Observed: Paulyne wore slippers on shift." },
      checked: { offense_type: ["dress_code"], warning_type: ["verbal"] },
    };
  });

  it("cites the manual, the section and the page the manual prints", async () => {
    const payload = await post(NOTES);

    expect(state.persisted[0]!.values.policy_language).toBe(
      "Driven to Shine Policy Manual 2.2025 — Dress for Success - Tanning Consultant, page 12",
    );
    expect(payload.withheld).toEqual([]);
    expect(payload.policyDerived).toEqual(["policy_violated", "policy_language"]);
  });

  it("does it with NOTHING retrieved, which is the whole point", async () => {
    // `state.policyHits` is empty: the semantic search found nothing, exactly
    // as it did in production. The citation no longer depends on it.
    await post(NOTES);

    expect(state.persisted[0]!.values.policy_language).toContain("page 12");
  });

  it("carries provenance naming the document rather than a score", async () => {
    await post(NOTES);

    expect(state.persisted[0]!.provenance.policy_language).toMatchObject({
      grounded: true,
      verified: true,
      source: "official_policy_manual",
      documentId: "doc-manual",
      locator: "Dress for Success - Tanning Consultant",
      page: 12,
    });
  });

  it("cites the management section for a manager, from the same manual", async () => {
    /*
     * READ OFF THE INSTANCE, never off the draft. Job Title is a system field:
     * the model cannot write it, so which of a split section applies is settled
     * by the role recorded when the form was created.
     */
    state.employeeRole = "Salon Director";
    state.toolInput = {
      values: { observation: "Observed: she wore slippers on shift." },
      checked: { offense_type: ["dress_code"] },
    };

    await post(NOTES);

    expect(state.persisted[0]!.values.policy_language).toBe(
      "Driven to Shine Policy Manual 2.2025 — Dress for Success - Store Management, page 11",
    );
  });

  /*
   * ==========================================================================
   * THE FAIL-CLOSED HALF
   * ==========================================================================
   *
   * Everything below leaves the field EMPTY, reports it as withheld, and leaves
   * the finalize acknowledgement in force. A citation that appeared anyway
   * would be the failure this whole area exists to prevent — it would look
   * checked.
   */
  it("cites nothing for an offense whose section the manual does not head", async () => {
    state.toolInput = {
      values: { observation: "Observed: she was late." },
      checked: { offense_type: ["tardiness"] },
    };

    const payload = await post("Paulyne was twenty minutes late today.");

    expect(state.persisted[0]!.values.policy_language).toBeUndefined();
    expect(payload.withheld).toContain("policy_language");
  });

  it("cites nothing when no box is ticked", async () => {
    state.toolInput = { values: { observation: "Observed: something happened." }, checked: {} };

    const payload = await post(NOTES);

    expect(state.persisted[0]!.values.policy_language).toBeUndefined();
    expect(payload.withheld).toContain("policy_language");
  });

  it("cites nothing when the manual is not in the knowledge base", async () => {
    state.policyManual = { ok: false, reason: "not indexed" };

    const payload = await post(NOTES);

    expect(state.persisted[0]!.values.policy_language).toBeUndefined();
    expect(payload.withheld).toContain("policy_language");
  });

  it("cites nothing when two documents claim to be the manual", async () => {
    state.policyManual = { ok: false, reason: "More than one document claims to be it." };

    const payload = await post(NOTES);

    expect(state.persisted[0]!.values.policy_language).toBeUndefined();
    expect(payload.withheld).toContain("policy_language");
  });

  it("drafts the rest of the form when the manual cannot be read at all", async () => {
    state.policyManual = { ok: false, reason: "The official policy manual could not be read." };

    await post(NOTES);

    // A knowledge-base outage costs a citation, never the draft.
    expect(state.persisted[0]!.values.observation).toContain("slippers");
    expect(state.persisted[0]!.values.policy_violated).toBe("Dress Code Violation");
  });

  /*
   * AND THE OBSERVATION IS UNCHANGED BY ANY OF IT. Naming the manual a category
   * was checked against is a different claim from asserting the manual was
   * BROKEN, and only a retrieved passage still licenses the second one.
   */
  it("does not let the citation license a breach conclusion in the observation", async () => {
    state.toolInput = {
      values: {
        observation:
          "Observed: Paulyne wore slippers on shift, which is not in compliance with the dress code policy.",
      },
      checked: { offense_type: ["dress_code"] },
    };

    const payload = await post(NOTES);

    expect(state.persisted[0]!.values.observation).not.toMatch(/not in compliance/i);
    expect(payload.policyClaims).toEqual({ adjusted: ["observation"], emptied: [] });
  });
});

/* ==================================================================== */
/*  WHERE APPROVED POLICY IS ALLOWED TO COME FROM                       */
/* ==================================================================== */

/**
 * ============================================================================
 * THE BLANK POLICY FIELDS WERE A FILTER, NOT A MISSING DOCUMENT
 * ============================================================================
 *
 * Every Corrective Action Form came back with Policy Violated and Direct
 * policy empty, and the notice dutifully said no approved policy had matched.
 * The manual was in the corpus the whole time.
 *
 * `groundPolicy` searched `["policies_compliance"]` alone, on the assumption —
 * written into the old comment — that this was "the corpus's own category for
 * the manual". It is not. The Driven to Shine Policy Manual, which holds Dress
 * for Success, Attendance, Absenteeism and the Standards of Conduct, is filed
 * under OPERATIONS. So the one document a corrective action needs to quote was
 * the one document the search could not see.
 *
 * A CATEGORY IS A FILING DECISION. Whoever uploads the manual picks the shelf,
 * and they are not thinking about this function when they do it.
 */
describe("the approved-policy search", () => {
  beforeEach(() => {
    state.templateKey = "dpoa";
  });

  it("looks where the business actually files its policy manual", async () => {
    await post("She was wearing a mini skirt at the front desk today.");

    expect(state.policySearches).toHaveLength(1);
    const categories = state.policySearches[0]!.categories ?? [];

    // The regression: Operations is where the live manual sits.
    expect(categories).toContain("operations");
    expect(categories).toContain("policies_compliance");
    // And the other shelves that hold rules the company issues.
    expect(categories).toEqual(
      expect.arrayContaining(["safety", "equipment_procedures", "bonuses_compensation"]),
    );
  });

  /*
   * THE EXCLUSIONS ARE THE IMPORTANT HALF. This is a widening, so what still
   * enforces the source hierarchy is what is kept OUT — above all the
   * framework's own shelf, because the framework says HOW to document and is
   * explicitly not a source of official policy.
   */
  it("never lets the Performance Management Framework answer a policy question", async () => {
    await post("She was wearing a mini skirt at the front desk today.");

    const categories = state.policySearches[0]!.categories ?? [];
    for (const excluded of [
      "leadership_coaching",
      "training",
      "sales_client_experience",
      "reports_analytics",
      "other",
    ]) {
      expect(categories, excluded).not.toContain(excluded);
    }
  });

  it("searches on the manager's own words, never on the model's output", async () => {
    await post("She was wearing a mini skirt at the front desk today.");

    expect(state.policySearches[0]!.query).toContain("mini skirt");
    // The model has not run when the policy query is built.
    expect(state.policySearches[0]!.query).not.toContain("Appearance Standards");
  });

  it("populates both fields once the manual is reachable", async () => {
    state.policyHits = [
      {
        chunkId: "c1",
        documentId: "doc-manual",
        // Filed under Operations, exactly as the live corpus has it.
        documentTitle: "Driven to Shine Policy Manual 2.2025",
        locator: "Dress for Success — Tanning Consultant, page 12",
        content:
          "Employees are to keep a neat, clean and professional appearance always. Anyone violating this policy can and may be sent home to change into proper work attire.",
        score: 0.71,
      },
    ];
    state.toolInput = {
      values: {},
      checked: { offense_type: ["dress_code"] },
    };

    const payload = await post("She was wearing a mini skirt at the front desk today.");

    /*
     * THE MANUAL, NAMED WITH ITS SECTION AND PAGE, exactly as the business
     * asked — and the offense category from the tick beside it.
     */
    expect(state.persisted[0]!.values.policy_violated).toBe("Dress Code Violation");
    expect(state.persisted[0]!.values.policy_language).toBe(
      "Driven to Shine Policy Manual 2.2025 — Dress for Success — Tanning Consultant, page 12",
    );
    expect(payload.withheld).toEqual([]);
    expect(payload.sources).toEqual([
      expect.objectContaining({ documentTitle: "Driven to Shine Policy Manual 2.2025" }),
    ]);
  });
});
