import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * EDITING AN OPEN CORRECTIVE ACTION FORM FROM THE CONVERSATION
 * ============================================================================
 *
 * Production feedback, 20 Oct 2026. With a Corrective Action Form for Ellie
 * Sendgraff open, "can you add late opening policy to the direct policy
 * section of this from" was answered "No form has been created yet", and the
 * manager was told to create the form again. A manager has to be able to add
 * or swap a policy, change a detail, and answer a question — on the form that
 * is open — without starting another one.
 *
 * End to end through the real proposal, creation and draft routes against the
 * fake database and the real JBA manual fixture; then the chat handlers the
 * route tries, in the order it tries them.
 */

const store: FakeStore = {
  form_instances: [],
  form_instance_values: [],
  form_instance_events: [],
  form_template_versions: [],
  form_templates: [],
  form_template_current: [],
  form_template_assets: [],
};

const state = vi.hoisted(() => ({
  role: "salon_director",
  scope: null as unknown,
  toolValues: {} as Record<string, string>,
  toolChecked: {} as Record<string, string[]>,
  systems: [] as string[],
  manualOk: true,
}));

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));

vi.mock("@/lib/api/respond", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/respond")>();
  return {
    ...actual,
    assertLiveMode: () => {},
    assertNoConfigurationProblems: () => {},
    assertWithinRateLimit: () => {},
  };
});

vi.mock("@/lib/auth/server", async () => {
  const { AuthError } = await import("@/lib/auth/types");
  const { DEFAULT_PERMISSION_MATRIX, hasPermission } = await import("@/lib/permissions");
  return {
    authorizeRequest: async (_request: Request, permission: string) => {
      if (!hasPermission(DEFAULT_PERMISSION_MATRIX, state.role as never, permission as never)) {
        throw new AuthError("forbidden", "Your role does not have permission to do that.");
      }
      return {
        identity: {
          subject: "manager-1",
          email: "manager@example.com",
          displayName: "Manager",
          role: state.role,
          scope: state.scope,
          verified: true,
        },
        permission,
        provider: "supabase",
      };
    },
  };
});

vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (request: { system: string }) => {
        state.systems.push(request.system);
        return {
          content: [{ type: "tool_use", name: "write_form_fields", input: { values: state.toolValues, checked: state.toolChecked } }],
        };
      },
    },
  }),
}));

vi.mock("@/lib/knowledge/providers/supabase", async () => {
  const { JBA_MANUAL_CHUNKS, JBA_MANUAL_DOCUMENT } = await import("@/lib/ai/__fixtures__/jba-policy-manual");
  return {
    SupabaseKnowledgeProvider: class {
      async search() {
        return [];
      }
      async fetchRoleGrounding() {
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
        };
      }
      async fetchOfficialPolicyManual() {
        if (!state.manualOk) return { ok: false, reason: "down" };
        return {
          ok: true,
          documentId: JBA_MANUAL_DOCUMENT.id,
          documentTitle: JBA_MANUAL_DOCUMENT.title,
          matchedBy: "tag",
          chunks: JBA_MANUAL_CHUNKS,
        };
      }
    },
  };
});

vi.mock("@/lib/knowledge", () => ({
  getKnowledgeProvider: () => {
    throw new Error("getKnowledgeProvider() is the browser knowledge client and must not be used on the server");
  },
}));

process.env.NEXT_PUBLIC_DEMO_MODE = "false";

const { ensureTemplateLibrary, listTemplateSummaries } = await import("@/lib/forms/repository");
const { proposeFormForTurn } = await import("@/lib/ai/form-proposal");
const { createInlineForm } = await import("@/features/chat/create-inline-form");
const { correctActiveForm } = await import("@/lib/forms/chat-correction");
const { reviseActiveForm } = await import("@/lib/forms/chat-revision");
const instancesRoute = await import("@/app/api/forms/instances/route");
const instanceRoute = await import("@/app/api/forms/instances/[id]/route");
const draftRoute = await import("@/app/api/forms/instances/[id]/draft/route");

function joinOverview() {
  for (const row of store.form_instances ?? []) {
    const template = store.form_templates!.find((entry) => entry.id === row.template_id);
    const version = store.form_template_versions.find((entry) => entry.id === row.template_version_id);
    Object.assign(row, {
      form_date: row.form_date ?? "2026-10-20",
      template_key: template?.key,
      template_name: template?.name,
      layout_family: template?.layout_family,
      template_version: version?.version,
    });
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const request = new Request(`https://app.test${url}`, init);
  const draft = /^\/api\/forms\/instances\/([^/]+)\/draft$/.exec(url);
  const response = draft
    ? await draftRoute.POST(request, { params: Promise.resolve({ id: draft[1]! }) })
    : url === "/api/forms/instances"
      ? await instancesRoute.POST(request)
      : null;
  if (!response) throw new Error(`no route for ${url}`);
  joinOverview();
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

async function review(id: string) {
  joinOverview();
  const response = await instanceRoute.GET(new Request(`https://app.test/api/forms/instances/${id}`), {
    params: Promise.resolve({ id }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    values: { fieldKey: string; value: string | null; checked: string[]; filledBy: string; provenance?: Record<string, unknown> }[];
  };
}


let sequence = 0;
const said = (content: string): ChatMessage => ({
  id: `m${(sequence += 1)}`,
  role: "user",
  content,
  createdAt: "2026-10-20T15:00:00Z",
});

const chat = () => new Request("https://app.test/api/chat", { method: "POST" });


beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  state.role = "salon_director";
  state.scope = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: [] };
  state.toolValues = { observation: "Observed: Ellie did not open the salon on time.\nExpectation: Open on time.\nGoing Forward: Ellie will open on time." };
  state.toolChecked = { warning_type: ["verbal"], offense_type: ["tardiness"] };
  state.systems = [];
  state.manualOk = true;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T15:00:00Z"));
  await ensureTemplateLibrary("system");
});

/** This app's synthetic employee, as the harness above creates them. */
const NAME = "Ellie Sendgraff";

/*
 * ============================================================================
 * QA, 22 Oct 2026 — PAYROLL CORRECTED AFTER THE FORM EXISTS
 * ============================================================================
 *
 * The same harness as the chat-edit tests above: the real proposal, create,
 * draft, finalize and read routes, then the chat route's handlers in its
 * order. A manager who changes, waives, cancels or hedges a $25 deduction on
 * a created (or finalized) Corrective Action Form must never be left with a
 * Yes on the form or a deduction in the Action Plan. Synthetic people only.
 */
const OPEN = `create corrective action for ${NAME}, she was late to work today. It is a verbal warning.`;

async function act(id: string, body: Record<string, unknown>) {
  const response = await instanceRoute.POST(
    new Request(`https://app.test/api/forms/instances/${id}`, { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
  joinOverview();
  const payload = (await response.json()) as { instance?: { id: string; status: string }; error?: string };
  return { status: response.status, payload };
}

/** Rows read through the overview VIEW carry their template's columns at once, as Postgres does. */
class JoiningRows extends Array<Record<string, unknown>> {
  override push(...rows: Record<string, unknown>[]) { const n = super.push(...rows); joinOverview(); return n; }
}
async function createWith(text: string) {
  if (!(store.form_instances instanceof JoiningRows)) store.form_instances = JoiningRows.from(store.form_instances ?? []) as never;
  const message = said(text);
  const response = await proposeFormForTurn({
    history: [], question: message.content, questionMessageId: message.id,
    actor: { role: state.role as never, scope: state.scope as AccessScope },
    summaries: await listTemplateSummaries(), today: "2026-10-20",
  } as never);
  const proposal = response!.formProposal!;
  await createInlineForm({ proposal, messages: [message], call, onCreated: () => {} } as never);
  joinOverview();
  const id = (store.form_instances ?? []).at(-1)!.id as string;
  const history: ChatMessage[] = [message, { id: `a${sequence}`, role: "assistant", content: response!.content, createdAt: "2026-10-20T15:00:01Z", formProposal: proposal } as ChatMessage];
  return { id, history, cardPayroll: proposal.payrollDeduct ?? null };
}

async function snapshot(id: string) {
  const values = (await review(id)).values;
  const payroll = values.find((v) => v.fieldKey === "payroll_deduct")?.checked ?? [];
  const plan = values.find((v) => v.fieldKey === "action_plan")?.value ?? null;
  const status = (store.form_instances ?? []).find((r) => r.id === id)?.status ?? null;
  return { id, status, payroll, planStatesDeduction: plan ? /will be deducted from|payroll deduction applies/i.test(plan) : null, planDeductionSentence: plan ? (plan.match(/[^.]*(?:will be deducted from|payroll deduction applies)[^.]*\./i)?.[0] ?? null) : null };
}

/** One manager turn after the form exists, through the chat route's handlers in its order (correction, redraft, proposal). */
async function turn(id: string, history: ChatMessage[], text: string) {
  const message = said(text);
  let handledBy = "none"; let content = ""; let formUpdate: unknown = null; let card: unknown = null;
  const corrected = await correctActiveForm({ request: chat(), instanceId: id, question: text, today: "2026-10-20", history } as never);
  if (corrected) { handledBy = "correctActiveForm"; content = corrected.content; formUpdate = (corrected as { formUpdate?: unknown }).formUpdate ?? null; }
  else {
    const revised = await reviseActiveForm({ request: chat(), instanceId: id, question: text, history } as never).catch((e: unknown) => ({ content: `threw ${String(e)}` }));
    if (revised) { handledBy = "reviseActiveForm"; content = (revised as { content: string }).content; formUpdate = (revised as { formUpdate?: unknown }).formUpdate ?? null; }
    else {
      const proposed = await proposeFormForTurn({ history, question: text, questionMessageId: message.id, actor: { role: state.role as never, scope: state.scope as AccessScope }, summaries: await listTemplateSummaries(), today: "2026-10-20", continueTemplateKey: "dpoa" } as never);
      handledBy = proposed ? "proposeFormForTurn" : "general answer (form path left)";
      content = proposed?.content ?? "";
      card = proposed?.formProposal ? { payrollDeduct: proposed.formProposal.payrollDeduct ?? null } : null;
    }
  }
  history.push(message, { id: `a${(sequence += 1)}`, role: "assistant", content, createdAt: "2026-10-20T15:00:02Z" } as ChatMessage);
  return { said: text, handledBy, content, formUpdate, card };
}


const payrollOf = async (id: string) => (await snapshot(id)).payroll;
const planDeducts = async (id: string) => (await snapshot(id)).planStatesDeduction;
const finalizedAndDraft = () => {
  const rows = store.form_instances ?? [];
  return { finalized: rows.find((r) => r.status === "finalized")!.id as string, draft: rows.find((r) => r.status === "draft")!.id as string };
};

describe("QA 22 Oct 2026: a payroll answer corrected after the form exists is never left as a silent Yes", () => {
  it.each(["we cancelled the $25 payroll deduction", "cancel the $25 payroll deduction"])(
    "Yes, then '%s' → No on the form, and the Action Plan no longer states a deduction",
    async (text) => {
      const { id, history } = await createWith(`${OPEN} Payroll deduct $25.`);
      expect(await payrollOf(id)).toEqual(["yes"]);
      expect(await planDeducts(id)).toBe(true);
      const step = await turn(id, history, text);
      expect(step.handledBy).toBe("correctActiveForm");
      expect(await payrollOf(id)).toEqual(["no"]);
      expect(await planDeducts(id)).toBe(false);
      expect(store.form_instances).toHaveLength(1);
    },
  );

  it.each(["hold off on the $25 payroll deduction", "not sure about the payroll deduction anymore"])(
    "Yes, then '%s' → the answer is cleared, the plan states no deduction, and the manager is asked",
    async (text) => {
      const { id, history } = await createWith(`${OPEN} Payroll deduct $25.`);
      const step = await turn(id, history, text);
      expect(step.handledBy).toBe("correctActiveForm");
      expect(step.content).toMatch(/\*\*Is payroll deduct applicable\?\*\* Yes or No\?/);
      expect(await payrollOf(id)).toEqual([]);
      expect(await planDeducts(id)).toBe(false);
      expect(store.form_instances).toHaveLength(1);
    },
  );

  it("asked after an unclear statement, a bare 'no' answers it", async () => {
    const { id, history } = await createWith(`${OPEN} Payroll deduct $25.`);
    await turn(id, history, "hold off on the $25 payroll deduction");
    await turn(id, history, "no");
    expect(await payrollOf(id)).toEqual(["no"]);
    expect(await planDeducts(id)).toBe(false);
  });

  it("control: No, then 'change payroll deduct to yes' → Yes, and the plan states it", async () => {
    const { id, history } = await createWith(`${OPEN} No payroll deduct.`);
    await turn(id, history, "change payroll deduct to yes");
    expect(await payrollOf(id)).toEqual(["yes"]);
    expect(await planDeducts(id)).toBe(true);
  });

  describe("on a finalized form, the change is made on a new draft and the signed record is untouched", () => {
    it("'change payroll deduct to no' → the draft says No and its plan states no deduction", async () => {
      const { id, history } = await createWith(`${OPEN} Payroll deduct $25.`);
      expect((await act(id, { action: "finalize", acknowledgeUnverifiedPolicy: true })).status).toBe(200);
      await turn(id, history, "change payroll deduct to no");
      const { finalized, draft } = finalizedAndDraft();
      expect(finalized).toBe(id);
      expect(await payrollOf(finalized)).toEqual(["yes"]);
      expect(await payrollOf(draft)).toEqual(["no"]);
      expect(await planDeducts(draft)).toBe(false);
    });

    it("an unclear statement → the draft's answer is cleared and asked, never a Yes", async () => {
      const { id, history } = await createWith(`${OPEN} Payroll deduct $25.`);
      expect((await act(id, { action: "finalize", acknowledgeUnverifiedPolicy: true })).status).toBe(200);
      const step = await turn(id, history, "hold off on the $25 payroll deduction");
      const { finalized, draft } = finalizedAndDraft();
      expect(await payrollOf(finalized)).toEqual(["yes"]);
      expect(await payrollOf(draft)).toEqual([]);
      expect(await planDeducts(draft)).toBe(false);
      expect(step.content).toMatch(/Yes or No\?/);
    });
  });
});
