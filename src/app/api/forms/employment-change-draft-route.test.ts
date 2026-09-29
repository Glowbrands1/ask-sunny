import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseFormDocument } from "@/lib/forms/document";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import { draftNotesFromConversation } from "@/lib/forms/draft-notes";

/**
 * Drafting a Demotion or Position Transfer Form: the facts come from the
 * manager's own words through `applyStatedFacts`, BEFORE the model runs, and
 * the model is offered — and can keep — nothing but the reason paragraph.
 */

const state = vi.hoisted(() => ({
  templateKey: "demotion",
  modelInput: null as Record<string, unknown> | null,
  modelCalls: 0,
  modelFails: false,
  toolInput: {} as Record<string, unknown>,
  stated: [] as { values: Record<string, string>; checked: Record<string, string[]> }[],
  drafted: [] as { values: Record<string, string>; checked: Record<string, string[]> }[],
  order: [] as string[],
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
          variantKey: null,
          employeeName: "Jane Doe (test)",
          employeeRole: null,
          locationName: "KS Lawrence",
          formDate: "2026-09-28",
          status: "draft",
        },
        version: { document: parseFormDocument(seed.document), variants: [] },
      },
    };
  },
}));

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    async search() {
      throw new Error("no policy retrieval for a demotion reason");
    }
    async fetchRoleGrounding() {
      throw new Error("an employment change form is not governed by the ladder");
    }
    async fetchOfficialPolicyManual() {
      return { ok: false, reason: "not needed" };
    }
  },
}));

vi.mock("@/lib/knowledge", () => ({
  /* Server code must search through SupabaseKnowledgeProvider; the browser client cannot run here. */
  getKnowledgeProvider: () => {
    throw new Error("getKnowledgeProvider() is the browser knowledge client and must not be used on the server");
  },
}));

vi.mock("@/lib/forms/instances", () => ({
  applyStatedFacts: async (
    _id: string,
    stated: { values: Record<string, string>; checked: Record<string, string[]> },
  ) => {
    state.order.push("stated");
    state.stated.push(stated);
    return [...Object.keys(stated.values), ...Object.keys(stated.checked)];
  },
  applyAssistantDraft: async (
    _id: string,
    draft: { values: Record<string, string>; checked: Record<string, string[]> },
  ) => {
    state.drafted.push({ values: draft.values ?? {}, checked: draft.checked ?? {} });
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
        state.order.push("model");
        state.modelCalls += 1;
        state.modelInput = input;
        if (state.modelFails) throw new Error("model down");
        return { content: [{ type: "tool_use", name: "write_form_fields", input: state.toolInput }] };
      },
    },
  }),
}));

async function post(notes: string) {
  const { POST } = await import("./instances/[id]/draft/route");
  const request = new Request("http://localhost/api/forms/instances/form-1/draft", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ notes }),
  });
  return POST(request, { params: Promise.resolve({ id: "form-1" }) });
}

const NOTES =
  "Jane Doe, Salon Director FT at $18/hr → Tanning Consultant PT at $12/hr, effective 10/5, voluntary — she asked to step down to spend more time with family.";

beforeEach(() => {
  vi.resetModules();
  state.templateKey = "demotion";
  state.modelInput = null;
  state.modelCalls = 0;
  state.modelFails = false;
  state.toolInput = {};
  state.stated = [];
  state.drafted = [];
  state.order = [];
});

describe("drafting a Demotion Form", () => {
  it("writes the manager's stated facts before the model runs", async () => {
    state.toolInput = { values: { reason: "Jane requested a voluntary demotion." } };
    const response = await post(NOTES);
    expect(response.status).toBe(200);

    expect(state.order).toEqual(["stated", "model"]);
    expect(state.stated[0]!.values).toMatchObject({
      job_title: "Salon Director",
      current_pay_rate: "$18.00/hr",
      new_job_title: "Tanning Consultant",
      new_pay_rate: "$12.00/hr",
    });
    expect(state.stated[0]!.checked).toMatchObject({
      current_status: ["full_time"],
      new_status: ["part_time"],
      demotion_type: ["voluntary"],
    });
  });

  it("offers the model the reason paragraph and nothing else", async () => {
    await post(NOTES);
    const prompt = (state.modelInput?.messages as { content: string }[])[0]!.content;
    expect(prompt).toContain("- reason:");
    expect(prompt).not.toMatch(/- (?:new_job_title|new_pay_rate|current_pay_rate|new_location):/);
    expect(prompt).not.toContain("CHECKBOXES TO TICK");
  });

  it("keeps nothing the model writes into a fact", async () => {
    state.toolInput = {
      values: { reason: "Jane requested it.", new_pay_rate: "$20.00/hr" },
      checked: { demotion_type: ["involuntary"] },
    };
    await post(NOTES);
    expect(state.drafted[0]!.values).toEqual({ reason: "Jane requested it." });
    expect(state.drafted[0]!.checked).toEqual({});
  });

  it("keeps the stated facts when the model fails", async () => {
    state.modelFails = true;
    await expect(post(NOTES)).rejects.toThrow();
    expect(state.stated).toHaveLength(1);
  });
});

describe("other forms are untouched", () => {
  it("never reads stated facts onto a Coaching Form", async () => {
    state.templateKey = "coaching";
    await post("She is an SD at KS Lawrence and was 20 minutes late today.");
    expect(state.stated).toHaveLength(0);
  });
});


describe("found in production QA: the Demotion Form's Location", () => {
  it("writes Salon 12 onto the Location line from the manager's own words", async () => {
    // The live conversation, drafted from the manager turns the proposal named.
    const messages = [
      "Create a Demotion Form for a synthetic test employee named Demo Alpha Test at salon 12. Their current position is District Manager and the new position is Salon Director, effective October 5, 2026. The reason is a mock role realignment for QA.",
      "The employee is Demo Alpha Test. Salon 12 is the location. District Manager is the current position, Salon Director is the new position, and QA is just the reason/context.",
      "Demo Alpha Test.",
    ].map((content, index) => ({ id: `m${index + 1}`, role: "user" as const, content }));
    const notes = draftNotesFromConversation(messages, ["m1", "m2", "m3"]).text;

    state.toolInput = { values: { reason: "A mock role realignment for QA." } };
    await post(notes);
    expect(state.stated[0]!.values).toMatchObject({
      location: "Salon 12",
      job_title: "District Manager",
      new_job_title: "Salon Director",
    });
  });
});
