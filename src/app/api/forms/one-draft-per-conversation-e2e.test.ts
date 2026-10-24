import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * ONE DRAFT PER FORM IN A CONVERSATION — MEETING M5 / QA F7, 24 OCT 2026
 * ============================================================================
 *
 * "15 drafts for one." In production one manager had 8 Corrective Action
 * drafts for one employee from 20 to 21 Oct. Two of the chats, replayed here
 * with synthetic people, through the real proposal flow, `createInlineForm`
 * and the real create route, pressing Create on the same turns the managers
 * pressed it:
 *
 *   conv_mvh1ho2p2xddypx: "create a corrective action form for …", "Please
 *   create another corrective action from … This would be a verbal due to
 *   not completing her woven courses by the deadline", "Payroll is not
 *   deducted", "I need it to be a corrective action form" — three drafts.
 *
 *   conv_mvh63o452l199bw: the request, the name, a new observation, the same
 *   long request sent twice, then the name again — two drafts, the second
 *   dated from the onboarding date in the new observation.
 *
 * With CONVERSATION_DRAFT_REUSE_ENABLED on, a card for a form this chat
 * already drafted for the same employee opens that draft; only an "another"
 * said since that draft makes a second one.
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
  draft: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown> },
  manual: null as null | { chunks: unknown[] },
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
        content: [{ type: "tool_use", name: "write_form_fields", input: state.draft }],
      }),
    },
  }),
}));

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    async search() {
      return [];
    }
    async fetchRoleGrounding() {
      return { ok: false, reason: "not used" };
    }
    async fetchOfficialPolicyManual() {
      if (!state.manual) return { ok: false, reason: "The official policy manual is not in the knowledge base." };
      return {
        ok: true,
        documentId: "doc-manual",
        documentTitle: "JBA Policy Manual",
        documentCategory: "policies_compliance",
        matchedBy: "fallback",
        chunks: state.manual.chunks,
      };
    }
  },
}));

vi.mock("@/lib/knowledge", () => ({
  getKnowledgeProvider: () => {
    throw new Error("getKnowledgeProvider() is the browser knowledge client and must not be used on the server");
  },
}));

vi.mock("@/lib/forms/employee-roster", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/forms/employee-roster")>();
  return {
    ...actual,
    loadScopedRoster: async (scope: AccessScope | null) => actual.scopeRoster(state.directory as never, scope),
  };
});

process.env.NEXT_PUBLIC_DEMO_MODE = "false";

const { ensureTemplateLibrary, listTemplateSummaries } = await import("@/lib/forms/repository");
const { proposeFormForTurn } = await import("@/lib/ai/form-proposal");
const { createInlineForm } = await import("@/features/chat/create-inline-form");
const instancesRoute = await import("./instances/route");
const draftRoute = await import("./instances/[id]/draft/route");

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

let sequence = 0;

/**
 * The chat as the manager ran it. `press` lists the turns (0-based) whose card
 * the manager pressed Create on. Each press sends the conversation as the
 * browser holds it, and the card then shows the form it opened.
 */
async function chat(turns: readonly string[], press: readonly number[]) {
  const messages: ChatMessage[] = [];
  const opened: { turn: number; instanceId: string; reused: boolean }[] = [];
  let open: string | undefined;
  for (const [index, text] of turns.entries()) {
    const message: ChatMessage = {
      id: `m${(sequence += 1)}`,
      role: "user",
      content: text,
      createdAt: "2026-10-20T18:50:00Z",
    };
    const response = await proposeFormForTurn({
      history: messages,
      question: message.content,
      questionMessageId: message.id,
      actor: { role: state.role as never, scope: state.scope as AccessScope },
      summaries: await listTemplateSummaries(),
      today: "2026-10-20",
      policyManual: async () => (state.manual?.chunks as never) ?? null,
      ...(open ? { continueTemplateKey: open } : {}),
    });
    if (response?.formProposal) open = response.formProposal.templateKey;
    const answer = {
      id: `a${sequence}`,
      role: "assistant",
      content: response?.content ?? "Noted.",
      createdAt: "2026-10-20T18:50:01Z",
      ...(response?.formProposal ? { formProposal: response.formProposal } : {}),
    } as ChatMessage;
    messages.push(message, answer);
    if (!press.includes(index)) continue;
    expect(response?.formProposal, `no card to press on turn ${index}: ${text}`).toBeDefined();
    const result = await createInlineForm({ proposal: response!.formProposal!, messages, call, onCreated: () => {} });
    (answer as { formInstanceRef?: unknown }).formInstanceRef = result.reference;
    opened.push({ turn: index, instanceId: result.reference.instanceId, reused: Boolean(result.reused) });
  }
  return { opened, drafts: () => (store.form_instances ?? []).filter((row) => row.status === "draft") };
}

const DIRECTORY = [
  { id: "e-1", firstName: "Remy", lastName: "Calder", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0310"] },
  { id: "e-2", firstName: "Tess", lastName: "Varga", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0310"] },
];

const MANUAL = {
  chunks: [
    {
      chunkIndex: 30,
      page: 13,
      printedPage: 12,
      sections: [{ heading: "Standards of Conduct", page: 12 }],
      section: "Standards of Conduct",
      content:
        "12 | P a g e\nStandards of Conduct\nThe Company expects Employees to follow rules of conduct that will protect the interests and\nsafety of all clients, Employees, and The Company.\no Failure to complete assigned work or required tasks by the deadline",
    },
  ],
};

/* conv_mvh1ho2p2xddypx, 20 Oct 2026, synthetic name. */
const ANOTHER_THEN_SAME = [
  "write a CA for Tess Varga",
  "create a corrective action form for Tess Varga",
  "Please create another corrective action from Tess Varga. This would be a verbal due to not completing her woven courses by the deadline",
  "Payroll is not deducted",
  "I need it to be a corrective action form",
];

/* conv_mvh63o452l199bw, 20 Oct 2026, synthetic names. */
const LONG_REQUEST =
  "create ca for remy calder, salon director. the offense is: change observation of offense to: Remy completed onboarding with new hire Nova Quill on 9-28-26. As of 10-16-26 Nova had not acknowledged onboarding policies in Woven that should have been completed during onboarding. the policy violated is standards of conduct.";
const SENT_TWICE = [
  "create a CA for salon director, remy calder for violating the standards of conduct",
  "Remy Calder, Salon Director",
  "change observation of offense to: Remy completed onboarding with new hire Nova Quill on 9-28-26. As of 10-16-26 Nova had not acknowledged onboarding policies in Woven that should have been completed during onboarding.",
  "create the ca",
  LONG_REQUEST,
  LONG_REQUEST,
  "remy",
];

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  state.role = "salon_director";
  state.scope = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: [] };
  state.draft = { values: {}, checked: {} };
  state.manual = MANUAL;
  state.directory = DIRECTORY;
  sequence = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T18:50:00Z"));
  await ensureTemplateLibrary("system");
});

afterEach(() => {
  delete process.env.CONVERSATION_DRAFT_REUSE_ENABLED;
  vi.useRealTimers();
});

describe("one draft per form in a conversation (flag on)", () => {
  beforeEach(() => {
    process.env.CONVERSATION_DRAFT_REUSE_ENABLED = "on";
  });

  it('"I need it to be a corrective action form" opens the draft "another" made, not a third', async () => {
    const { opened, drafts } = await chat(ANOTHER_THEN_SAME, [1, 2, 4]);
    expect(drafts()).toHaveLength(2);
    // "another" was asked for in words, so the second press is a new draft.
    expect(opened[1]!.instanceId).not.toBe(opened[0]!.instanceId);
    expect(opened[1]!.reused).toBe(false);
    // The third press opens the second draft.
    expect(opened[2]!.instanceId).toBe(opened[1]!.instanceId);
    expect(opened[2]!.reused).toBe(true);
  });

  it("the same long request sent twice, then the name, opens the draft this chat already made", async () => {
    const { opened, drafts } = await chat(SENT_TWICE, [1, 6]);
    expect(drafts()).toHaveLength(1);
    expect(opened[1]!.instanceId).toBe(opened[0]!.instanceId);
    expect(opened[1]!.reused).toBe(true);
  });

  it('"also create a CA for her for dress code on 10-22" in the same chat makes a second draft (QA, 24 Oct 2026)', async () => {
    const { opened, drafts } = await chat(
      [
        "create a corrective action form for Tess Varga for missing the 10-15-26 woven deadline",
        "also create a CA for her for dress code on 10-22",
      ],
      [0, 1],
    );
    expect(drafts()).toHaveLength(2);
    expect(opened[1]!.instanceId).not.toBe(opened[0]!.instanceId);
    expect(opened[1]!.reused).toBe(false);
  });

  it("a card for another employee in the same chat is its own draft", async () => {
    const { opened, drafts } = await chat(
      ["create a corrective action form for Tess Varga", "create a corrective action form for Remy Calder"],
      [0, 1],
    );
    expect(drafts()).toHaveLength(2);
    expect(opened[1]!.instanceId).not.toBe(opened[0]!.instanceId);
  });

  it("a new chat about the same person is not this chat's draft", async () => {
    await chat(["create a corrective action form for Tess Varga"], [0]);
    const second = await chat(
      ["create a corrective action form for Tess Varga for missing the 10-15-26 woven deadline"],
      [0],
    );
    expect(second.opened[0]!.reused).toBe(false);
    expect(second.drafts()).toHaveLength(2);
  });
});

describe("flag off: unchanged", () => {
  it("the production chats still file a draft per pressed card", async () => {
    expect((await chat(ANOTHER_THEN_SAME, [1, 2, 4])).drafts()).toHaveLength(3);
    for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
    await ensureTemplateLibrary("system");
    expect((await chat(SENT_TWICE, [1, 6])).drafts()).toHaveLength(2);
  });
});
