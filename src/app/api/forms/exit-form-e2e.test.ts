import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { extractText, getDocumentProxy } from "unpdf";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * THE RESIGNATION/EXIT FORM, END TO END
 * ============================================================================
 *
 * Conversation -> proposal -> `createInlineForm` (the browser's own orchestrator)
 * -> POST /api/forms/instances -> POST /api/forms/instances/[id]/draft ->
 * GET /api/forms/instances/[id] (the review read) -> GET .../pdf (the download).
 *
 * Everything is real except the identity provider, the model and the database,
 * which is the in-memory Supabase fake the rest of the forms suite uses. The
 * library is installed by `ensureTemplateLibrary`, so the draft is filled
 * against the version that is actually seeded.
 *
 * Set EXIT_FORM_PDF_DIR to keep the two PDFs for a visual check.
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
  details: "" as string,
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
                  details: state.details,
                  // What a careless model might add. None of it may reach the record.
                  last_day_worked: "2026-12-31",
                  permanent_address: "1 Invented Road",
                },
                checked: {
                  written_notice_attached: ["no"],
                  eligible_for_rehire: ["no"],
                  resignation_type: ["immediate_involuntary_separation"],
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
    async fetchRoleGrounding() {
      return null;
    }
    async fetchOfficialPolicyManual() {
      return { ok: false, reason: "not needed" };
    }
  },
}));

process.env.NEXT_PUBLIC_DEMO_MODE = "false";

const { ensureTemplateLibrary, listTemplateSummaries } = await import("@/lib/forms/repository");
const { proposeFormForTurn } = await import("@/lib/ai/form-proposal");
const { createInlineForm } = await import("@/features/chat/create-inline-form");
const instancesRoute = await import("./instances/route");
const instanceRoute = await import("./instances/[id]/route");
const draftRoute = await import("./instances/[id]/draft/route");
const pdfRoute = await import("./instances/[id]/pdf/route");

/**
 * THE VIEW'S JOIN, which the fake does not model. `form_instance_overview`
 * reads `form_instances` joined to `form_templates` and `form_template_versions`
 * (see 20260904004000_forms_follow_up_tracking.sql: `t.key as template_key`,
 * `t.name as template_name`, `t.layout_family`, `v.version`). The fake reads the
 * bare table, so the joined columns are added to its rows the way the view
 * would present them.
 */
function joinOverview() {
  for (const row of store.form_instances ?? []) {
    const template = store.form_templates!.find((entry) => entry.id === row.template_id);
    const version = store.form_template_versions.find((entry) => entry.id === row.template_version_id);
    Object.assign(row, {
      // The column default the fake does not apply: `form_date date not null default current_date`.
      form_date: row.form_date ?? "2026-09-28",
      template_key: template?.key,
      template_name: template?.name,
      layout_family: template?.layout_family,
      template_version: version?.version,
    });
  }
}

/** The browser's `formsFetch`, dispatched straight into the route handlers. */
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
  if (!response.ok) {
    if (process.env.EXIT_FORM_DEBUG) console.error(url, response.status, JSON.stringify(body));
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return body;
}

async function review(id: string) {
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
  const response = await pdfRoute.GET(new Request(`https://app.test/api/forms/instances/${id}/pdf`), {
    params: Promise.resolve({ id }),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/pdf");
  expect(response.headers.get("content-disposition")).toMatch(/attachment; filename=".*\.pdf"/);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const dir = process.env.EXIT_FORM_PDF_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.pdf`), bytes);
  }
  const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
  return text;
}

const said = (id: string, content: string): ChatMessage => ({
  id,
  role: "user",
  content,
  createdAt: "2026-09-28T15:00:00Z",
});

async function fromConversation(messages: ChatMessage[], continueTemplateKey?: string) {
  const current = messages[messages.length - 1]!;
  const response = await proposeFormForTurn({
    history: messages.slice(0, -1),
    question: current.content,
    questionMessageId: current.id,
    actor: { role: state.role as never, scope: state.scope as AccessScope },
    summaries: await listTemplateSummaries(),
    today: "2026-09-28",
    // What the browser sends when the previous assistant turn left a proposal open.
    ...(continueTemplateKey ? { continueTemplateKey } : {}),
  });
  const proposal = response!.formProposal!;
  expect(proposal.templateKey).toBe("stc-exit");
  expect(proposal.supportsInlineDraft).toBe(true);
  let created: string | null = null;
  const result = await createInlineForm({
    proposal,
    messages,
    call,
    onCreated: (reference) => {
      created = reference.instanceId;
    },
  });
  expect(created).toBe(result.reference.instanceId);
  return { response, proposal, result };
}

const YES_NO = [
  "store_items_returned",
  "payroll_deduction_applicable",
  "forfeit_bonus",
  "dropped_to_minimum_wage",
  "written_notice_attached",
  "eligible_for_rehire",
];

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  state.role = "salon_director";
  state.scope = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: ["loc-0311"] };
  state.modelCalls = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-28T15:00:00Z"));
  await ensureTemplateLibrary("system");
});

describe("a populated draft", () => {
  it("carries the conversation's facts, leaves every decision blank, and downloads", async () => {
    state.details =
      "Jane Smith gave two weeks notice on 9/14 and worked out her notice. Her last day was Sept 26. She is not eligible for rehire. The form was signed.";
    const { result } = await fromConversation([
      said("m1", "Jane Smith, one of my TCs at lincoln o street, gave her two weeks notice on 9/14."),
      said("m2", "She worked out her notice and her last day was Sept 26. Create an STC exit for jane."),
    ]);
    expect(result.draftWarning).toBeNull();
    expect(state.modelCalls).toBe(1);

    const { instance, values } = await review(result.reference.instanceId);
    expect(instance).toMatchObject({
      templateKey: "stc-exit",
      employeeName: "Jane Smith",
      employeeRole: "Tanning Consultant",
      locationId: "loc-0311",
      locationName: "NE Lincoln O Street",
      status: "draft",
      source: "ask_sunny",
    });

    const byKey = Object.fromEntries(values.map((row) => [row.fieldKey, row]));
    expect(byKey.employee_name?.value).toBe("Jane Smith");
    expect(byKey.job_title?.value).toBe("Tanning Consultant");
    expect(byKey.location?.value).toBe("NE Lincoln O Street");
    expect(byKey.form_date?.value).toBe("2026-09-28");
    expect(byKey.last_day_worked?.value).toBe("2026-09-26");
    expect(byKey.notice_given_date?.value).toBe("2026-09-14");
    expect(byKey.resignation_notice?.checked).toEqual(["submitted_fulfilled_notice"]);
    expect(byKey.details?.value).toBe(
      "Jane Smith gave two weeks notice on 9/14 and worked out her notice. Her last day was Sept 26.",
    );
    // Nothing a person decides was written, whatever the model sent.
    for (const key of [...YES_NO, "permanent_address", "notice_fulfilled_date", "resignation_type"]) {
      expect(byKey[key], key).toBeUndefined();
    }

    const text = await download(result.reference.instanceId, "exit-populated");
    expect(text).toContain("DRAFT");
    expect(text).toContain("Resignation/Exit Form");
    expect(text).toContain("Jane Smith");
    expect(text).toContain("NE Lincoln O Street");
    expect(text).toContain("Tanning Consultant");
    expect(text).toContain("Her last day was Sept 26.");
    expect(text).not.toMatch(/not eligible for rehire|was signed/);
    expect(text).not.toContain("Invented Road");
  });
});

describe("a mostly blank draft", () => {
  it("is just the name and today's date, with every other line empty", async () => {
    // One assigned salon, so the Location is the only line settled without being said.
    state.scope = { level: "salon", primaryAreaId: "loc-0309", alsoCoversAreaIds: [] };
    state.details = "";
    const { response, result } = await fromConversation(
      [said("m1", "pull up the exit form"), said("m2", "Jane Doe")],
      "stc-exit",
    );
    expect(response!.formProposal!.status).toBe("ready");
    const { values, instance } = await review(result.reference.instanceId);
    const byKey = Object.fromEntries(values.map((row) => [row.fieldKey, row]));
    expect(instance.employeeName).toBe("Jane Doe");
    expect(Object.keys(byKey).sort()).toEqual(["employee_name", "form_date", "location"]);
    expect(byKey.written_notice_attached).toBeUndefined();

    const text = await download(result.reference.instanceId, "exit-blank");
    expect(text).toContain("Written notice attached?");
    expect(text).toContain("Steps to Finish Termination");
  });
});

describe("nothing outside the form happens", () => {
  it("creating, drafting and downloading touch only the form tables", async () => {
    state.details = "Jane Smith walked out mid-shift on 9/26.";
    const before = Object.keys(store).sort();
    const { result } = await fromConversation([
      said("m1", "Jane Smith walked out mid-shift on 9/26, last day 9/26. exit form for her at NE Lincoln O Street"),
    ]);
    await download(result.reference.instanceId, "exit-safety");
    // The fake creates a table the first time anything writes to it; no other table appeared.
    expect(Object.keys(store).sort()).toEqual(before);
    // The record's own history: created, drafted, exported. Nothing else happened.
    const events = (store.form_instance_events ?? []).map((row) => String(row.kind));
    expect(events).toEqual(["created", "drafted", "exported"]);
    const instance = store.form_instances!.find((row) => row.id === result.reference.instanceId)!;
    expect(instance.status).toBe("draft");
    expect(instance.finalized_at ?? null).toBeNull();
  });
});
