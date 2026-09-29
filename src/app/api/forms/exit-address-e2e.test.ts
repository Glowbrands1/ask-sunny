import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * THE TESTER'S EXIT FORM: THE ADDRESS SHE GAVE, AND HER NAME, NOT "SHE"
 * ============================================================================
 *
 * "provided address and not filled in on form. Sunny wrote: 'She did not call
 * in…' and we should avoid using pronouns so Sunny should say Christiana did
 * not call in." (District Manager, 29 September 2026.)
 *
 * Conversation -> proposal -> `createInlineForm` (the browser's orchestrator)
 * -> POST /api/forms/instances -> POST .../draft -> GET .../[id]. Everything is
 * real except the identity provider, the model, the knowledge base and the
 * database (the in-memory Supabase fake the forms suite uses). The model is
 * scripted to write the pronoun the tester saw, and to try to write an address
 * of its own.
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
  role: "district_manager",
  scope: null as unknown,
  modelCalls: 0,
  system: "",
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
      create: async (request: { system?: string }) => {
        state.modelCalls += 1;
        state.system = String(request.system ?? "");
        return {
          content: [
            {
              type: "tool_use",
              name: "write_form_fields",
              input: {
                values: {
                  details: "She did not call in for her last two scheduled shifts. She texted on Sunday that she was quitting.",
                  // Manager-owned: a model value must never reach the record.
                  permanent_address: "1 Invented St",
                },
                checked: {},
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
const instancesRoute = await import("./instances/route");
const instanceRoute = await import("./instances/[id]/route");
const draftRoute = await import("./instances/[id]/draft/route");

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
  expect(proposal!.templateKey).toBe("stc-exit");
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
  state.role = "district_manager";
  // A global-scope district manager, as the testers' accounts are.
  state.scope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
  state.modelCalls = 0;
  state.system = "";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-29T15:00:00Z"));
  await ensureTemplateLibrary("system");
});

describe("an Exit Form with the address given in chat", () => {
  it("puts the manager's address on the form, and names the employee rather than \"she\"", async () => {
    const { proposal, content, result } = await conversation([
      "Exit form for Christiana Lee",
      "she was a no call no show for her last two shifts, last day worked was 9/26. her address is 1234 Elm St, Lawrence, KS 66044",
    ]);

    expect(proposal.employeeName).toBe("Christiana Lee");
    expect(proposal.permanentAddress).toBe("1234 Elm St, Lawrence, KS 66044");
    // The card reads it back instead of calling it "left blank for you".
    expect(content).toContain("**Permanent Address:** 1234 Elm St, Lawrence, KS 66044");
    expect(content).not.toMatch(/Left blank for you to review:\*\*[^\n]*Permanent Address/);
    // It travelled with the create request, not through the model.
    expect(requests.find((entry) => entry.url === "/api/forms/instances")?.body.permanentAddress).toBe(
      "1234 Elm St, Lawrence, KS 66044",
    );
    expect(result.draftWarning).toBeNull();
    expect(state.modelCalls).toBe(1);
    expect(state.system).toMatch(/Refer to the employee by name \(Christiana Lee\)/);

    const { values } = await review(result.reference.instanceId);
    const address = values.find((row) => row.fieldKey === "permanent_address");
    // The manager's words, not the model's "1 Invented St".
    expect(address?.value).toBe("1234 Elm St, Lawrence, KS 66044");
    const details = values.find((row) => row.fieldKey === "details");
    expect(details?.value).toMatch(/^Christiana did not call in for her last two scheduled shifts\. Christiana texted/);
    expect(details?.value).not.toMatch(/\bShe\b/);
  });

  it("leaves the address blank when none was given, whatever the model wrote", async () => {
    const { proposal, result } = await conversation([
      "Exit form for Christiana Lee",
      "she was a no call no show for her last two shifts, last day worked was 9/26",
    ]);

    expect(proposal.permanentAddress).toBeNull();
    expect(requests.find((entry) => entry.url === "/api/forms/instances")?.body).not.toHaveProperty(
      "permanentAddress",
    );
    const { values } = await review(result.reference.instanceId);
    expect(values.find((row) => row.fieldKey === "permanent_address")?.value ?? null).toBeNull();
  });
});
