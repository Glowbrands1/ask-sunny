import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * QA F8 (MEETING ITEM M4) — "DELETE THAT DRAFT" AND "SAME INCIDENT"
 * ============================================================================
 *
 * Two production conversations, names replaced with synthetic ones:
 *
 *   conv_mvi54rx78njh733 (21 Oct 2026)
 *     "edit the corrective action for <name>"  opened a new draft of the
 *                                               finalized form — correct
 *     "delete that draft"                      "I haven't changed the
 *                                               Corrective Action Form…"
 *
 *   conv_mvjo2bu22j9ms1q (22 Oct 2026)
 *     "Write a CA for a TC <name> for opening the salon late"
 *        → "is this the same incident or a new one? … say 'edit the
 *           corrective action form for <name>'"
 *     "same incideny"                          told to type that phrase
 *
 * Every turn goes through POST /api/chat in the route's own order, the card's
 * Create through `createInlineForm`, and finalize through the real forms
 * route. Faked: identity, the database (in-memory), the directory read, the
 * models, analytics. DRAFT_ACTIONS_ENABLED is on unless a test says otherwise;
 * INTENT_EXTRACTION_ENABLED (on in production) is on for the whole file.
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
  draft: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown> },
  revision: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown>; clear?: string[] },
  revisionCalls: 0,
  chatModelCalls: 0,
  directory: [] as unknown[],
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

vi.mock("@/lib/config/server-env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config/server-env")>();
  return { ...actual, liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }) };
});

vi.mock("@/lib/auth/server", async () => {
  const { DEFAULT_PERMISSION_MATRIX, hasPermission } = await import("@/lib/permissions");
  const { AuthError } = await import("@/lib/auth/types");
  return {
    authorizeRequest: async (_request: Request, permission: string) => {
      if (!hasPermission(DEFAULT_PERMISSION_MATRIX, state.role as never, permission as never)) {
        throw new AuthError("forbidden", "Your role does not have permission to do that.");
      }
      return {
        identity: {
          subject: "qa-manager",
          email: "qa-manager@example.test",
          displayName: "QA Manager",
          role: state.role,
          scope: { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] },
          verified: true,
        },
        permission,
        provider: "supabase",
      };
    },
  };
});

vi.mock("@/lib/analytics/record", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics/record")>()),
  openTurn: async () => "turn-qa",
  closeTurn: async () => {},
  recordActivity: async () => {},
  recordActivityAsync: () => {},
}));

vi.mock("@/lib/ai/call-claude", () => ({
  callClaude: async () => {
    state.chatModelCalls += 1;
    return "A grounded answer.";
  },
}));

vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (request: { tool_choice?: { name?: string } }) => {
        const revising = request.tool_choice?.name === "revise_form_fields";
        if (revising) state.revisionCalls += 1;
        return {
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              name: revising ? "revise_form_fields" : "write_form_fields",
              input: revising ? state.revision : state.draft,
            },
          ],
        };
      },
    },
  }),
}));

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    async search() {
      return [];
    }
    async match() {
      return [];
    }
    async fetchRoleGrounding(role: { id: string }) {
      return {
        ok: true,
        grounding: {
          role: { id: role.id },
          documentId: "doc-progression",
          documentTitle: "PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
          matchedBy: "tag",
          rows: [
            {
              chunk_id: "pmf-0",
              document_id: "doc-progression",
              document_title: "PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
              category: "leadership_coaching",
              locator: "SECTION 2",
              page: null,
              section: null,
              content: "Solve the issue at the lowest appropriate level.",
              similarity: 0,
            },
          ],
          presentGroups: ["escalation_ladder"],
        },
      };
    }
    async fetchOfficialPolicyManual() {
      return {
        ok: true,
        documentId: "doc-manual",
        documentTitle: "2025 JBA Policy Manual - Edited 5-2025",
        documentCategory: "policies_compliance",
        matchedBy: "tag",
        chunks: JBA_MANUAL_CA_CHUNKS,
      };
    }
  },
}));

vi.mock("@/lib/knowledge", () => ({
  getKnowledgeProvider: () => {
    throw new Error("getKnowledgeProvider() is the browser knowledge client and must not be used on the server");
  },
}));

vi.mock("@/lib/reporting/read/report-briefing", () => ({ loadReportBriefing: async () => null }));
vi.mock("@/lib/reporting/read/employee-facts", () => ({
  loadEmployeeFacts: async () => null,
  NO_EMPLOYEE_DATA_REASON: "no dataset",
  NO_EMPLOYEE_DATASET_REASON: "no dataset",
  EMPLOYEE_DATA_HEADING: "CURRENT EMPLOYEE PERFORMANCE DATA",
}));

vi.mock("@/lib/forms/employee-roster", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/forms/employee-roster")>();
  return {
    ...actual,
    loadScopedRoster: async (scope: AccessScope | null) => actual.scopeRoster(state.directory as never, scope),
  };
});

process.env.NEXT_PUBLIC_DEMO_MODE = "false";

/* Each case loads the template library and runs several routes; a shared machine needs more than 5s. */
vi.setConfig({ hookTimeout: 30_000, testTimeout: 30_000 });

const { ensureTemplateLibrary } = await import("@/lib/forms/repository");
const { createInlineForm } = await import("@/features/chat/create-inline-form");
const chatRoute = await import("./route");
const instancesRoute = await import("../forms/instances/route");
const instanceRoute = await import("../forms/instances/[id]/route");
const draftRoute = await import("../forms/instances/[id]/draft/route");

const TODAY = "2026-10-22";

function joinOverview() {
  for (const row of store.form_instances ?? []) {
    const template = store.form_templates!.find((entry) => entry.id === row.template_id);
    const version = store.form_template_versions.find((entry) => entry.id === row.template_version_id);
    Object.assign(row, {
      form_date: row.form_date ?? TODAY,
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

/** The chat route only accepts a UUID for the open form; the fake numbers rows `fake-N`. */
function toUuid(id: string): string {
  if (/^[0-9a-f-]{36}$/.test(id)) return id;
  const uuid = randomUUID();
  for (const table of ["form_instances", "form_instance_values", "form_instance_events"] as const) {
    for (const row of store[table]) {
      if (row.id === id) row.id = uuid;
      if (row.instance_id === id) row.instance_id = uuid;
      if (row.revises_instance_id === id) row.revises_instance_id = uuid;
    }
  }
  return uuid;
}

type Answer = {
  content: string;
  formProposal?: ChatFormProposal;
  formOpened?: { instanceId: string; templateName: string; revisesInstanceId: string | null };
  formUpdate?: { instanceId: string; updated: string[] };
};

/** The thread as the browser holds it: a card opened by an answer becomes the open form. */
class Thread {
  readonly messages: ChatMessage[] = [];
  proposal: ChatFormProposal | null = null;
  instanceId: string | null = null;
  private sequence = 0;

  /** A production turn pair the stand-in model could not have written, replayed as history. */
  replay(question: string, answer: string) {
    const id = `m${(this.sequence += 1)}`;
    this.messages.push(
      { id, role: "user", content: question, createdAt: `${TODAY}T14:58:59Z` } as ChatMessage,
      { id: `a${this.sequence}`, role: "assistant", content: answer, createdAt: `${TODAY}T14:59:16Z` } as ChatMessage,
    );
  }

  async say(question: string): Promise<Answer> {
    const history = this.messages.map(({ id, role, content }) => ({ id, role, content }));
    const id = `m${(this.sequence += 1)}`;
    const response = await chatRoute.POST(
      new Request("https://app.test/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question,
          mode: "standard",
          history,
          questionMessageId: id,
          ...(this.proposal && !this.instanceId ? { continueProposalTemplateKey: this.proposal.templateKey } : {}),
          ...(this.instanceId ? { activeFormInstanceId: this.instanceId } : {}),
        }),
      }),
    );
    const payload = (await response.json()) as Answer & { error?: string };
    expect(response.status, JSON.stringify(payload)).toBe(200);
    this.messages.push(
      { id, role: "user", content: question, createdAt: `${TODAY}T15:00:00Z` } as ChatMessage,
      {
        id: `a${this.sequence}`,
        role: "assistant",
        content: payload.content,
        createdAt: `${TODAY}T15:00:01Z`,
        ...(payload.formProposal ? { formProposal: payload.formProposal } : {}),
      } as ChatMessage,
    );
    if (payload.formProposal) {
      this.proposal = payload.formProposal;
      this.instanceId = null;
    }
    if (payload.formOpened) {
      payload.formOpened.instanceId = toUuid(payload.formOpened.instanceId);
      this.instanceId = payload.formOpened.instanceId;
    }
    return payload;
  }

  async create() {
    expect(this.proposal, "no card to create from").not.toBeNull();
    const result = await createInlineForm({
      proposal: this.proposal!,
      messages: this.messages,
      call,
      onCreated: () => {},
    });
    this.instanceId = toUuid(result.reference.instanceId);
    return this.instanceId;
  }
}

async function finalize(id: string) {
  const response = await instanceRoute.POST(
    new Request(`https://app.test/api/forms/instances/${id}`, {
      method: "POST",
      body: JSON.stringify({ action: "finalize", followUpDate: null }),
    }),
    { params: Promise.resolve({ id }) },
  );
  joinOverview();
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
}

/*
 * THE CROSS-CHAT DRAFT GUARD READS `employee_name` WITH `ilike`, which the
 * shared fake does not model (and every other file relies on its absence).
 * Modelled here only, on `form_instances` only, as case-insensitive equality,
 * so the guard runs for real. Any other table still has no `ilike`, as before.
 */
{
  const proto = Object.getPrototypeOf(fakeSupabase(store).from("form_instances")) as Record<string, unknown>;
  proto.ilike = function (
    this: { table: string; filters: ((row: Record<string, unknown>) => boolean)[] },
    column: string,
    pattern: string,
  ) {
    if (this.table !== "form_instances") throw new TypeError(`fake-supabase: ilike is not modelled for ${this.table}`);
    this.filters.push((row) => String(row[column] ?? "").toLowerCase() === pattern.toLowerCase());
    return this;
  };
}

const row = (id: string) => (store.form_instances ?? []).find((entry) => entry.id === id) ?? null;
const drafts = (employee: string) =>
  (store.form_instances ?? []).filter((entry) => entry.employee_name === employee && entry.status === "draft");

/* Synthetic people only. */
const DIRECTORY = [
  { id: "e-1", firstName: "Marlo", lastName: "Quist", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0310"] },
  { id: "e-2", firstName: "Sela", lastName: "Brandt", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0310"] },
];

const LATE_OPENING_MODEL = {
  values: {
    observation:
      "Observed:\nSela was scheduled to open at 8:30am on October 17, 2026 and did not arrive until 11:06, so the salon opened late.\n\nExpectation:\nAn employee assigned to open is expected to open on time.\n\nGoing Forward:\nSela should arrive in time to open.",
  },
  checked: { offense_type: ["tardiness"] },
};

class JoiningRows extends Array<Record<string, unknown>> {
  override push(...rows: Record<string, unknown>[]) {
    const count = super.push(...rows);
    joinOverview();
    return count;
  }
}

const saved = { DRAFT_ACTIONS_ENABLED: process.env.DRAFT_ACTIONS_ENABLED, INTENT_EXTRACTION_ENABLED: process.env.INTENT_EXTRACTION_ENABLED };

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  store.form_instances = new JoiningRows() as never;
  state.role = "salon_director";
  state.draft = LATE_OPENING_MODEL;
  state.revision = { values: {} };
  state.revisionCalls = 0;
  state.chatModelCalls = 0;
  state.directory = DIRECTORY;
  process.env.DRAFT_ACTIONS_ENABLED = "on";
  process.env.INTENT_EXTRACTION_ENABLED = "on";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T15:00:00Z`));
  await ensureTemplateLibrary("system");
});

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.useRealTimers();
});

/** A Corrective Action Form for the person, created from chat in an earlier conversation. */
async function caOnFile(employee: string, options: { finalized: boolean }) {
  const earlier = new Thread();
  await earlier.say(`create a corrective action form for ${employee} for opening the salon late on 10-17-26. payroll deduct no`);
  const id = await earlier.create();
  if (options.finalized) await finalize(id);
  return id;
}

const NOT_CHANGED = /I haven't changed/;

/* ========================================================================= */
/* CASE 1 — conv_mvi54rx78njh733: "delete that draft" after a draft is open  */
/* ========================================================================= */

describe('QA F8 case 1: "delete that draft" after Sunny opened a draft', () => {
  async function openedRevision() {
    const original = await caOnFile("Marlo Quist", { finalized: true });
    const thread = new Thread();
    /* Production, 13:21:14 UTC, name replaced. */
    const opened = await thread.say("edit the corrective action for Marlo Quist");
    expect(opened.formOpened?.revisesInstanceId).toBe(original);
    const draft = opened.formOpened!.instanceId;
    expect(row(draft)?.status).toBe("draft");
    return { thread, original, draft };
  }

  it.each([["delete that draft"], ["delete the draft"], ["discard it"]])(
    'a District Manager: "%s" deletes the new draft; the finalized form is untouched',
    async (words) => {
      state.role = "district_manager";
      const { thread, original, draft } = await openedRevision();
      const answer = await thread.say(words);
      expect(answer.content).not.toMatch(NOT_CHANGED);
      expect(answer.content).toMatch(/Deleted the new draft of the \*\*Corrective Action Form\*\* for \*\*Marlo Quist\*\*/);
      expect(answer.content).toMatch(/finalized form stays on file/);
      expect(row(draft)).toBeNull();
      expect(row(original)?.status).toBe("finalized");
      expect(state.revisionCalls).toBe(0);
    },
  );

  it.each([["delete that draft"], ["delete the draft"], ["discard it"]])(
    'a Salon Director (no delete permission): "%s" is told truthfully who can delete it, and nothing is deleted',
    async (words) => {
      const { thread, original, draft } = await openedRevision();
      const answer = await thread.say(words);
      expect(answer.content).not.toMatch(NOT_CHANGED);
      expect(answer.content).toMatch(/can't delete the draft/);
      expect(answer.content).toMatch(/Delete and archive filed forms/);
      expect(answer.content).toMatch(/Form Monitoring/);
      expect(answer.content).toMatch(/finalized form stays on file/);
      expect(row(draft)?.status).toBe("draft");
      expect(row(original)?.status).toBe("finalized");
      expect(state.revisionCalls).toBe(0);
    },
  );

  it("a form just created from the card: a District Manager deletes it with \"delete the draft\"", async () => {
    state.role = "district_manager";
    const thread = new Thread();
    await thread.say("create a corrective action form for Sela Brandt for opening the salon late on 10-17-26. payroll deduct no");
    const id = await thread.create();
    const answer = await thread.say("delete the draft");
    expect(answer.content).toMatch(/Deleted the draft \*\*Corrective Action Form\*\* for \*\*Sela Brandt\*\*/);
    expect(row(id)).toBeNull();
  });

  it("a finalized form on screen is never deleted", async () => {
    state.role = "district_manager";
    const thread = new Thread();
    await thread.say("create a corrective action form for Sela Brandt for opening the salon late on 10-17-26. payroll deduct no");
    const id = await thread.create();
    await finalize(id);
    const answer = await thread.say("delete that draft");
    expect(answer.content).toMatch(/is finalized, so it can't be deleted/);
    expect(row(id)?.status).toBe("finalized");
  });

  it("a card not yet created: nothing to delete, and nothing is created", async () => {
    const thread = new Thread();
    const card = await thread.say("create a corrective action form for Sela Brandt for opening the salon late on 10-17-26. payroll deduct no");
    expect(card.formProposal?.templateKey).toBe("dpoa");
    const answer = await thread.say("delete the draft");
    expect(answer.content).toMatch(/Nothing has been created yet/);
    expect(store.form_instances).toHaveLength(0);
  });

  it("a removal of text on the form is still a revision, not a delete", async () => {
    state.role = "district_manager";
    const { thread, draft } = await openedRevision();
    await thread.say("remove the last sentence of the observation");
    expect(row(draft)?.status).toBe("draft");
  });

  it("flag off: the turn is answered as before", async () => {
    process.env.DRAFT_ACTIONS_ENABLED = "off";
    state.role = "district_manager";
    const { thread, draft } = await openedRevision();
    await thread.say("delete that draft");
    expect(row(draft)?.status).toBe("draft");
  });
});

/* ========================================================================= */
/* CASE 2 — conv_mvjo2bu22j9ms1q: "same incideny" opens the form on file     */
/* ========================================================================= */

/** Production, 14:58:59 UTC, name replaced. */
const REQUEST = "Write a CA for a TC Sela Brandt for opening the salon late";

/** What the general answer wrote (14:59:16 UTC), name replaced. The stand-in model cannot write it, so it is replayed. */
const ASKED =
  'Worth flagging before you start a new one: on October 17 you already created a Corrective Action Form for Sela Brandt for opening late — she didn\'t show for her 8:30 shift until 11:06 — and that one is still a draft, not finalized. You also finalized two coaching forms for her dated 10/13, both for being late without contacting anyone and out of dress code.\n\nSo the question is whether this is the same incident or a new one:\n\n- **Same incident** — say "edit the corrective action form for Sela Brandt" and the draft comes back here to finish.\n- **New incident** — say "create a corrective action form for Sela Brandt" and give me the date and what happened, and the draft card will come up. Nothing is created until you press Create.\n\nThe policy language you\'ll be documenting against: an employee who can\'t open on time must notify the manager as soon as possible [S4][S5].';

const MAGIC_PHRASE = /say \*{0,2}["“]edit the/i;

describe('QA F8 case 2: "same incident" answering "is this the same incident?"', () => {
  it.each([["same incideny"], ["same incident"], ["Same incident."], ["yes same one"]])(
    '"%s" opens the existing draft, with no phrase to type',
    async (words) => {
      const existing = await caOnFile("Sela Brandt", { finalized: false });
      const thread = new Thread();
      thread.replay(REQUEST, ASKED);
      const before = state.chatModelCalls;
      const answer = await thread.say(words);
      expect(answer.content).not.toMatch(MAGIC_PHRASE);
      expect(answer.formOpened?.instanceId).toBe(existing);
      expect(answer.content).toMatch(/\*\*Corrective Action Form\*\* for \*\*Sela Brandt\*\* is still a draft/);
      expect(state.chatModelCalls).toBe(before);
      expect(drafts("Sela Brandt")).toHaveLength(1);
    },
  );

  it("asked without a phrase to type: \"is this the same incident as your existing Corrective Action Form for <name>?\"", async () => {
    const existing = await caOnFile("Sela Brandt", { finalized: false });
    const thread = new Thread();
    thread.replay(REQUEST, "Is this the same incident as your existing **Corrective Action Form** for **Sela Brandt**, or a different one?");
    const answer = await thread.say("same incideny");
    expect(answer.formOpened?.instanceId).toBe(existing);
  });

  it('"same incident" about a finalized form opens it as a new draft (Edit as new draft)', async () => {
    const existing = await caOnFile("Sela Brandt", { finalized: true });
    const thread = new Thread();
    thread.replay(REQUEST, ASKED.replace("that one is still a draft, not finalized", "that one is finalized"));
    const answer = await thread.say("same incident");
    expect(answer.formOpened?.revisesInstanceId).toBe(existing);
    expect(answer.content).toMatch(/was finalized, so I opened a new draft of it/);
    expect(row(existing)?.status).toBe("finalized");
  });

  it.each([["on"], ["off"]])('"different incident" starts a new Corrective Action Form, and Create files a new draft (INTENT_EXTRACTION_ENABLED %s)', async (intent) => {
    process.env.INTENT_EXTRACTION_ENABLED = intent;
    const existing = await caOnFile("Sela Brandt", { finalized: false });
    const thread = new Thread();
    thread.replay(REQUEST, ASKED);
    const answer = await thread.say("different incident");
    expect(answer.formOpened).toBeUndefined();
    expect(answer.formProposal?.templateKey).toBe("dpoa");
    expect(answer.formProposal?.employeeName).toBe("Sela Brandt");
    const created = await thread.create();
    expect(created).not.toBe(existing);
    expect(row(existing)?.status).toBe("draft");
    expect(drafts("Sela Brandt")).toHaveLength(2);
  });

  it('"different incident" on the same day is not folded into the open draft for that day', async () => {
    /* The cross-chat guard reopens an open draft for the same person, form and date. */
    const earlier = new Thread();
    await earlier.say("create a corrective action form for Sela Brandt for being on her cell phone on 10-17-26. payroll deduct no");
    const existing = await earlier.create();
    const thread = new Thread();
    thread.replay(`${REQUEST} on 10-17-26`, ASKED);
    const card = await thread.say("different incident");
    expect(card.formProposal?.formDate).toBe("2026-10-17");
    const created = await thread.create();
    expect(created).not.toBe(existing);
    expect(drafts("Sela Brandt")).toHaveLength(2);
  });

  it('"same incident" with no such question asked is left to the ordinary answer', async () => {
    await caOnFile("Sela Brandt", { finalized: false });
    const thread = new Thread();
    thread.replay("how should I handle repeated late openings?", "Start with a conversation about the Late Opening policy.");
    const answer = await thread.say("same incident");
    expect(answer.formOpened).toBeUndefined();
  });

  it("flag off: the turn is answered as before", async () => {
    process.env.DRAFT_ACTIONS_ENABLED = "off";
    await caOnFile("Sela Brandt", { finalized: false });
    const thread = new Thread();
    thread.replay(REQUEST, ASKED);
    const answer = await thread.say("same incideny");
    expect(answer.formOpened).toBeUndefined();
  });
});
