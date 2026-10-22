import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * EDITING A FINALIZED EXIT FORM, END TO END
 * ============================================================================
 *
 * The production feedback, replayed through the real routes: an exit form for
 * Lacey Morrow is created and finalized; "duplicate exit for lacey morrow
 * and change date notice given to 9-27-26" opens a new draft of it with the
 * change made; the draft is finalized and replaces the original — or deleted,
 * and the original is exactly as it was.
 *
 * The harness is `exit-form-e2e.test.ts`'s: everything is real except the
 * identity provider, the model and the database (the in-memory fake).
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
const { reopenRequestedForm } = await import("@/lib/forms/chat-reopen");
const { listOutstandingFollowUps } = await import("@/lib/forms/instances");

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

/*
 * THE VIEW'S JOIN ON EVERY READ. Here a single chat turn inserts the revision
 * and then authorizes it, with no gap for `joinOverview()` between, and the
 * real view joins on every read — so the fake's rows are joined as they are
 * read, the way the view presents them.
 */
function joinedOnRead(): FakeStore["form_instances"] {
  return new Proxy([] as FakeStore["form_instances"], {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof property === "string" && /^\d+$/.test(property) && value) {
        const row = value as Record<string, unknown>;
        const template = store.form_templates!.find((entry) => entry.id === row.template_id);
        const version = store.form_template_versions.find((entry) => entry.id === row.template_version_id);
        Object.assign(row, {
          form_date: row.form_date ?? "2026-09-28",
          template_key: template?.key,
          template_name: template?.name,
          layout_family: template?.layout_family,
          template_version: version?.version,
        });
      }
      return value;
    },
  });
}

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  store.form_instances = joinedOnRead();
  state.role = "salon_director";
  state.scope = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: ["loc-0311"] };
  state.modelCalls = 0;
  state.details = "";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-28T15:00:00Z"));
  await ensureTemplateLibrary("system");
});

async function act(id: string, body: Record<string, unknown>) {
  joinOverview();
  const response = await instanceRoute.POST(
    new Request(`https://app.test/api/forms/instances/${id}`, { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
  joinOverview();
  const payload = (await response.json()) as { instance?: { id: string; status: string }; error?: string };
  expect(response.status, payload.error).toBe(200);
  return payload.instance!;
}

/** Lacey Morrow' exit form, created from chat and finalized with a follow-up. */
async function finalizedExit() {
  const { result } = await fromConversation([
    said("m1", "Create an STC exit for Lacey Morrow at lincoln o street. She quit by text on 9/20, last day 9/19. She returned her key."),
  ]);
  const id = result.reference.instanceId;
  await act(id, { action: "finalize", followUpDate: "2026-10-05" });
  return id;
}

const reopen = (question: string, activeInstanceId?: string) =>
  reopenRequestedForm({
    request: new Request("https://app.test/api/chat", { method: "POST" }),
    question,
    history: [],
    today: "2026-09-28",
    activeInstanceId,
  });

const statusOf = (id: string) => store.form_instances.find((row) => row.id === id)?.status;
const valueOf = async (id: string, key: string) =>
  (await review(id)).values.find((row) => row.fieldKey === key)?.value ?? null;

describe("a finalized exit form, edited as a new draft", () => {
  it("opens the draft with the change made, and replaces the original only when finalized", async () => {
    const original = await finalizedExit();
    const before = (await review(original)).values;

    const response = await reopen("duplicate exit for lacey morrow and change date notice given to 9-27-26");
    const draft = response!.formOpened!.instanceId;
    expect(draft).not.toBe(original);
    expect(response!.formOpened!.revisesInstanceId).toBe(original);
    expect(response!.content).toContain("was finalized, so I opened a new draft of it");
    expect(response!.content).toContain("Date that notice was given");

    // The draft: every answer carried, the change made, the follow-up kept.
    expect(statusOf(draft)).toBe("draft");
    expect(await valueOf(draft, "notice_given_date")).toBe("2026-09-27");
    expect(await valueOf(draft, "last_day_worked")).toBe(await valueOf(original, "last_day_worked"));
    expect((await review(draft)).instance.followUpDate).toBe("2026-10-05");

    // The original: untouched, still finalized, still the one tracking the follow-up.
    expect(statusOf(original)).toBe("finalized");
    expect((await review(original)).values).toEqual(before);
    joinOverview();
    expect((await listOutstandingFollowUps(50, null)).map((row) => row.id)).toEqual([original]);

    // Asking again lands on the same draft — no second revision.
    const again = await reopen("change exit for lacey morrow");
    expect(again!.formOpened!.instanceId).toBe(draft);
    expect(store.form_instances).toHaveLength(2);

    // Finalizing the draft replaces the original, and moves the follow-up to it.
    await act(draft, { action: "finalize", followUpDate: "2026-10-05" });
    expect(statusOf(original)).toBe("revised");
    expect((await review(original)).values).toEqual(before);
    joinOverview();
    expect((await listOutstandingFollowUps(50, null)).map((row) => row.id)).toEqual([draft]);
    expect(
      store.form_instance_events.some(
        (event) => event.instance_id === original && event.kind === "revised" && (event.detail as Record<string, unknown>).revisionId === draft,
      ),
    ).toBe(true);
  });

  it("deleting the draft leaves the original exactly as it was", async () => {
    const original = await finalizedExit();
    const before = (await review(original)).values;

    const draft = (await act(original, { action: "revise" })).id;
    // The card's button again, while the draft is open: the same draft back.
    expect((await act(original, { action: "revise" })).id).toBe(draft);

    // Removing a draft is `manage_form_records`, an administrator's permission.
    state.role = "admin";
    state.scope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
    joinOverview();
    const removed = await instanceRoute.DELETE(new Request(`https://app.test/api/forms/instances/${draft}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: draft }),
    });
    expect(removed.status).toBe(200);

    expect(statusOf(original)).toBe("finalized");
    expect((await review(original)).values).toEqual(before);
    joinOverview();
    expect((await listOutstandingFollowUps(50, null)).map((row) => row.id)).toEqual([original]);
    // And it can be edited again from scratch.
    const next = (await act(original, { action: "revise" })).id;
    expect(next).not.toBe(draft);
    expect(statusOf(next)).toBe("draft");
  });
});
