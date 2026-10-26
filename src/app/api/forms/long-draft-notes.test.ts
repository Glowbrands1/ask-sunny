import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseFormDocument } from "@/lib/forms/document";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";

/**
 * ============================================================================
 * A LONG ACCOUNT IS DRAFTED WHOLE (LONG_DRAFT_NOTES_ENABLED)
 * ============================================================================
 *
 * The model, the store and every provider are mocked, and the assertions are on
 * WHAT THE MODEL WAS SHOWN and WHAT THE PERSISTENCE CALL RECEIVED — the same
 * approach as `pm-draft-route.test.ts`. The questions:
 *
 *   - are the dates and Resignation Details ticks computed from the manager's
 *     notes, whatever the model returned for them?
 *   - can the model reach the yes/no questions, the involuntary box, or a
 *     signature? (It must not.)
 *   - does Details lose a sentence that answers a question nobody answered?
 *   - are HR's Details lines (resignation date, how and why, and the yes/no
 *     answers) filled from the MANAGER'S words through `applyStatedFacts`,
 *     and never through the model?
 */

const state = vi.hoisted(() => ({
  modelInput: null as Record<string, unknown> | null,
  modelCalls: 0,
  toolInput: {} as Record<string, unknown>,
  persisted: [] as {
    values: Record<string, string>;
    checked: Record<string, string[]>;
  }[],
  /** Header overrides for one test: the employee, title and salon on the record. */
  instance: {} as Record<string, unknown>,
  stated: [] as {
    values: Record<string, string>;
    checked: Record<string, string[]>;
    keys: ReadonlySet<string> | undefined;
  }[],
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
    const seed = TEMPLATE_SEEDS.find((entry) => entry.key === "stc-exit")!;
    return {
      actor: {
        id: "demo:salon_director:QA",
        role: "salon_director",
        verified: false,
        scope: null,
      },
      loaded: {
        instance: {
          id: "form-1",
          templateKey: seed.key,
          templateName: seed.name,
          layoutFamily: seed.layoutFamily,
          variantKey: null,
          employeeName: "Sarah Jones",
          employeeRole: "Tanning Consultant",
          locationName: null,
          formDate: "2026-09-28",
          status: "draft",
          ...state.instance,
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
    async search() {
      throw new Error("the exit form retrieves no policy");
    }
    async fetchRoleGrounding() {
      throw new Error(
        "the exit form is not governed by the performance-management framework",
      );
    }
    async fetchOfficialPolicyManual() {
      throw new Error("the exit form cites no manual");
    }
  },
}));

vi.mock("@/lib/knowledge", () => ({
  /* Server code must search through SupabaseKnowledgeProvider; the browser client cannot run here. */
  getKnowledgeProvider: () => {
    throw new Error(
      "getKnowledgeProvider() is the browser knowledge client and must not be used on the server",
    );
  },
}));

vi.mock("@/lib/forms/instances", () => ({
  applyStatedFacts: async (
    _id: string,
    stated: {
      values: Record<string, string>;
      checked: Record<string, string[]>;
    },
    _actor: string,
    keys?: ReadonlySet<string>,
  ) => {
    state.stated.push({ values: stated.values, checked: stated.checked, keys });
    return [...Object.keys(stated.values), ...Object.keys(stated.checked)];
  },
  applyAssistantDraft: async (
    _id: string,
    draft: {
      values: Record<string, string>;
      checked: Record<string, string[]>;
    },
  ) => {
    state.persisted.push({
      values: draft.values ?? {},
      checked: draft.checked ?? {},
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
          content: [
            {
              type: "tool_use",
              name: "write_form_fields",
              input: state.toolInput,
            },
          ],
        };
      },
    },
  }),
}));

async function post(notes: string) {
  const { POST } = await import("./instances/[id]/draft/route");
  const request = new Request(
    "http://localhost/api/forms/instances/form-1/draft",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes }),
    },
  );
  const response = await POST(request, {
    params: Promise.resolve({ id: "form-1" }),
  });
  return (await response.json()) as Record<string, unknown>;
}

const prompt = () =>
  (state.modelInput?.messages as { content: string }[] | undefined)?.[0]
    ?.content ?? "";

/*
 * QA, 26 Oct 2026: with 12,000-character chat messages coming, the draft
 * route cut the notes at 4,000 and a long account was drafted from its start
 * only. The account below is invented; its last sentence and the last day it
 * gives sit past character 4,000.
 */
const FLAG = "LONG_DRAFT_NOTES_ENABLED";
const stored = () => state.persisted[0]!;
const LAST_SENTENCE =
  "Her last day worked was 9/28 and she returned the store items before leaving.";
const FILLER =
  "Ava covered the front desk, greeted clients and restocked the lotion wall during her shifts. ";
const LONG_ACCOUNT = `${FILLER.repeat(Math.ceil(11_800 / FILLER.length))}${LAST_SENTENCE}`;

beforeEach(() => {
  state.modelInput = null;
  state.modelCalls = 0;
  state.toolInput = { details: "Ava resigned." };
  state.persisted = [];
  state.instance = {};
  state.stated = [];
});

afterEach(() => {
  delete process.env[FLAG];
});

describe("LONG_DRAFT_NOTES_ENABLED", () => {
  it("the account is longer than 4,000 and under 12,000 characters, its last sentence at the end", () => {
    expect(LONG_ACCOUNT.length).toBeGreaterThan(4_000);
    expect(LONG_ACCOUNT.length).toBeLessThanOrEqual(12_000);
    expect(LONG_ACCOUNT.indexOf(LAST_SENTENCE)).toBeGreaterThan(4_000);
  });

  it("off: the 4,000-character cut stays — the last sentence never reaches the model", async () => {
    await post(LONG_ACCOUNT);
    expect(prompt()).not.toContain(LAST_SENTENCE);
    expect(prompt()).toContain(FILLER.trim());
  });

  it("on: the whole account reaches the model and its last day is read", async () => {
    process.env[FLAG] = "true";
    await post(LONG_ACCOUNT);
    expect(prompt()).toContain(LAST_SENTENCE);
    expect(JSON.stringify(stored().values)).toContain("2026-09-28");
  });

  it.each([
    ["all lowercase", (text: string) => text.toLowerCase()],
    [
      "sentence case",
      (text: string) => text.charAt(0).toUpperCase() + text.slice(1),
    ],
  ])("on, %s: the last sentence reaches the model", async (_register, as) => {
    process.env[FLAG] = "true";
    await post(as(LONG_ACCOUNT));
    expect(prompt().toLowerCase()).toContain(LAST_SENTENCE.toLowerCase());
  });

  it("NEVER-BREAK: a short account reaches the model whole, flag on or off", async () => {
    for (const on of [false, true]) {
      if (on) process.env[FLAG] = "true";
      else delete process.env[FLAG];
      await post("ava resigned 9/15 by text, last day 9/28");
      expect(prompt()).toContain("ava resigned 9/15 by text, last day 9/28");
    }
  });
});
