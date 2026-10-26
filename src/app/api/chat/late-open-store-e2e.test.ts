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
  /** The Performance Management Framework is served only while a draft is created, so the governed draft runs. */
  framework: false,
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
      if (!state.framework) return { ok: false, failure: { code: "missing", detail: "not used", missingGroups: [] } };
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
vi.mock("@/lib/forms/prior-forms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/forms/prior-forms")>()),
  priorFormsReadingForChat: async () => ({ attach: [], possible: [], identity: "none" }),
}));

process.env.NEXT_PUBLIC_DEMO_MODE = "false";

/* Each case loads the template library and runs several routes; a shared machine needs more than 5s. */
vi.setConfig({ hookTimeout: 30_000, testTimeout: 60_000 });

const { ensureTemplateLibrary } = await import("@/lib/forms/repository");
const { createInlineForm } = await import("@/features/chat/create-inline-form");
const chatRoute = await import("./route");
const instancesRoute = await import("../forms/instances/route");
const draftRoute = await import("../forms/instances/[id]/draft/route");

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
/** This PR's flag (default off). The new reading needs it and LATE_OPEN_DATE_ENABLED. */
const PLACE = "LATE_OPEN_PLACE_ENABLED";

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
  for (const name of [...PROD_FLAGS, FLAG, PLACE, "FORM_FULL_REMAP_ENABLED"]) saved.set(name, process.env[name]);
  for (const name of PROD_FLAGS) process.env[name] = "true";
  process.env[FLAG] = "true";
  process.env[PLACE] = "true";
  state.role = "district_manager";
  state.raw = {};
  state.draft = LATE_OPENING_MODEL;
  state.revision = { values: {} };
  state.forms.clear();
  state.framework = false;
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

/** Create draft, as the browser calls it: POST /api/forms/instances, then the draft route. */
async function call<T>(url: string, init?: RequestInit): Promise<T> {
  joinOverview();
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

/*
 * The draft guard reads `employee_name` with `ilike`, which the shared fake
 * does not model. Modelled here only, on `form_instances` only, as
 * case-insensitive equality (as `draft-reuse-same-chat-e2e.test.ts` does).
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

type Answer = {
  content: string;
  citations?: { excerpt: string; locator: string }[];
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

  /** Create draft on the latest card; the form's stored fields. */
  async createDraft(): Promise<Map<string, { value: string | null; checked: string[] }>> {
    const proposal = this.proposal;
    expect(proposal, "no card to create from").not.toBeNull();
    state.framework = true;
    const result = await createInlineForm({ proposal: proposal!, messages: this.messages, call, onCreated: () => {} }).finally(
      () => {
        state.framework = false;
      },
    );
    expect(result.draftWarning ?? null, "the draft ran").toBeNull();
    const id = result.reference.instanceId;
    const fields = new Map<string, { value: string | null; checked: string[] }>();
    for (const row of store.form_instance_values ?? []) {
      if (row.instance_id !== id) continue;
      fields.set(String(row.field_key), {
        value: (row.value as string | null) ?? null,
        checked: (row.checked as string[] | null) ?? [],
      });
    }
    return fields;
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
  /*
   * PRODUCTION AS IT IS: LATE_OPEN_DATE_ENABLED on, LATE_OPEN_PLACE_ENABLED
   * off. The card, its sources and the created draft are origin/main's.
   */
  it.each([["proposal flow"], ["intent path"]])(
    "LATE_OPEN_PLACE off, LATE_OPEN_DATE on: B1 reads as on main (%s)",
    async (path) => {
      delete process.env[PLACE];
      if (path === "proposal flow") delete process.env.INTENT_EXTRACTION_ENABLED;
      const thread = new Thread();
      const answer = await thread.say(B1, READING);
      if (path === "proposal flow") {
        expect(line(answer.content, "Policy")).toBeNull();
        expect(answer.content).toMatch(/Late Opening Policy, JBA Policy Manual p\.15/);
      } else {
        expect(policy(answer)).toMatch(/^Late Opening, as you said\b/);
      }
      expect((answer.citations ?? []).map((item) => item.locator)).toEqual(["Page 15"]);
      const fields = await thread.createDraft();
      expect(fields.get("policy_violated")?.value).toBe("Tardiness/Leaving Early — Late Opening");
    },
  );
});

/*
 * ============================================================================
 * QA-6 ON PR #223
 * ============================================================================
 *
 * Every sentence lowercase, in Sentence case and in ALL CAPS, flag on, through
 * POST /api/chat on both of this app's card paths: the proposal flow (intent
 * extraction off), where this PR's reading shows, and production's intent
 * path. The paths that cite are the card's sources and, after Create draft,
 * the form's Policy Violated and Direct policy fields.
 */
const variants = (sentence: string) => [
  sentence.toLowerCase(),
  sentence.charAt(0).toUpperCase() + sentence.slice(1),
  sentence.toUpperCase(),
];
const PATHS = [["proposal flow"], ["intent path"]] as const;
const request = (sentence: string) => `create verbal ca for Test Employee on 10-1-26. ${sentence}. payroll deduct no`;

async function onPath(path: string, words: string) {
  if (path === "proposal flow") delete process.env.INTENT_EXTRACTION_ENABLED;
  const thread = new Thread();
  const answer = await thread.say(words, READING);
  expect(answer.formProposal?.templateKey, answer.content).toBe("dpoa");
  return { thread, answer };
}

/** The manual sections the card cites: its citations and the "<Policy>, JBA Policy Manual p.N" lines in the reply. */
function citedOnCard(answer: Answer): string[] {
  const fromCitations = (answer.citations ?? []).map(
    (item) => `${item.excerpt.split(".")[0]!.trim()} p.${/Page (\d+)/.exec(item.locator)?.[1] ?? "?"}`,
  );
  const fromReply = [...answer.content.matchAll(/([A-Z][A-Za-z/ ]+?) Policy, JBA Policy Manual p\.(\d+)/g)].map(
    (match) => `${match[1]!.trim()} p.${match[2]}`,
  );
  return [...new Set([...fromCitations, ...fromReply])];
}

/** The sections the draft's Direct policy quotes: its "Source: JBA Policy Manual — <Section>, p. N" lines. */
function citedOnForm(fields: Map<string, { value: string | null }>): string[] {
  const language = fields.get("policy_language")?.value ?? "";
  return [...language.matchAll(/Source: JBA Policy Manual — (.+?), p\. (\d+)/g)].map((match) => `${match[1]} p.${match[2]}`);
}

describe("QA-6: a late opening cites Late Opening p.15 ONLY", () => {
  const LATE = [
    ...variants("opening salon late"),
    ...variants("she opened the salon late"),
    ...variants("she opened the location late"),
  ];

  it.each(PATHS.flatMap(([path]) => LATE.map((sentence) => [path, sentence])))("%s: %s", async (path, sentence) => {
    const { thread, answer } = await onPath(path, request(sentence));
    expect(policy(answer)).toMatch(/^Late Opening\b/);
    expect(citedOnCard(answer)).toEqual(["Late Opening p.15"]);
    const fields = await thread.createDraft();
    expect(fields.get("policy_violated")?.value).toBe("Tardiness/Leaving Early — Late Opening");
    expect(citedOnForm(fields)).toEqual(["Late Opening p.15"]);
  });

  it.each(PATHS)("%s: B1 in this app's words", async (path) => {
    const { thread, answer } = await onPath(path, B1);
    expect(citedOnCard(answer)).toEqual(["Late Opening p.15"]);
    expect(citedOnForm(await thread.createDraft())).toEqual(["Late Opening p.15"]);
  });
});

describe("QA-6: a late-for-shift account is not a late opening", () => {
  it.each(
    PATHS.flatMap(([path]) =>
      [...variants("late for shift at the salon"), ...variants("she was late for her shift at the salon")].map(
        (sentence) => [path, sentence],
      ),
    ),
  )("%s: %s", async (path, sentence) => {
    const { thread, answer } = await onPath(path, request(sentence));
    expect(policy(answer)).not.toMatch(/Late Opening/);
    expect(citedOnCard(answer)).toEqual(["Attendance p.14"]);
    const fields = await thread.createDraft();
    expect(fields.get("policy_violated")?.value).toBe("Tardiness/Leaving Early");
    expect(citedOnForm(fields)).toEqual(["Attendance p.14"]);
  });
});

/*
 * THE FALSE POSITIVES. PR #223 as first written named Late Opening on the
 * proposal flow for both ("**Policy:** Late Opening, as you said"). They now
 * read as origin/main reads them, on both paths, byte for byte:
 *
 *   proposal flow — no Policy line; the card cites what the account
 *   describes, as on main;
 *   intent path — unchanged by this PR. Main's intent path already writes
 *   "Late Opening, as you said" for both, from main's own late-opening
 *   reading of the account (not this PR's pattern); pinned so this PR's
 *   change stays where it is. Changing that is a separate fix.
 */
describe("QA-6: an approved late opening, and a late opening with an early leave, are not this PR's Late Opening", () => {
  const MAIN_ON_PROPOSAL_FLOW: Record<string, string[]> = {
    "opening the salon late was approved by the manager": ["Late Opening p.15"],
    "she opened the location late and also left early": ["Late Opening p.15", "Attendance p.14"],
  };

  it.each(Object.keys(MAIN_ON_PROPOSAL_FLOW).flatMap((sentence) => variants(sentence)))(
    "proposal flow: %s",
    async (sentence) => {
      const { answer } = await onPath("proposal flow", request(sentence));
      expect(line(answer.content, "Policy")).toBeNull();
      expect(citedOnCard(answer)).toEqual(MAIN_ON_PROPOSAL_FLOW[sentence.toLowerCase()]);
    },
  );

  it.each(Object.keys(MAIN_ON_PROPOSAL_FLOW).flatMap((sentence) => variants(sentence)))(
    "intent path, as on main: %s",
    async (sentence) => {
      const { answer } = await onPath("intent path", request(sentence));
      expect(policy(answer)).toMatch(/^Late Opening, as you said\b/);
      expect(citedOnCard(answer)).toEqual(MAIN_ON_PROPOSAL_FLOW[sentence.toLowerCase()]);
    },
  );
});
