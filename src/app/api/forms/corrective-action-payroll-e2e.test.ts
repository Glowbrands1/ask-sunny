import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { extractText, getDocumentProxy } from "unpdf";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { answersBeside } from "@/test/pdf-ticks";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * "CA" TO PDF, WITH "IS PAYROLL DEDUCT APPLICABLE?" ANSWERED ALONG THE WAY
 * ============================================================================
 *
 * Conversation -> proposal -> `createInlineForm` (the browser's orchestrator)
 * -> POST /api/forms/instances -> POST .../draft -> GET .../[id] (review) ->
 * GET .../pdf (download) -> a correction in chat -> GET .../pdf again.
 *
 * Everything is real except the identity provider, the model, the knowledge
 * base and the database (the in-memory Supabase fake the forms suite uses).
 * The library is installed by `ensureTemplateLibrary`, so the form is filled
 * against the Corrective Action Form revision that is actually seeded.
 *
 * Set CA_FORM_PDF_DIR to keep the PDFs for a visual check.
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
  modelCalls: 0,
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
      create: async () => {
        state.modelCalls += 1;
        return {
          content: [
            {
              type: "tool_use",
              name: "write_form_fields",
              input: {
                values: {
                  observation:
                    "Observed: Dana Moss arrived 30 minutes late for her scheduled shift today.\nExpectation: Arrive on time for every scheduled shift.\nGoing Forward: Dana will arrive on time.",
                },
                checked: {
                  warning_type: ["verbal"],
                  // What a careless model might add. It must never reach the record.
                  payroll_deduct: ["yes"],
                },
              },
            },
          ],
        };
      },
    },
  }),
}));

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    // A healthy Performance Management Framework, so the governed draft runs.
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
      return { ok: false, reason: "not needed" };
    }
  },
}));

vi.mock("@/lib/knowledge", () => ({
  getKnowledgeProvider: () => ({ search: async () => [] }),
}));

process.env.NEXT_PUBLIC_DEMO_MODE = "false";

const { ensureTemplateLibrary, listTemplateSummaries } = await import("@/lib/forms/repository");
const { proposeFormForTurn } = await import("@/lib/ai/form-proposal");
const { createInlineForm } = await import("@/features/chat/create-inline-form");
const { correctActiveForm } = await import("@/lib/forms/chat-correction");
const instancesRoute = await import("./instances/route");
const instanceRoute = await import("./instances/[id]/route");
const draftRoute = await import("./instances/[id]/draft/route");
const pdfRoute = await import("./instances/[id]/pdf/route");

/** The view's join, which the fake does not model — see `exit-form-e2e.test.ts`. */
function joinOverview() {
  for (const row of store.form_instances ?? []) {
    const template = store.form_templates!.find((entry) => entry.id === row.template_id);
    const version = store.form_template_versions.find((entry) => entry.id === row.template_version_id);
    Object.assign(row, {
      form_date: row.form_date ?? "2026-09-29",
      template_key: template?.key,
      template_name: template?.name,
      layout_family: template?.layout_family,
      template_version: version?.version,
    });
  }
}

const requests: { url: string; body: Record<string, unknown> }[] = [];

/** The browser's `formsFetch`, dispatched straight into the route handlers. */
async function call<T>(url: string, init?: RequestInit): Promise<T> {
  requests.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
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
    instance: Record<string, unknown>;
    values: { fieldKey: string; value: string | null; checked: string[]; filledBy: string }[];
  };
}

async function download(id: string, name: string) {
  joinOverview();
  const response = await pdfRoute.GET(new Request(`https://app.test/api/forms/instances/${id}/pdf`), {
    params: Promise.resolve({ id }),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/pdf");
  const bytes = new Uint8Array(await response.arrayBuffer());
  const dir = process.env.CA_FORM_PDF_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.pdf`), bytes);
  }
  // A copy: pdf.js takes ownership of (and empties) the buffer it is given.
  const { text } = await extractText(await getDocumentProxy(bytes.slice()), { mergePages: true });
  return { bytes, text };
}

const QUESTION = "Is payroll deduct applicable?";
const ticked = (bytes: Uint8Array) =>
  answersBeside(bytes, QUESTION, ["Yes", "No"])
    .filter((entry) => entry.ticked)
    .map((entry) => entry.label);

let sequence = 0;
const said = (content: string): ChatMessage => ({
  id: `m${(sequence += 1)}`,
  role: "user",
  content,
  createdAt: "2026-09-29T15:00:00Z",
});

/**
 * Plays the manager's turns through the real proposal flow, feeding Ask
 * Sunny's real answers forward as history, then creates the form from the
 * last proposal exactly as the chat's Create draft button does.
 */
async function conversation(turns: string[]) {
  const messages: ChatMessage[] = [];
  let proposal = null as Awaited<ReturnType<typeof proposeFormForTurn>> extends infer R
    ? R extends { formProposal?: infer P } ? P | null : null
    : null;
  let content = "";
  for (const turn of turns) {
    const message = said(turn);
    const response = await proposeFormForTurn({
      history: messages,
      question: message.content,
      questionMessageId: message.id,
      actor: { role: state.role as never, scope: state.scope as AccessScope },
      summaries: await listTemplateSummaries(),
      today: "2026-09-29",
      ...(proposal ? { continueTemplateKey: proposal.templateKey } : {}),
    });
    expect(response?.formProposal, turn).toBeDefined();
    proposal = response!.formProposal!;
    content = response!.content;
    messages.push(message, {
      id: `a${sequence}`,
      role: "assistant",
      content,
      createdAt: "2026-09-29T15:00:01Z",
      formProposal: proposal,
    } as ChatMessage);
  }
  expect(proposal!.templateKey).toBe("dpoa");
  expect(proposal!.supportsInlineDraft).toBe(true);
  const result = await createInlineForm({
    proposal: proposal!,
    messages: messages.filter((message) => message.role === "user"),
    call,
    onCreated: () => {},
  });
  return { proposal: proposal!, content, result };
}

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  requests.length = 0;
  state.role = "salon_director";
  state.scope = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: [] };
  state.modelCalls = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-29T15:00:00Z"));
  await ensureTemplateLibrary("system");
});

describe("\"I need a CA for Dana Moss\", answered \"no\"", () => {
  it("opens the form directly, records No as the manager's answer, and prints it", async () => {
    const { proposal, result } = await conversation([
      "I need a CA for Dana Moss. She was 30 minutes late today, verbal warning, first time.",
      "no",
    ]);

    expect(proposal.employeeName).toBe("Dana Moss");
    expect(proposal.payrollDeduct).toBe("no");
    // The draft ran — and it is the draft that tried to tick Yes.
    expect(result.draftWarning).toBeNull();
    expect(state.modelCalls).toBe(1);
    // The answer travelled with the create request, not through the model.
    expect(requests.find((entry) => entry.url === "/api/forms/instances")?.body.payrollDeduct).toBe("no");

    const { instance, values } = await review(result.reference.instanceId);
    expect(instance).toMatchObject({ templateKey: "dpoa", employeeName: "Dana Moss", status: "draft" });
    const payroll = values.find((row) => row.fieldKey === "payroll_deduct");
    // The model sent ["yes"]; the manager said no. The manager's answer is the record.
    expect(payroll?.checked).toEqual(["no"]);

    const { bytes, text } = await download(result.reference.instanceId, "ca-payroll-no");
    expect(text).toContain("Corrective Action Form");
    expect(text).toContain("Dana Moss");
    expect(text).toContain(QUESTION);
    expect(ticked(bytes)).toEqual(["No"]);
  });
});

describe("a CA whose payroll question was never answered", () => {
  it("stays unanswered on the record and prints two empty boxes, whatever the model sent", async () => {
    const { proposal, result } = await conversation([
      "Create a CA for Dana Moss. She was 30 minutes late today, verbal warning, first time.",
    ]);

    expect(proposal.payrollDeduct).toBeNull();
    expect(requests.find((entry) => entry.url === "/api/forms/instances")?.body).not.toHaveProperty("payrollDeduct");

    const { values } = await review(result.reference.instanceId);
    expect(values.find((row) => row.fieldKey === "payroll_deduct")).toBeUndefined();

    const { bytes, text } = await download(result.reference.instanceId, "ca-payroll-unanswered");
    expect(text).toContain(QUESTION);
    expect(ticked(bytes)).toEqual([]);
  });
});

describe("changing the answer after the form exists", () => {
  it("updates the form from chat, and the regenerated PDF shows the new answer", async () => {
    const { result } = await conversation([
      "CA for Dana Moss, she was 30 minutes late today, verbal warning, first time. Yes payroll deduct applies.",
    ]);
    const id = result.reference.instanceId;

    const first = await download(id, "ca-payroll-before");
    expect(ticked(first.bytes)).toEqual(["Yes"]);

    const response = await correctActiveForm({
      request: new Request("https://app.test/api/chat"),
      instanceId: id,
      question: "change payroll deduct to no",
      today: "2026-09-29",
    });
    expect(response?.content).toBe(
      "Updated the **Corrective Action Form** for **Dana Moss**: Is payroll deduct applicable? → No.",
    );
    expect(response?.formUpdate).toEqual({ instanceId: id, updated: ["payroll_deduct"] });

    const { values } = await review(id);
    expect(values.find((row) => row.fieldKey === "payroll_deduct")?.checked).toEqual(["no"]);

    const second = await download(id, "ca-payroll-after");
    expect(ticked(second.bytes)).toEqual(["No"]);
  });
});

/*
 * PRODUCTION: the prior warning's date reached the narrative, and the Date of
 * previous corrective action line stayed blank. The form's own date is still
 * today — September 21 is the PRIOR step's date, not this form's.
 */
describe("\"create ca for Paulyne Test she was late today, got verbal warning on september 21\"", () => {
  it("fills the previous corrective action date from the manager's words, and keeps today as the form's date", async () => {
    const question = "create ca for Paulyne Test she was late today, got verbal warning on september 21";
    const { proposal, content, result } = await conversation([question, "no"]);

    expect(proposal.employeeName).toBe("Paulyne Test");
    // "today" is the business day, not September 21 (the prior warning).
    expect(proposal.formDate).toBe("2026-09-29");
    expect(proposal.payrollDeduct).toBe("no");
    expect(content).not.toMatch(/who is this/i);
    expect(result.draftWarning).toBeNull();
    // The whole account, prior warning included, is what the draft is written from.
    const draft = requests.find((entry) => entry.url.endsWith("/draft"));
    expect(String(draft?.body.notes)).toContain("got verbal warning on september 21");

    const { values } = await review(result.reference.instanceId);
    const byKey = Object.fromEntries(values.map((row) => [row.fieldKey, row]));
    expect(byKey.employee_name?.value).toBe("Paulyne Test");
    expect(byKey.form_date?.value).toBe("2026-09-29");
    expect(byKey.previous_action_date?.value).toBe("2026-09-21");
    expect(byKey.previous_action_date?.filledBy).toBe("ai");
    expect(byKey.payroll_deduct?.checked).toEqual(["no"]);

    const { bytes, text } = await download(result.reference.instanceId, "ca-prior-warning-date");
    expect(text).toContain("Date of previous corrective action");
    expect(text).toMatch(/09\/21\/2026|September 21, 2026|2026-09-21/);
    expect(ticked(bytes)).toEqual(["No"]);
  });

  it("leaves the line blank when no prior date was given", async () => {
    const { result } = await conversation([
      "create ca for Paulyne Test she was late today, verbal warning, first time",
      "no",
    ]);
    const { values } = await review(result.reference.instanceId);
    expect(values.find((row) => row.fieldKey === "previous_action_date")?.value ?? null).toBeNull();
  });
});
