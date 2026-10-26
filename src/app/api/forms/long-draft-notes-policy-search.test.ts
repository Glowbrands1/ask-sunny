import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseFormDocument } from "@/lib/forms/document";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";

/**
 * LONG_DRAFT_NOTES_ENABLED: the policy search reads a short query, not the
 * whole account (coordinator ruling, 26 Oct 2026). With the flag the model
 * gets up to 24,000 characters of notes; the approved-policy search gets
 * their first 1,500 and last 500, so a long account still grounds the right
 * policy. The harness is `pm-draft-route.test.ts`'s: the route is real, the
 * model, the store and the knowledge provider are stand-ins. Invented names.
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
    async search(input: { query: string; categories?: string[] }) {
      state.policySearches.push(input);
      return state.policyHits;
    }
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
  /* Server code must search through SupabaseKnowledgeProvider; the browser client cannot run here. */
  getKnowledgeProvider: () => {
    throw new Error("getKnowledgeProvider() is the browser knowledge client and must not be used on the server");
  },
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


const FLAG = "LONG_DRAFT_NOTES_ENABLED";
const INCIDENT = "Ava Pellmore was wearing a mini skirt at the front desk today.";
const FILLER = "Ava greeted clients, restocked the shelves and covered the phones during her shift. ";
const LONG = `${INCIDENT} ${FILLER.repeat(Math.ceil(11_000 / FILLER.length))}She was asked to change and did.`;

describe("LONG_DRAFT_NOTES_ENABLED: the approved-policy search", () => {
  beforeEach(() => {
    state.templateKey = "dpoa";
  });
  afterEach(() => {
    delete process.env[FLAG];
  });

  it("on: the search query is short and still carries the incident; the model gets the whole account", async () => {
    process.env[FLAG] = "true";
    await post(LONG);
    const query = state.policySearches[0]!.query;
    expect(query.length).toBeLessThanOrEqual(2_100);
    expect(query).toContain("mini skirt");
    expect(query).toContain("asked to change");
    expect(prompt()).toContain("She was asked to change and did.");
  });

  it.each([
    ["all lowercase", (text: string) => text.toLowerCase()],
    ["sentence case", (text: string) => text.charAt(0).toUpperCase() + text.slice(1)],
  ])("on, %s: the incident still reaches the search", async (_register, as) => {
    process.env[FLAG] = "true";
    await post(as(LONG));
    expect(state.policySearches[0]!.query.toLowerCase()).toContain("mini skirt");
  });

  for (const on of [false, true]) {
    it(`NEVER-BREAK (flag ${on ? "on" : "off"}): a short account is searched whole, as before`, async () => {
      if (on) process.env[FLAG] = "true";
      await post(INCIDENT.toLowerCase());
      expect(state.policySearches[0]!.query).toContain(INCIDENT.toLowerCase());
    });
  }

  it("off: the notes are cut at 4,000 as before, so the search never sees the account's end", async () => {
    await post(LONG);
    expect(state.policySearches[0]!.query).not.toContain("asked to change");
  });
});
