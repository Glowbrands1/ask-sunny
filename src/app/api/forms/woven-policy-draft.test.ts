import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseFormDocument } from "@/lib/forms/document";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import { ATTENDANCE_POLICY_TEXT, WovenIntoKnowledge } from "@/lib/knowledge-sync/woven/integration-support";

/* A fresh PGlite database per test: its start-up is slow under a parallel suite. */
vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

/**
 * ============================================================================
 * A POLICY-DEPENDENT FORM DRAFTS FROM THE CURRENT SYNCED WOVEN POLICY
 * ============================================================================
 *
 * Form workflow → Ask Sunny knowledge retrieval → indexed Woven knowledge.
 * Never form → Woven.
 *
 * The Attendance Policy is synced from (fake) Woven by the real engine into
 * the real pipeline on the repository's knowledge schema (PGlite). Then the
 * Corrective Action Form and the Policy Review are drafted through the real
 * route, whose `groundPolicy` search runs the REAL `SupabaseKnowledgeProvider`
 * against `match_knowledge_chunks`.
 *
 * What is replaced, and why: the model (so what it was SENT is observable),
 * the instance store and authorization (no forms schema here), and the two
 * provider reads that are not the subject — the Performance Management
 * Framework and the pinned policy manual, both resolved by tag, neither of
 * which a synced Woven policy is. The provider's SEARCH is not replaced.
 */

const state = vi.hoisted(() => ({
  modelInput: null as Record<string, unknown> | null,
  templateKey: "dpoa",
  persisted: [] as { values: Record<string, string> }[],
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
          employeeRole: null,
          locationName: "MO Kansas City Wornall",
          formDate: "2026-09-29",
          status: "draft",
        },
        version: { document: parseFormDocument(seed.document), variants: seed.variants },
      },
    };
  },
}));

vi.mock("@/lib/forms/instances", () => ({
  applyAssistantDraft: async (_id: string, draft: { values: Record<string, string>; checked: Record<string, string[]> }) => {
    state.persisted.push({ values: draft.values ?? {} });
    return { accepted: { values: draft.values ?? {}, checked: draft.checked ?? {} }, rejected: [], policyRefused: [] };
  },
}));

vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (input: Record<string, unknown>) => {
        state.modelInput = input;
        return { content: [{ type: "tool_use", name: "write_form_fields", input: { values: {}, checked: { offense_type: ["tardiness"] } } }] };
      },
    },
  }),
}));

/* The browser knowledge client must never be what the server searches with. */
vi.mock("@/lib/knowledge", () => ({
  getKnowledgeProvider: () => {
    throw new Error("getKnowledgeProvider() is the browser knowledge client and must not be used on the server");
  },
}));

vi.mock("@/lib/knowledge/providers/supabase", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/knowledge/providers/supabase")>();
  const row = (index: number, locator: string, content: string) => ({
    chunk_id: `pmf-${index}`,
    document_id: "doc-progression",
    document_title: "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
    category: "leadership_coaching",
    locator,
    page: null,
    section: null,
    content,
    similarity: 0,
  });
  class WithFixtureRoleDocuments extends real.SupabaseKnowledgeProvider {
    override async fetchRoleGrounding() {
      return {
        ok: true,
        grounding: {
          role: { id: "performance_management_framework" },
          documentId: "doc-progression",
          documentTitle: "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
          matchedBy: "tag",
          rows: [
            row(0, "SECTION 2 – PERFORMANCE MANAGEMENT LADDER", "Solve the issue at the lowest appropriate level."),
            row(1, "10.7 Final operating rule for Ask Sunny", "Classify the issue before escalating."),
          ],
          presentGroups: ["escalation_ladder", "final_operating_rule"],
        },
      } as never;
    }
    override async fetchOfficialPolicyManual() {
      return { ok: false, reason: "No pinned manual in this corpus." } as never;
    }
  }
  return { ...real, SupabaseKnowledgeProvider: WithFixtureRoleDocuments };
});

async function draft(notes: string) {
  state.modelInput = null;
  state.persisted = [];
  const { POST } = await import("./instances/[id]/draft/route");
  const response = await POST(
    new Request("http://localhost/api/forms/instances/form-1/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes }),
    }),
    { params: Promise.resolve({ id: "form-1" }) },
  );
  return (await response.json()) as { sources?: { documentId: string; documentTitle: string }[]; withheld?: string[] };
}

const prompt = () => ((state.modelInput?.messages as { content: string }[] | undefined)?.[0]?.content ?? "");

/* Worded in the policy's vocabulary: the test embedder is lexical (see `bagOfWordsEmbedding`). */
const NOTES = "Attendance policy: did not arrive on time; did not call the salon; late.";
const UPDATED_NOTES = "Attendance policy: did not arrive on time for the shift; did not text the salon director before the shift started; late.";

let h: WovenIntoKnowledge;

beforeEach(async () => {
  h = await WovenIntoKnowledge.create();
  state.templateKey = "dpoa";
});

afterEach(async () => {
  await h.close();
});

describe("policy-dependent forms use the current synced Woven policy", () => {
  it.each(["dpoa", "policy-review"])("%s: the Woven Attendance Policy reaches the draft as approved policy, with its source", async (key) => {
    state.templateKey = key;
    await h.initial();
    const id = await h.documentId(ATTENDANCE_POLICY_TEXT);

    const payload = await draft(NOTES);

    expect(prompt()).toContain("APPROVED POLICY (quote only from this, verbatim)");
    expect(prompt()).toContain("Call the salon if you will be late.");
    expect(prompt()).toContain("Attendance Policy");
    expect(prompt()).not.toContain("APPROVED POLICY: none found");
    expect(payload.sources).toEqual(expect.arrayContaining([expect.objectContaining({ documentId: id, documentTitle: "Attendance Policy" })]));
    expect(JSON.stringify(payload)).not.toMatch(/https?:\/\/|blob\.core\.windows\.net|sig=/);
  });

  it("after Woven updates the policy, the next draft uses the new text and not the old", async () => {
    await h.initial();
    const id = await h.documentId(ATTENDANCE_POLICY_TEXT);
    const policy = h.fake.state.policies[0]!;
    policy.body = "Arrive on time for every shift.\nText your salon director if you will be late, before the shift starts.";
    policy.updated = "10/1/2026";
    await h.run("sync");

    const payload = await draft(UPDATED_NOTES);

    expect(prompt()).toContain("Text your salon director if you will be late");
    expect(prompt()).not.toContain("Call the salon if you will be late.");
    expect(payload.sources).toEqual(expect.arrayContaining([expect.objectContaining({ documentId: id })]));
  });

  it("after Woven unpublishes the policy, a draft no longer quotes it", async () => {
    await h.initial();
    const id = await h.documentId(ATTENDANCE_POLICY_TEXT);
    h.fake.state.policies[0]!.status = "draft";
    await h.run("sync");

    const payload = await draft(NOTES);

    expect(prompt()).not.toContain("Call the salon if you will be late.");
    expect(prompt()).toContain("APPROVED POLICY: none found");
    expect((payload.sources ?? []).some((source) => source.documentId === id)).toBe(false);
  });
});
