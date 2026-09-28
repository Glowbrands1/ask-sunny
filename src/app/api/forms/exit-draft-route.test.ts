import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseFormDocument } from "@/lib/forms/document";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";

/**
 * ============================================================================
 * DRAFTING THE RESIGNATION/EXIT FORM, EXERCISED THROUGH THE ROUTE
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
 */

const state = vi.hoisted(() => ({
  modelInput: null as Record<string, unknown> | null,
  modelCalls: 0,
  toolInput: {} as Record<string, unknown>,
  persisted: [] as { values: Record<string, string>; checked: Record<string, string[]> }[],
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
      actor: { id: "demo:salon_director:QA", role: "salon_director", verified: false, scope: null },
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
        },
        version: { document: parseFormDocument(seed.document), variants: seed.variants },
      },
    };
  },
}));

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    async fetchRoleGrounding() {
      throw new Error("the exit form is not governed by the performance-management framework");
    }
    async fetchOfficialPolicyManual() {
      throw new Error("the exit form cites no manual");
    }
  },
}));

vi.mock("@/lib/knowledge", () => ({
  getKnowledgeProvider: () => ({
    search: async () => {
      throw new Error("the exit form retrieves no policy");
    },
  }),
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
  const response = await POST(request, { params: Promise.resolve({ id: "form-1" }) });
  return (await response.json()) as Record<string, unknown>;
}

const prompt = () =>
  ((state.modelInput?.messages as { content: string }[] | undefined)?.[0]?.content ?? "");
const system = () => String(state.modelInput?.system ?? "");
const stored = () => state.persisted[0]!;

beforeEach(() => {
  vi.resetModules();
  // Monday 28 September 2026, mid-morning in Central time.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-28T15:00:00Z"));
  state.modelInput = null;
  state.modelCalls = 0;
  state.toolInput = {};
  state.persisted = [];
});

afterEach(() => {
  vi.useRealTimers();
});

const NOTES =
  "Create an STC exit for Sarah Jones. She gave her two weeks notice on 9/1, worked her full two weeks, and her last day was 9/15.";

describe("what the model is shown", () => {
  it("only Details — never the derived facts, the yes/no questions or a signature", async () => {
    state.toolInput = { values: { details: "Sarah gave two weeks notice on 9/1 and worked through her last day, 9/15." } };
    await post(NOTES);

    expect(state.modelCalls).toBe(1);
    expect(prompt()).toMatch(/- details: Details/);
    for (const key of [
      "last_day_worked",
      "notice_given_date",
      "notice_fulfilled_date",
      "resignation_notice",
      "resignation_type",
      "store_items_returned",
      "payroll_deduction_applicable",
      "forfeit_bonus",
      "dropped_to_minimum_wage",
      "written_notice_attached",
      "eligible_for_rehire",
      "permanent_address",
    ]) {
      expect(prompt(), key).not.toContain(key);
    }
    expect(prompt()).not.toMatch(/CHECKBOXES TO TICK/);
    expect(system()).toMatch(/THIS FORM IS A RESIGNATION\/EXIT FORM/);
    expect(system()).toMatch(/Never say that the form, a notice or anything else was signed/);
  });
});

describe("what is stored", () => {
  it("the dates and ticks from the manager's words, and Details", async () => {
    state.toolInput = { values: { details: "Sarah gave two weeks notice on 9/1 and worked through her last day, 9/15." } };
    const payload = await post(NOTES);

    expect(stored().values).toEqual({
      details: "Sarah gave two weeks notice on 9/1 and worked through her last day, 9/15.",
      notice_given_date: "2026-09-01",
      last_day_worked: "2026-09-15",
    });
    expect(stored().checked).toEqual({ resignation_notice: ["submitted_fulfilled_notice"] });
    expect([...(payload.exitDerived as string[])].sort()).toEqual([
      "last_day_worked",
      "notice_given_date",
      "resignation_notice",
    ]);
    expect(payload.notice).toBeNull();
  });

  it("replaces whatever the model wrote for a derived key, and drops what it may not write", async () => {
    state.toolInput = {
      values: {
        details: "Sarah resigned.",
        last_day_worked: "2026-09-30",
        notice_fulfilled_date: "2026-09-15",
        permanent_address: "12 Invented Rd",
      },
      checked: {
        resignation_type: ["immediate_involuntary_separation", "no_call_no_show"],
        eligible_for_rehire: ["no"],
        forfeit_bonus: ["yes"],
        written_notice_attached: ["no"],
      },
    };
    await post(NOTES);

    const { values, checked } = stored();
    expect(values.last_day_worked).toBe("2026-09-15");
    expect(values).not.toHaveProperty("notice_fulfilled_date");
    expect(values).not.toHaveProperty("permanent_address");
    expect(checked).toEqual({ resignation_notice: ["submitted_fulfilled_notice"] });
  });

  it("ticks the involuntary box from the manager's completed statement, not the model", async () => {
    // The model tries to decide it; that output is discarded. The notes say it happened.
    state.toolInput = {
      values: { details: "Dan was terminated on 9/20 after an investigation." },
      checked: { resignation_type: ["immediate_involuntary_separation"] },
    };
    const payload = await post(
      "Termination paperwork for Dan Smith. We terminated him on 9/20 after the investigation; his last day was 9/20.",
    );
    expect(stored().checked).toEqual({ resignation_type: ["immediate_involuntary_separation"] });
    expect(stored().values.last_day_worked).toBe("2026-09-20");
    expect(stored().values.details).toBe("Dan was terminated on 9/20 after an investigation.");
    // Not the leadership-authority refusal: nothing the model chose was used or refused.
    expect(payload.notice).toBeNull();
    expect(payload.sensitiveRefused).toEqual({});
  });

  it.each([
    "Termination paperwork for Dan Smith. Should we terminate him? His last day was 9/20.",
    "Termination form for Dan Smith. We may fire him. Last day 9/20.",
  ])("never ticks it from intent, even when the model does: %s", async (notes) => {
    state.toolInput = {
      values: { details: "Dan's last day was 9/20." },
      checked: { resignation_type: ["immediate_involuntary_separation"] },
    };
    await post(notes);
    expect(stored().checked).toEqual({});
  });

  it("removes a Details sentence that answers a question nobody answered", async () => {
    state.toolInput = {
      values: {
        details:
          "Sarah gave notice on 9/1 and her last day was 9/15. She returned all store items. She is eligible for rehire. Her bonus is forfeited. The form was signed by both parties. She has been removed from MyGlow.",
      },
    };
    const payload = await post(NOTES);

    expect(stored().values.details).toBe("Sarah gave notice on 9/1 and her last day was 9/15.");
    expect(payload.exitDetailsRemoved).toHaveLength(5);
    expect(String(payload.notice)).toMatch(/left out of Details/);
  });

  it("keeps a fact the manager did state, while its box stays blank", async () => {
    state.toolInput = {
      values: { details: "Sarah quit on the spot on 9/20. She returned her keys and uniform." },
    };
    await post("Exit form for Sarah Jones. She quit on the spot on 9/20 and returned her keys and uniform.");
    expect(stored().values.details).toBe(
      "Sarah quit on the spot on 9/20. She returned her keys and uniform.",
    );
    expect(stored().checked).toEqual({ resignation_type: ["immediate_voluntary_resignation"] });
    expect(stored().checked).not.toHaveProperty("store_items_returned");
  });

  it("removes a Details sentence carrying a date the manager never gave", async () => {
    state.toolInput = {
      values: { details: "Sarah walked out mid-shift yesterday. Her final paycheck is due 10/2." },
    };
    await post("Exit form for Sarah Jones, she walked out mid-shift yesterday.");
    expect(stored().values.details).toBe("Sarah walked out mid-shift yesterday.");
    expect(stored().checked).toEqual({ resignation_type: ["immediate_voluntary_resignation"] });
  });

  it("resolves yesterday against the business day", async () => {
    state.toolInput = { values: { details: "Sarah's last shift was yesterday." } };
    await post("Exit form for Sarah Jones. Her last shift was yesterday and she did not finish her two weeks.");
    expect(stored().values.last_day_worked).toBe("2026-09-27");
    expect(stored().checked).toEqual({ resignation_type: ["notice_not_fulfilled"] });
  });

  it("leaves Details empty rather than keeping nothing but a decision", async () => {
    state.toolInput = { values: { details: "She is not eligible for rehire." } };
    await post("Exit form for Sarah Jones. Last day 9/15.");
    expect(stored().values).toEqual({ last_day_worked: "2026-09-15" });
  });
});
