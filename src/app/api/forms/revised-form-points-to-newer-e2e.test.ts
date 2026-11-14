import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * EDITING A FORM A NEWER VERSION ALREADY REPLACED (REVISED_FORM_POINTS_TO_NEWER_ENABLED)
 * ============================================================================
 *
 * A live runtime error (Ask Sunny, 14 Nov 2026, 01:36Z, a district manager revising forms):
 *   route /api/forms/instances/[id]
 *   "[ask-sunny] forms/instance/action: Error: That form has already been revised."
 * QA's questions: "Is this guard thrown as a 500, or returned as a clear 4xx with a message the manager sees? What does
 * the manager see in the UI when they press "Edit as new draft" … on a form that already has a revision?"
 *
 * The real path: a card loaded while its form was finalized; a revision of it was then opened and finalized elsewhere
 * (another tab, the chat, Form Monitoring); "Edit as new draft" is pressed on the stale card. Off, the route answered a
 * 500 "Something went wrong. Nothing was answered or saved." On, it is a 409 with `form_already_revised`, a line that
 * points to the newer version and its id, and nothing is opened or changed. The card's side is in
 * `features/chat/inline-form.dom.test.tsx`. The harness is `form-revisions-e2e.test.ts`'s; people are invented.
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
      create: async () => ({
        content: [{ type: "tool_use", name: "write_form_fields", input: { values: { details: state.details }, checked: {} } }],
      }),
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
const { FORM_ALREADY_REVISED, FORM_ALREADY_REVISED_MESSAGE } = await import("@/lib/forms/revision-history");

/** The view's join, which the fake does not model (see `exit-form-revision-e2e.test.ts`). */
function joinedOnRead(): FakeStore["form_instances"] {
  return new Proxy([] as FakeStore["form_instances"], {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof property === "string" && /^\d+$/.test(property) && value) {
        const row = value as Record<string, unknown>;
        const template = store.form_templates!.find((entry) => entry.id === row.template_id);
        const version = store.form_template_versions.find((entry) => entry.id === row.template_version_id);
        Object.assign(row, {
          form_date: row.form_date ?? "2026-10-20",
          template_key: template?.key,
          template_name: template?.name,
          template_short_name: template?.short_name,
          layout_family: template?.layout_family,
          template_version: version?.version,
        });
      }
      return value;
    },
  });
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
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

const said = (id: string, content: string): ChatMessage => ({ id, role: "user", content, createdAt: "2026-10-20T15:00:00Z" });

/** A form created from the manager's own words, the way the chat card creates it. */
async function fromChat(words: string, templateKey: string) {
  const messages = [said("m1", words)];
  const response = await proposeFormForTurn({
    history: [],
    question: words,
    questionMessageId: "m1",
    actor: { role: state.role as never, scope: state.scope as AccessScope },
    summaries: await listTemplateSummaries(),
    today: "2026-10-20",
  });
  const proposal = response!.formProposal!;
  expect(proposal.templateKey).toBe(templateKey);
  const result = await createInlineForm({ proposal, messages, call, onCreated: () => {} });
  return result.reference.instanceId;
}

async function post(id: string, body: Record<string, unknown>) {
  const response = await instanceRoute.POST(
    new Request(`https://app.test/api/forms/instances/${id}`, { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
  return { status: response.status, body: (await response.json()) as { instance?: { id: string; status: string }; error?: string; code?: string } };
}

async function act(id: string, body: Record<string, unknown>) {
  const { status, body: payload } = await post(id, body);
  expect(status, payload.error).toBe(200);
  return payload.instance!;
}

const finalize = (id: string) => act(id, { action: "finalize", acknowledgeUnverifiedPolicy: true });

async function review(id: string) {
  const response = await instanceRoute.GET(new Request(`https://app.test/api/forms/instances/${id}`), {
    params: Promise.resolve({ id }),
  });
  return { status: response.status, body: (await response.json()) as { values: { fieldKey: string; value: string | null }[] } };
}

const statusOf = (id: string) => store.form_instances.find((row) => row.id === id)?.status;

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  store.form_instances = joinedOnRead();
  state.role = "salon_director";
  state.scope = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: ["loc-0311"] };
  state.details = "";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T19:23:00Z"));
  await ensureTemplateLibrary("system");
});

afterEach(() => {
  delete process.env.FORM_REVISIONS_ENABLED;
  delete process.env.REVISED_FORM_POINTS_TO_NEWER_ENABLED;
});

/** A finalized form whose card has loaded, then revised and the revision finalized elsewhere. */
async function replacedWhileTheCardWasOpen(revisions: boolean) {
  if (revisions) process.env.FORM_REVISIONS_ENABLED = "true";
  const original = await fromChat("create ca for Marisol Quenby at lincoln o street", "dpoa");
  await finalize(original);
  expect((await review(original)).status).toBe(200); // the card, loaded while finalized
  const body = revisions ? { action: "revise", reason: "Wrong offense date was entered." } : { action: "revise" };
  const revision = (await act(original, body)).id; // elsewhere
  await finalize(revision);
  expect(statusOf(original)).toBe("revised");
  return { original, revision, body };
}

const counts = () => ({ forms: store.form_instances.length, events: store.form_instance_events.length });

describe("\"That form has already been revised.\" (live runtime error, 14 Nov 2026)", () => {
  for (const revisions of [false, true]) {
    const label = revisions ? "with FORM_REVISIONS on" : "with FORM_REVISIONS off";

    it(`flag off: the stale card's Edit is a 500 with the generic line, as before (${label})`, async () => {
      const { original, body } = await replacedWhileTheCardWasOpen(revisions);
      const before = counts();
      const refused = await post(original, body);
      expect(refused.status).toBe(500);
      expect(refused.body.code).toBe("internal");
      expect(refused.body.error).toBe("Something went wrong. Nothing was answered or saved.");
      expect(counts()).toEqual(before);
    });

    it(`flag on: a 409 with form_already_revised, a line pointing to the newer version, nothing opened (${label})`, async () => {
      const { original, revision, body } = await replacedWhileTheCardWasOpen(revisions);
      process.env.REVISED_FORM_POINTS_TO_NEWER_ENABLED = "true";
      const before = counts();
      const refused = await post(original, body);
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe(FORM_ALREADY_REVISED);
      expect(refused.body.error).toBe(FORM_ALREADY_REVISED_MESSAGE);
      expect((refused.body as { newerId?: string }).newerId).toBe(revision);
      expect(counts()).toEqual(before);
      expect(statusOf(original)).toBe("revised");
      expect(statusOf(revision)).toBe("finalized");
    });
  }

  it("flag on: the line points to the NEWEST version when the chain was revised twice since", async () => {
    const { original, revision } = await replacedWhileTheCardWasOpen(true);
    const second = (await act(revision, { action: "revise", reason: "Manager name was wrong." })).id;
    await finalize(second);
    process.env.REVISED_FORM_POINTS_TO_NEWER_ENABLED = "true";
    const refused = await post(original, { action: "revise", reason: "Wrong offense date was entered." });
    expect(refused.status).toBe(409);
    expect((refused.body as { newerId?: string }).newerId).toBe(second);
  });

  it("flag on: a finalized form with no revision is edited exactly as before", async () => {
    process.env.REVISED_FORM_POINTS_TO_NEWER_ENABLED = "true";
    const original = await fromChat("create ca for Marisol Quenby at lincoln o street", "dpoa");
    await finalize(original);
    const revision = (await act(original, { action: "revise" })).id;
    expect(revision).not.toBe(original);
    expect(statusOf(revision)).toBe("draft");
    // A second press while that revision is still a draft returns the same draft (one open revision at a time).
    expect((await act(original, { action: "revise" })).id).toBe(revision);
  });
});
