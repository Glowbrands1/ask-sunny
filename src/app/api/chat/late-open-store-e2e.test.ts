import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { continuationFor } from "@/lib/forms/proposal-continuation";
import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CHUNKS, JBA_MANUAL_DOCUMENT } from "@/lib/ai/__fixtures__/jba-policy-manual";
import type { ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * "OPENING SALON LATE" NAMES THE LATE OPENING POLICY (port of the sibling's B1)
 * ============================================================================
 *
 * The sibling app's QA B1 (conv_mvifqra017j15ld8) in this app's words: "create
 * verbal ca for Test Employee for opening salon late on 10-1-26. …". The
 * policy reader named Late Opening for "opening late" and "opened late" but
 * not with the place between ("opening salon late", "opened the salon late"),
 * so on the proposal flow without intent extraction the card had no Policy
 * line. Production's intent path already states Late Opening; it is checked
 * too. Every turn goes through POST /api/chat; LATE_OPEN_DATE_ENABLED is the
 * flag.
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
  /** The intent model's reading for the turn being asked. Production's readings were not recorded. */
  raw: {} as Record<string, unknown>,
  draft: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown> },
  revision: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown>; clear?: string[] },
  forms: new Map<string, unknown>(),
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
  callClaude: async () => "A grounded answer.",
  callClaudeTool: async (input: { tool?: { name?: string } }) => {
    if (input.tool?.name === "choose_salon_data") return { read: "none" };
    if (input.tool?.name !== "record_intent_slots") return null;
    return {
      employee: null,
      salon: null,
      title: null,
      incidentType: null,
      incidentDate: null,
      payrollAmount: null,
      warningLevel: null,
      formType: null,
      formTurn: true,
      policyHeading: null,
      ...state.raw,
    };
  },
}));

vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (request: { tool_choice?: { name?: string } }) => {
        const revising = request.tool_choice?.name === "revise_form_fields";
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

vi.mock("@/lib/ai/form-state-store", () => ({
  loadFormState: async (userId: string, conversationId: string) => state.forms.get(`${userId}:${conversationId}`) ?? null,
  saveFormState: async (userId: string, conversationId: string, saved: unknown) => {
    state.forms.set(`${userId}:${conversationId}`, saved);
  },
}));

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    async search() {
      return [];
    }
    async match() {
      return [];
    }
    async fetchRoleGrounding() {
      return { ok: false, failure: { code: "missing", detail: "not used", missingGroups: [] } };
    }
    async fetchOfficialPolicyManual() {
      return {
        ok: true,
        documentId: JBA_MANUAL_DOCUMENT.id,
        documentTitle: JBA_MANUAL_DOCUMENT.title,
        documentCategory: "policies_compliance",
        matchedBy: "tag",
        chunks: JBA_MANUAL_CHUNKS,
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
vi.mock("@/lib/reviews/overview-block-read", () => ({
  loadReviewsOverviewBlock: async () => ({ status: "ready", totalReviews: 0, averageRating: 0, salonCount: 0 }),
}));
vi.mock("@/lib/forms/employee-roster", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/forms/employee-roster")>();
  return {
    ...actual,
    readDirectoryFacts: async () => [],
    loadScopedRoster: async () => [],
    withRosterLimit: (_ids: readonly string[] | null, run: () => unknown) => run(),
  };
});
vi.mock("@/lib/forms/prior-forms", () => ({
  priorFormsReadingForChat: async () => ({ attach: [], possible: [], identity: "none" }),
}));

process.env.NEXT_PUBLIC_DEMO_MODE = "false";

/* Each case loads the template library and runs several routes; a shared machine needs more than 5s. */
vi.setConfig({ hookTimeout: 30_000, testTimeout: 60_000 });

const { ensureTemplateLibrary } = await import("@/lib/forms/repository");
const chatRoute = await import("./route");

/** Production's profile on 25 Oct 2026: intent extraction on, the full remap off. */
const PROD_FLAGS = [
  "INTENT_EXTRACTION_ENABLED",
  "QUERY_REWRITE_ENABLED",
  "GROUNDED_ENTITIES_ENABLED",
  "TYPED_NAME_PROCEEDS_ENABLED",
  "FEWSHOT_EXAMPLES_ENABLED",
  "SLOT_RETENTION_ENABLED",
  "FIELD_ACCURACY_ENABLED",
  "LONG_CONTEXT_ENABLED",
  "POLICY_CITATION_ENABLED",
  "SECOND_FORM_ENABLED",
  "GLOBAL_SALON_ASK_ENABLED",
  "DRAFT_MERGE_ENABLED",
] as const;
const FLAG = "LATE_OPEN_DATE_ENABLED";

/** The drafting model's fields for the earlier form on file (S21). */
const LATE_OPENING_MODEL = {
  values: {
    observation:
      "Observed:\nTest was scheduled to open at 8:30am on October 17, 2026 and did not arrive until 11:06, so the salon opened late.\n\nExpectation:\nAn employee assigned to open is expected to open on time.\n\nGoing Forward:\nTest should arrive in time to open.",
  },
  checked: { offense_type: ["tardiness"] },
};
const TODAY = "2026-10-25";

const saved = new Map<string, string | undefined>();

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

class JoiningRows extends Array<Record<string, unknown>> {
  override push(...rows: Record<string, unknown>[]) {
    const count = super.push(...rows);
    joinOverview();
    return count;
  }
}

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  store.form_instances = new JoiningRows() as never;
  for (const name of [...PROD_FLAGS, FLAG, "FORM_FULL_REMAP_ENABLED"]) saved.set(name, process.env[name]);
  for (const name of PROD_FLAGS) process.env[name] = "true";
  process.env[FLAG] = "true";
  state.role = "district_manager";
  state.raw = {};
  state.draft = LATE_OPENING_MODEL;
  state.revision = { values: {} };
  state.forms.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T15:00:00Z`));
  await ensureTemplateLibrary("system");
});

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.useRealTimers();
});

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

let threads = 0;

/** The thread as the browser holds it: history, the card's continuation, and the open form. */
class Thread {
  readonly messages: ChatMessage[] = [];
  readonly conversationId = `conv_${Date.now().toString(36)}${(threads += 1).toString(36).padStart(4, "0")}`;
  instanceId: string | null = null;
  private sequence = 0;

  async say(question: string, raw: Record<string, unknown> = {}): Promise<Answer> {
    state.raw = raw;
    const history = this.messages.map(({ id, role, content, formProposal }) => ({
      id,
      role,
      content,
      ...(formProposal ? { formProposal } : {}),
    }));
    const continuation = this.instanceId ? null : continuationFor(this.messages);
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
          conversationId: this.conversationId,
          ...(continuation ? { continueProposalTemplateKey: continuation.templateKey } : {}),
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
    if (payload.formOpened) {
      payload.formOpened.instanceId = toUuid(payload.formOpened.instanceId);
      this.instanceId = payload.formOpened.instanceId;
    }
    return payload;
  }

  get proposal(): ChatFormProposal | null {
    for (let index = this.messages.length - 1; index >= 0; index -= 1) {
      const proposal = this.messages[index]!.formProposal;
      if (proposal) return proposal;
    }
    return null;
  }

}

/** The value of one "**Label:** …" line in the reply, or null. */
function line(content: string, label: string): string | null {
  const found = content.split("\n").find((entry) => entry.trim().startsWith(`**${label}:**`));
  return found ? found.trim().slice(`**${label}:**`.length).trim() : null;
}




const B1 =
  "create verbal ca for Test Employee for opening salon late on 10-1-26. previous coaching is jba policy manual 1-1-26. payroll deduct DOES apply and state $25 will be payroll deducted";
const READING = { employee: "Test Employee", formType: "Corrective Action Form" };
const policy = (answer: Answer) => line(answer.content, "Policy") ?? "";

describe("B1 in this app's words: a late opening with the salon named is Late Opening", () => {
  it.each([[B1], ["create verbal ca for Test Employee, she opened the salon late on 10-1-26. payroll deduct no"]])(
    "proposal flow (intent extraction off): %s",
    async (words) => {
      delete process.env.INTENT_EXTRACTION_ENABLED;
      const answer = await new Thread().say(words, READING);
      expect(answer.formProposal?.templateKey).toBe("dpoa");
      expect(policy(answer)).toMatch(/^Late Opening\b/);
    },
  );

  it("production's intent path still names Late Opening", async () => {
    const answer = await new Thread().say(B1, READING);
    expect(policy(answer)).toMatch(/^Late Opening\b/);
  });

  it("flag off: the proposal flow names no policy, as before", async () => {
    delete process.env.INTENT_EXTRACTION_ENABLED;
    delete process.env[FLAG];
    const answer = await new Thread().say(B1, READING);
    expect(policy(answer)).not.toMatch(/^Late Opening\b/);
  });
});
