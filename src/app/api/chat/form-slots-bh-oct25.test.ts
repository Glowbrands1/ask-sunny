import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";
import { correctionBothFactsEnabled, futureIncidentDateConfirmEnabled, statedTitleWinsEnabled } from "@/lib/config/chat-quality-flags";
import { withFutureDateQuestion } from "@/lib/ai/future-incident-date";
import { copularJobTitle } from "@/lib/ai/title-words";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * FORM SLOTS FROM THE SIBLING APP'S HISTORY (BH1, BH3, BH5, B16), 21-25 OCT 2026
 * ============================================================================
 *
 * Ported from Ask Bubbles (`api/chat/form-slots-bh-oct25.test.ts`): the same
 * expected behaviour, through this app's live form path — the intent reading
 * (INTENT_EXTRACTION_ENABLED, on in production) feeding the proposal flow.
 * The manager's words are the sibling app's production turns in salon wording,
 * with synthetic names; the card's Create goes through `createInlineForm`, and
 * a turn with the form open carries `activeFormInstanceId` as the browser
 * sends it.
 *
 *   BH1 "create a verbal corrective action for <name>, <title> at <salon> for
 *       violating dress code on 10-20-26": the level stated in the create turn
 *       is the card's, and the manager's stated title is not replaced by the
 *       directory's (STATED_TITLE_WINS_ENABLED for a title off the list).
 *   B16 "…she is an HR assistant…" is the stated title; "send to HR" is none.
 *   BH3 "verbal. payroll deduct is not applicable." with the form open, or on
 *       the card: both facts are applied (CORRECTION_BOTH_FACTS_ENABLED for
 *       the open form; off, the open form takes only the payroll answer, as
 *       on main).
 *   BH5 an incident date in the future (12-20-26 typed on 10-21-26) is asked
 *       about once (FUTURE_INCIDENT_DATE_CONFIRM_ENABLED).
 */

const store = {
  chat_conversations: [],
  chat_messages: [],
  chat_traces: [],
  chat_form_state: [],
  form_instances: [],
  form_instance_values: [],
  form_instance_events: [],
  form_template_versions: [],
  form_templates: [],
  form_template_current: [],
  form_template_assets: [],
} as unknown as FakeStore & Record<string, Record<string, unknown>[]>;

const state = vi.hoisted(() => ({
  /** What the drafting model writes (write_form_fields). */
  draft: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown> },
  /** What the revising model writes (revise_form_fields). */
  revision: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown>; clear?: string[] },
  draftCalls: 0,
  revisionCalls: 0,
  chatModelCalls: 0,
  directory: [] as unknown[],
  /** What the slot model copies from the latest manager turn (record_intent_slots). */
  intent: (() => null) as (manager: string) => Record<string, unknown> | null,
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
      if (!hasPermission(DEFAULT_PERMISSION_MATRIX, "admin" as never, permission as never)) {
        throw new AuthError("forbidden", "Your role does not have permission to do that.");
      }
      return {
        identity: {
          subject: "qa-dm",
          email: "qa-dm@example.test",
          displayName: "QA District Manager",
          role: "admin",
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
  callClaudeTool: async (input: { tool?: { name?: string }; messages?: { content?: unknown }[] }) => {
    if (input.tool?.name !== "record_intent_slots") return null;
    const text = String(input.messages?.[0]?.content ?? "");
    return state.intent(text.split("Manager:").pop()?.trim() ?? "");
  },
}));

vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (request: { tool_choice?: { name?: string } }) => {
        const revising = request.tool_choice?.name === "revise_form_fields";
        if (revising) state.revisionCalls += 1;
        else state.draftCalls += 1;
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
    // The intent read's directory facts: the same people, with the directory's title.
    readDirectoryFacts: async (scope: AccessScope | null) =>
      actual.scopeRoster(state.directory as never, scope).map((person) => ({
        ...person,
        title: (state.directory as { id: string; title: string }[]).find((row) => row.id === person.id)?.title ?? null,
        primaryLocationName: null,
      })),
  };
});

process.env.NEXT_PUBLIC_DEMO_MODE = "false";

const { ensureTemplateLibrary } = await import("@/lib/forms/repository");
const { createInlineForm } = await import("@/features/chat/create-inline-form");
const chatRoute = await import("./route");
const instancesRoute = await import("../forms/instances/route");
const draftRoute = await import("../forms/instances/[id]/draft/route");

let TODAY = "2026-10-21";

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

/**
 * The chat thread as the browser holds it, every turn sent through
 * POST /api/chat as `chat-screen.tsx` sends it.
 */
class Thread {
  readonly messages: ChatMessage[] = [];
  proposal: ChatFormProposal | null = null;
  instanceId: string | null = null;
  private sequence = 0;

  async say(question: string) {
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
    const payload = (await response.json()) as {
      content: string;
      formProposal?: ChatFormProposal;
      formUpdate?: { instanceId: string; updated: string[] };
      error?: string;
    };
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
    if (payload.formProposal) this.proposal = payload.formProposal;
    return payload;
  }

  /** The card's Create draft button. */
  async create() {
    expect(this.proposal, "no card to create from").not.toBeNull();
    const result = await createInlineForm({
      proposal: this.proposal!,
      messages: this.messages,
      call,
      onCreated: () => {},
    });
    this.instanceId = toUuid(result.reference.instanceId);
    return { id: this.instanceId, draftWarning: result.draftWarning, draftNotice: result.draftNotice ?? null };
  }
}

const checked = (id: string, key: string) =>
  (store.form_instance_values ?? []).find((entry) => entry.instance_id === id && entry.field_key === key)?.checked ?? [];
const value = (id: string, key: string) =>
  (store.form_instance_values ?? []).find((entry) => entry.instance_id === id && entry.field_key === key)?.value ?? null;

/* Synthetic people only; the titles are this app's directory titles. */
const DIRECTORY = [
  { id: "e-1", firstName: "Marlo", lastName: "Quist", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], title: "Salon Director" },
  { id: "e-2", firstName: "Sela", lastName: "Brandt", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], title: "Tanning Consultant" },
  { id: "e-3", firstName: "Test", lastName: "Employee", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], title: "Tanning Consultant" },
];

/** What the slot model copies from a manager turn: the person, the salon, the level, the form and the date as typed. */
function slotModel(manager: string): Record<string, unknown> {
  const lower = manager.toLowerCase();
  const person = DIRECTORY.find((row) => lower.includes(`${row.firstName} ${row.lastName}`.toLowerCase()));
  return {
    employee: person ? `${person.firstName} ${person.lastName}`.toLowerCase() : null,
    salon: /\bkearney\b/i.test(manager) ? "kearney" : null,
    title: null,
    incidentType: null,
    incidentDate: /\b\d{1,2}-\d{1,2}-\d{2}\b/.exec(manager)?.[0] ?? null,
    payrollAmount: null,
    warningLevel: /\bverbal\b/i.test(manager) ? "verbal" : /\bwritten\b/i.test(manager) ? "written" : null,
    formType: /\bcoaching form\b/i.test(manager)
      ? "Coaching Form"
      : /\b(?:ca|corrective action)\b/i.test(manager)
        ? "Corrective Action Form"
        : null,
    formTurn: true,
  };
}

const PRODUCTION = ["INTENT_EXTRACTION_ENABLED"] as const;
const TITLE_FLAG = "STATED_TITLE_WINS_ENABLED";
const DATE_FLAG = "FUTURE_INCIDENT_DATE_CONFIRM_ENABLED";
const BOTH_FLAG = "CORRECTION_BOTH_FACTS_ENABLED";
const TOUCHED = [...PRODUCTION, TITLE_FLAG, DATE_FLAG, BOTH_FLAG, "FORM_FULL_REMAP_ENABLED"] as const;
const saved = new Map<string, string | undefined>();

function at(day: string) {
  TODAY = day;
  vi.setSystemTime(new Date(`${day}T15:00:00Z`));
}

class JoiningRows extends Array<Record<string, unknown>> {
  override push(...rows: Record<string, unknown>[]) {
    const count = super.push(...rows);
    joinOverview();
    return count;
  }
}

beforeEach(async () => {
  for (const key of Object.keys(store)) (store as Record<string, unknown[]>)[key] = [];
  store.form_instances = new JoiningRows() as never;
  state.draft = {
    values: {
      observation:
        "Observed:\nOn October 20, 2026, the employee did not meet the expectation.\n\nExpectation:\nFollow the policy.\n\nGoing Forward:\nFollow the policy on every shift.",
    },
    checked: {},
  };
  state.revision = { values: {} };
  state.draftCalls = 0;
  state.revisionCalls = 0;
  state.chatModelCalls = 0;
  state.directory = DIRECTORY;
  state.intent = slotModel;
  for (const name of TOUCHED) saved.set(name, process.env[name]);
  for (const name of TOUCHED) delete process.env[name];
  for (const name of PRODUCTION) process.env[name] = "true";
  vi.useFakeTimers({ toFake: ["Date"] });
  at("2026-10-22");
  await ensureTemplateLibrary("system");
});

afterEach(() => {
  for (const [name, before] of saved) {
    if (before === undefined) delete process.env[name];
    else process.env[name] = before;
  }
  vi.useRealTimers();
});

describe("the new flags", () => {
  it("are off unless set", () => {
    expect(statedTitleWinsEnabled()).toBe(false);
    expect(futureIncidentDateConfirmEnabled()).toBe(false);
    expect(correctionBothFactsEnabled()).toBe(false);
  });
});

/* ========================================================================= */
/* BH1 — the sibling app's conv_mvjyhx8z2ayo9ku, in salon wording            */
/* ========================================================================= */

const BH1 = "create a verbal corrective action for marlo quist, tanning consultant at kearney for violating dress code on 10-20-26";
const LEVEL_ASKED = /Verbal or written\?|\*\*Verbal Warning\*\* or a \*\*Written Warning\*\*\?|set the warning level/;

describe("BH1 on the live path (intent reading): the create turn's level and title", () => {
  it("the card and the created form carry the Verbal Warning and the manager's Tanning Consultant", async () => {
    const thread = new Thread();
    const card = await thread.say(BH1);
    expect(card.formProposal?.warningLevel).toBe("verbal");
    expect(card.content).not.toMatch(LEVEL_ASKED);
    expect(card.formProposal?.employeeRole).toBe("Tanning Consultant");
    const { id } = await thread.create();
    expect(checked(id, "warning_type")).toEqual(["verbal"]);
    expect(value(id, "job_title")).toBe("Tanning Consultant");
  });
});

/* ========================================================================= */
/* B16 — the sibling app's conv_mvnuc09q29llz4p / conv_mvnuc0i32bfvzpw        */
/* ========================================================================= */

/** The sibling app's QA, 25 Oct 2026 (QA test names; Kearney is a salon here too). */
const B16_TITLE = "create a coaching form for Test Employee at Kearney, she is an HR assistant, for being late on 10-20-26";
const B16_HR = "create a coaching form for Test Employee at Kearney for being late on 10-20-26 and send to HR";

describe('B16: "she is an HR assistant" is the stated title; "send to HR" is not one', () => {
  it(`${TITLE_FLAG}: HR Assistant, not the directory's title`, async () => {
    process.env[TITLE_FLAG] = "true";
    const titled = await new Thread().say(B16_TITLE);
    expect(titled.formProposal?.templateKey).toBe("coaching");
    expect(titled.formProposal?.employeeRole).toBe("HR Assistant");
    expect(titled.content).not.toContain("HR Assistant. It happened");
    const hr = await new Thread().say(B16_HR);
    expect(hr.formProposal?.employeeRole ?? null).not.toMatch(/^HR\b/);
  });

  it("flag off: the directory's title, as before", async () => {
    const titled = await new Thread().say(B16_TITLE);
    expect(titled.formProposal?.employeeRole).toBe("Tanning Consultant");
  });

  it("the reader: a title stated as what the employee is, and nothing else", () => {
    expect(copularJobTitle(B16_TITLE)).toBe("HR Assistant");
    expect(copularJobTitle(B16_HR)).toBeNull();
    expect(copularJobTitle("she is a no-show again")).toBeNull();
    expect(copularJobTitle("she is a great worker")).toBeNull();
    expect(copularJobTitle("he's a front desk lead at kearney")).toBe("Front Desk Lead");
  });
});

/* ========================================================================= */
/* BH3 — the sibling app's conv_mvi94k418pzwgmn                              */
/* ========================================================================= */

const BH3_REQUEST = "create ca form for sela brandt for violating attendance on 10-20-26. sela did not call supervisor";
const BH3 = "verbal. payroll deduct is not applicable.";

describe(`BH3: "${BH3}" applies both facts`, () => {
  it(`${BOTH_FLAG}: with the created form open, Type of Warning and payroll deduct`, async () => {
    process.env[BOTH_FLAG] = "true";
    at("2026-10-21");
    const thread = new Thread();
    await thread.say(BH3_REQUEST);
    const { id } = await thread.create();
    const answer = await thread.say(BH3);
    expect(checked(id, "payroll_deduct")).toEqual(["no"]);
    expect(checked(id, "warning_type")).toEqual(["verbal"]);
    expect(answer.content).toMatch(/Is payroll deduct applicable\? → No; Type of Warning → Verbal Warning\./);
  });

  it(`flag off: with the created form open, the payroll answer only, as on main`, async () => {
    at("2026-10-21");
    const thread = new Thread();
    await thread.say(BH3_REQUEST);
    const { id } = await thread.create();
    await thread.say(BH3);
    expect(checked(id, "payroll_deduct")).toEqual(["no"]);
    expect(checked(id, "warning_type")).not.toEqual(["verbal"]);
  });

  it("on the card, before it is created", async () => {
    at("2026-10-21");
    const thread = new Thread();
    await thread.say(BH3_REQUEST);
    const card = await thread.say(BH3);
    expect(card.formProposal?.warningLevel).toBe("verbal");
    expect(card.formProposal?.payrollDeduct).toBe("no");
  });
});

/* ========================================================================= */
/* BH5 — the sibling app's conv_mvikc78w58v710y                              */
/* ========================================================================= */

/** The closing quote is the manager's. */
const BH5 =
  "create a written CA for sela brandt for not attending the monthly meeting on 12-20-26. previous coaching: jba policy manual 5-8-26, verbal ca 10-2-26. payroll deduct not applicable”";
const FUTURE = "That date is in the future — is 12-20-26 right?";

describe(`BH5 (${DATE_FLAG}): an incident date in the future is asked about once`, () => {
  beforeEach(() => {
    at("2026-10-21");
  });

  it("asks once, alone, and keeps the date on the card", async () => {
    process.env[DATE_FLAG] = "true";
    const card = await new Thread().say(BH5);
    expect(card.formProposal?.formDate).toBe("2026-12-20");
    expect(card.content).toBe(FUTURE);
  });

  it.each([["yes"], ["that's right"], ["12-20-26 is right"]])('"%s" keeps 12-20-26 and is not asked again', async (reply) => {
    process.env[DATE_FLAG] = "true";
    const thread = new Thread();
    await thread.say(BH5);
    const answer = await thread.say(reply);
    expect(answer.formProposal?.formDate).toBe("2026-12-20");
    expect(answer.content).not.toContain("in the future");
    expect(answer.formProposal?.payrollDeduct).toBe("no");
    const later = await thread.say("payroll deduct not applicable");
    expect(later.content).not.toContain("in the future");
  });

  // Holds on main's payroll reader; this PR no longer edits payroll-deduct.ts (the bare yes/no binding is #247).
  it('flags off: "yes" after the card is not read as the payroll answer', async () => {
    const thread = new Thread();
    const card = await thread.say(BH5);
    expect(card.formProposal?.payrollDeduct).toBe("no");
    const answer = await thread.say("yes");
    expect(answer.formProposal?.payrollDeduct).toBe("no");
  });

  it("a corrected date is used, and not asked about", async () => {
    process.env[DATE_FLAG] = "true";
    const thread = new Thread();
    await thread.say(BH5);
    const answer = await thread.say("sorry, it was 10-20-26");
    expect(answer.formProposal?.formDate).toBe("2026-10-20");
    expect(answer.content).not.toContain("in the future");
  });

  it("a follow-up date in the future is not the incident date and is not asked about", async () => {
    process.env[DATE_FLAG] = "true";
    const card = await new Thread().say("create a coaching form for sela brandt for being late on 10-20-26, follow up on 11-15-26");
    expect(card.content).not.toContain("in the future");
  });

  it("flag off: the reply and the card are unchanged", async () => {
    const off = await new Thread().say(BH5);
    expect(off.content).not.toContain("in the future");
    const asResponse = { ...off, citations: [], recommendedVideoIds: [] };
    expect(withFutureDateQuestion(asResponse, { today: TODAY, history: [] })).toBe(asResponse);
    process.env[DATE_FLAG] = "true";
    const on = await new Thread().say(BH5);
    expect({ ...on.formProposal, proposalId: null }).toEqual({ ...off.formProposal, proposalId: null });
    expect(on.content).toBe(FUTURE);
  });
});

/* ========================================================================= */
/* Registers: the same manager words typed all lowercase or in sentence case */
/* ========================================================================= */

/**
 * Every manager turn above, typed (1) all lowercase and (2) in sentence case
 * with the names typed lowercase or Capitalized. Names and keywords read the
 * same either way, so every outcome is the one the wording above gets.
 */
type Register = readonly [label: string, type: (text: string, names: readonly string[]) => string];

function sentenceCase(text: string, names: readonly string[], capitalizeNames: boolean): string {
  let out = text.toLowerCase();
  if (capitalizeNames) {
    for (const name of names) {
      out = out.replace(new RegExp(`\\b${name.toLowerCase()}\\b`, "g"), name.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase()));
    }
  }
  return out.replace(/(^|[.!?]\s+)([a-z])/g, (_match, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`);
}

const REGISTERS: readonly Register[] = [
  ["all lowercase", (text) => text.toLowerCase()],
  ["sentence case, names lowercase", (text, names) => sentenceCase(text, names, false)],
  ["sentence case, names Capitalized", (text, names) => sentenceCase(text, names, true)],
];

const BH1_NAMES = ["marlo quist", "kearney"];
const B16_NAMES = ["test employee", "kearney"];
const BH3_NAMES = ["sela brandt", "sela"];
const BH5_NAMES = ["sela brandt"];

describe("registers: BH1", () => {
  it.each(REGISTERS)("%s: the Verbal Warning and the manager's Tanning Consultant", async (_label, type) => {
    const thread = new Thread();
    const card = await thread.say(type(BH1, BH1_NAMES));
    expect(card.formProposal?.warningLevel).toBe("verbal");
    expect(card.content).not.toMatch(LEVEL_ASKED);
    expect(card.formProposal?.employeeRole).toBe("Tanning Consultant");
    const { id } = await thread.create();
    expect(checked(id, "warning_type")).toEqual(["verbal"]);
    expect(value(id, "job_title")).toBe("Tanning Consultant");
  });
});

describe("registers: B16", () => {
  it.each(REGISTERS)(`%s: ${TITLE_FLAG}: HR Assistant, not the directory's title`, async (_label, type) => {
    process.env[TITLE_FLAG] = "true";
    const titled = await new Thread().say(type(B16_TITLE, B16_NAMES));
    expect(titled.formProposal?.templateKey).toBe("coaching");
    expect(titled.formProposal?.employeeRole).toBe("HR Assistant");
    expect(titled.content).not.toMatch(/HR Assistant\. It happened/i);
    const hr = await new Thread().say(type(B16_HR, B16_NAMES));
    expect(hr.formProposal?.employeeRole ?? null).not.toMatch(/^HR\b/i);
  });

  it.each(REGISTERS)("%s: flag off: the directory's title, as before", async (_label, type) => {
    const titled = await new Thread().say(type(B16_TITLE, B16_NAMES));
    expect(titled.formProposal?.employeeRole).toBe("Tanning Consultant");
  });

  it.each(REGISTERS)("%s: the reader", (_label, type) => {
    expect(copularJobTitle(type(B16_TITLE, B16_NAMES))).toBe("HR Assistant");
    expect(copularJobTitle(type(B16_HR, B16_NAMES))).toBeNull();
    expect(copularJobTitle(type("she is a no-show again", []))).toBeNull();
    expect(copularJobTitle(type("she is a great worker", []))).toBeNull();
    expect(copularJobTitle(type("he's a front desk lead at kearney", ["kearney"]))).toBe("Front Desk Lead");
  });
});

describe("registers: BH3", () => {
  it.each(REGISTERS)(`%s: ${BOTH_FLAG}: with the created form open, both facts`, async (_label, type) => {
    process.env[BOTH_FLAG] = "true";
    at("2026-10-21");
    const thread = new Thread();
    await thread.say(type(BH3_REQUEST, BH3_NAMES));
    const { id } = await thread.create();
    const answer = await thread.say(type(BH3, []));
    expect(checked(id, "payroll_deduct")).toEqual(["no"]);
    expect(checked(id, "warning_type")).toEqual(["verbal"]);
    expect(answer.content).toMatch(/Is payroll deduct applicable\? → No; Type of Warning → Verbal Warning\./);
  });

  it.each(REGISTERS)("%s: on the card, both facts", async (_label, type) => {
    at("2026-10-21");
    const thread = new Thread();
    await thread.say(type(BH3_REQUEST, BH3_NAMES));
    const card = await thread.say(type(BH3, []));
    expect(card.formProposal?.warningLevel).toBe("verbal");
    expect(card.formProposal?.payrollDeduct).toBe("no");
  });
});

describe(`registers: BH5 (${DATE_FLAG})`, () => {
  beforeEach(() => {
    at("2026-10-21");
  });

  it.each(REGISTERS)("%s: asks once, alone, and keeps the date on the card", async (_label, type) => {
    process.env[DATE_FLAG] = "true";
    const card = await new Thread().say(type(BH5, BH5_NAMES));
    expect(card.formProposal?.formDate).toBe("2026-12-20");
    expect(card.content).toBe(FUTURE);
  });

  it.each(REGISTERS)('%s: "that\'s right" keeps 12-20-26 and is not asked again', async (_label, type) => {
    process.env[DATE_FLAG] = "true";
    const thread = new Thread();
    await thread.say(type(BH5, BH5_NAMES));
    const answer = await thread.say(type("that's right", []));
    expect(answer.formProposal?.formDate).toBe("2026-12-20");
    expect(answer.content).not.toContain("in the future");
    expect(answer.formProposal?.payrollDeduct).toBe("no");
    const later = await thread.say(type("payroll deduct not applicable", []));
    expect(later.content).not.toContain("in the future");
  });

  it.each(REGISTERS)("%s: a corrected date is used, and not asked about", async (_label, type) => {
    process.env[DATE_FLAG] = "true";
    const thread = new Thread();
    await thread.say(type(BH5, BH5_NAMES));
    const answer = await thread.say(type("sorry, it was 10-20-26", []));
    expect(answer.formProposal?.formDate).toBe("2026-10-20");
    expect(answer.content).not.toContain("in the future");
  });

  it.each(REGISTERS)("%s: a future follow-up date is not asked about", async (_label, type) => {
    process.env[DATE_FLAG] = "true";
    const card = await new Thread().say(type("create a coaching form for sela brandt for being late on 10-20-26, follow up on 11-15-26", BH5_NAMES));
    expect(card.content).not.toContain("in the future");
  });

  it.each(REGISTERS)('%s: flags off: "yes" after the card is not the payroll answer', async (_label, type) => {
    const thread = new Thread();
    const card = await thread.say(type(BH5, BH5_NAMES));
    expect(card.formProposal?.payrollDeduct).toBe("no");
    const answer = await thread.say(type("yes", []));
    expect(answer.formProposal?.payrollDeduct).toBe("no");
  });
});
