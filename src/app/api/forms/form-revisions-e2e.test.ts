import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * EDITING A FINALIZED FORM, WITH A REASON AND A HISTORY (FORM_REVISIONS_ENABLED)
 * ============================================================================
 *
 * Three pieces of production feedback, replayed through the real routes. The
 * people are invented; the managers' words are theirs.
 *
 *   conv_mvh23t8s2q9mi45  "Document would not let us edit the document once
 *                          it was finalized."           (Corrective Action)
 *   conv_mv73vlmy46wn8bn  "works reallly good wish we could edit after this
 *                          step but i like it!"         (Exit Form)
 *   conv_mvh1m29j25aig2n  "It will not let me write an additional document
 *                          for an employee who was given a previous document.
 *                          It is telling me to start a new chat and when I do
 *                          that it will still not recreate."
 *
 * With the flag on, a finalized form is edited as a revision that records WHY
 * and its number, the PDF and the history say what replaced what, and an edit
 * without a reason is refused. The harness is `exit-form-revision-e2e.test.ts`'s:
 * everything is real except the identity provider, the model and the database.
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
const historyRoute = await import("./instances/[id]/history/route");
const pdfRoute = await import("./instances/[id]/pdf/route");
const draftRoute = await import("./instances/[id]/draft/route");
const { reopenRequestedForm } = await import("@/lib/forms/chat-reopen");
const { REVISION_REASON_REQUIRED } = await import("@/lib/forms/revision-history");

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

async function save(id: string, values: Record<string, string>) {
  const response = await instanceRoute.PATCH(
    new Request(`https://app.test/api/forms/instances/${id}`, { method: "PATCH", body: JSON.stringify({ values, checked: {} }) }),
    { params: Promise.resolve({ id }) },
  );
  expect(response.status).toBe(200);
}

async function review(id: string) {
  const response = await instanceRoute.GET(new Request(`https://app.test/api/forms/instances/${id}`), {
    params: Promise.resolve({ id }),
  });
  return { status: response.status, body: (await response.json()) as { values: { fieldKey: string; value: string | null }[] } };
}

interface HistoryBody {
  history: { entries: { id: string; reference: string; revisionNumber: number; reason: string | null; status: string }[] };
  marks: { kind: string }[];
  label: string | null;
}

async function history(id: string) {
  const response = await historyRoute.GET(new Request(`https://app.test/api/forms/instances/${id}/history`), {
    params: Promise.resolve({ id }),
  });
  return { status: response.status, body: (await response.json()) as HistoryBody };
}

/** Every string drawn on the PDF, as printed. */
async function printed(id: string): Promise<string[]> {
  const response = await pdfRoute.GET(new Request(`https://app.test/api/forms/instances/${id}/pdf`), {
    params: Promise.resolve({ id }),
  });
  expect(response.status).toBe(200);
  const source = Buffer.from(await response.arrayBuffer()).toString("latin1");
  return [...source.matchAll(/Tm \((.*?)\) Tj ET/g)].map((match) => match[1]!.replace(/\\([\\()])/g, "$1"));
}

const createdEvent = (id: string) =>
  store.form_instance_events.find((event) => event.instance_id === id && event.kind === "created")!.detail as Record<string, unknown>;
const statusOf = (id: string) => store.form_instances.find((row) => row.id === id)?.status;
const ref = (id: string) => id.slice(0, 8);

const reopen = (question: string) =>
  reopenRequestedForm({
    request: new Request("https://app.test/api/chat", { method: "POST" }),
    question,
    history: [],
    today: "2026-10-20",
  });

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  store.form_instances = joinedOnRead();
  state.role = "salon_director";
  state.scope = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: ["loc-0311"] };
  state.details = "";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T19:23:00Z"));
  process.env.FORM_REVISIONS_ENABLED = "true";
  await ensureTemplateLibrary("system");
});

afterEach(() => {
  delete process.env.FORM_REVISIONS_ENABLED;
});

describe('"Document would not let us edit the document once it was finalized." (Corrective Action)', () => {
  it("edits the finalized form as Revision 1, with the reason on its history and the marks on both PDFs", async () => {
    const original = await fromChat("create ca for Marisol Quenby at lincoln o street", "dpoa");
    await finalize(original);
    const frozen = (await review(original)).body.values;

    // The card's Edit button, with the reason the dialog asked for.
    const reason = "Wrong offense date was entered; the incident was on 10/18.";
    const revision = (await act(original, { action: "revise", reason })).id;
    expect(revision).not.toBe(original);
    expect(statusOf(revision)).toBe("draft");
    expect(createdEvent(revision)).toMatchObject({ revisionOf: original, kind: "revised", reason, revisionNumber: 1 });

    // The draft revision prints as one, and names what it will replace.
    expect((await printed(revision)).join("\n")).toContain(`Revision 1 of ${ref(original)}, draft (supersedes ${ref(original)} once finalized)`);

    // Edited on the new draft, then finalized: the original is superseded, its values untouched.
    await save(revision, { observation: "Arrived 40 minutes late on 10/18 without calling ahead." });
    vi.setSystemTime(new Date("2026-10-21T15:00:00Z"));
    await finalize(revision);
    expect(statusOf(original)).toBe("revised");
    expect((await review(original)).body.values).toEqual(frozen);

    const revisedLines = (await printed(revision)).join("\n");
    expect(revisedLines).toMatch(new RegExp(`Revised \\S+ \\(supersedes ${ref(original)}\\)`));
    const originalLines = (await printed(original)).join("\n");
    expect(originalLines).toMatch(new RegExp(`Superseded \\S+ by ${ref(revision)}`));

    // The history: "Revision 1 of <ref>", the previous version, and why.
    const { status, body } = await history(revision);
    expect(status).toBe(200);
    expect(body.label).toBe(`Revision 1 of ${ref(original)}`);
    expect(body.history.entries.map((entry) => [entry.id, entry.revisionNumber, entry.reason])).toEqual([
      [original, 0, null],
      [revision, 1, reason],
    ]);
    expect(body.marks.map((mark) => mark.kind)).toEqual(["revised"]);
    expect((await history(original)).body.marks.map((mark) => mark.kind)).toEqual(["superseded"]);

    // Edited again: Revision 2, numbered from the chain.
    const second = (await act(revision, { action: "revise", reason: "Manager signature line was printed for the wrong manager." })).id;
    expect(createdEvent(second)).toMatchObject({ revisionOf: revision, revisionNumber: 2 });
    expect((await history(second)).body.label).toBe(`Revision 2 of ${ref(original)}`);
  });

  it("refuses an edit with no reason, and opens nothing", async () => {
    const original = await fromChat("create ca for Marisol Quenby at lincoln o street", "dpoa");
    await finalize(original);
    const before = store.form_instances.length;

    for (const body of [{ action: "revise" }, { action: "revise", reason: "   " }, { action: "revise", reason: " . " }]) {
      const refused = await post(original, body);
      expect(refused.status).toBe(400);
      expect(refused.body.code).toBe(REVISION_REASON_REQUIRED);
      expect(refused.body.error).toContain("needs a reason");
      expect(refused.body.error).toContain("signed again");
    }
    expect(store.form_instances).toHaveLength(before);
    expect(statusOf(original)).toBe("finalized");
  });
});

describe('"works reallly good wish we could edit after this step but i like it!" (Exit Form)', () => {
  const words =
    "can you make me an exit form for tamsin ardwell at lincoln o street she is quiting due to starting hair school and with hair school hours she wont be able to fit sun tan city into her schedule";

  it("a chat edit asks for the reason first; with the draft open, the same request lands on it", async () => {
    const original = await fromChat(words, "stc-exit");
    await finalize(original);

    // Chat cannot give a reason, so nothing is opened: the card comes back with the way to give one.
    const refused = await reopen("duplicate exit for tamsin ardwell and change date notice given to 10-12-26");
    expect(refused!.content).toContain("needs a reason");
    expect(refused!.content).toContain("Edit as new draft");
    expect(refused!.content).toContain("signed again");
    expect(refused!.formOpened!.instanceId).toBe(original);
    expect(store.form_instances).toHaveLength(1);

    // The reason given on the card opens the draft…
    const draft = (await act(original, { action: "revise", reason: "She gave notice on 10/12, not 10/13." })).id;
    // …and the same chat request now makes the change on it.
    const applied = await reopen("duplicate exit for tamsin ardwell and change date notice given to 10-12-26");
    expect(applied!.formOpened!.instanceId).toBe(draft);
    expect((await review(draft)).body.values.find((row) => row.fieldKey === "notice_given_date")?.value).toBe("2026-10-12");
    expect(store.form_instances).toHaveLength(2);

    await finalize(draft);
    expect((await history(draft)).body.history.entries.map((entry) => entry.status)).toEqual(["revised", "finalized"]);
    expect((await printed(original)).join("\n")).toMatch(new RegExp(`Superseded \\S+ by ${ref(draft)}`));
  });
});

describe('"It will not let me write an additional document for an employee who was given a previous document." (Corrective Action)', () => {
  it("the manager can open, edit and read the earlier document's new version at a salon they cover", async () => {
    // The previous document is at the salon the manager covers, not their home salon.
    const previous = await fromChat("create a corrective action form for Juniper Halloway at lincoln o street", "dpoa");
    expect(store.form_instances.find((row) => row.id === previous)?.location_id).toBe("loc-0311");
    await finalize(previous);

    const revision = (await act(previous, { action: "revise", reason: "Second offense: adding the 10/20 no-call no-show." })).id;
    expect((await review(revision)).status).toBe(200);
    const { status, body } = await history(revision);
    expect(status).toBe(200);
    expect(body.history.entries.map((entry) => entry.id)).toEqual([previous, revision]);

    // A separate additional document for the same employee opens too.
    const additional = await fromChat("create a corrective action form for Juniper Halloway at lincoln o street", "dpoa");
    expect(additional).not.toBe(previous);
    expect((await review(additional)).status).toBe(200);
  });
});

describe("with the flag off", () => {
  it("revises without a reason, records no reason or number, and has no history route", async () => {
    delete process.env.FORM_REVISIONS_ENABLED;
    const original = await fromChat("create ca for Marisol Quenby at lincoln o street", "dpoa");
    await finalize(original);
    const revision = (await act(original, { action: "revise", reason: "ignored with the flag off" })).id;
    expect(createdEvent(revision)).toEqual({ revisionOf: original, kind: "revised" });
    expect((await history(revision)).status).toBe(404);
    await finalize(revision);
    const lines = (await printed(original)).join("\n");
    expect(lines).not.toContain("Superseded");
  });
});
