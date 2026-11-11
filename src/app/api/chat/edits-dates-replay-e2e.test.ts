import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { continuationFor } from "@/lib/forms/proposal-continuation";
import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CHUNKS, JBA_MANUAL_DOCUMENT } from "@/lib/ai/__fixtures__/jba-policy-manual";
import type { ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * HISTORY REPLAY ON PROD 20120d7 — EDITS APPENDED, A POLICY SWAP INVERTED, AND
 * PRIOR DATES ON THE FORM DATE AND FOLLOW-UP (QA, 25 Oct 2026)
 * ============================================================================
 *
 * The manager's own words from the replayed conversations (Sunny prod history,
 * read-only), every turn through POST /api/chat with production's flag profile:
 * intent extraction on and the full remap off. Names are synthetic.
 *
 *   S12 conv_mvnt2v9t245c4le  "can you clean up my grammar …" was appended to
 *                             Observation of Offense.
 *   S21 conv_mvnt79t822zud9j  "can you edit the form I already finalized for
 *                             Test Employee? change the date to 10-20-26" became
 *                             the Observation of a new card.
 *   S22 conv_mvnszqiq28bgs9z  "change observation of offense to: …" was appended
 *                             after the request, not put in its place.
 *   G12 conv_mvnt4qoo226yi34  "change salon location to omaha center" was
 *                             appended and the salon stayed NE Kearney.
 *   (d) conv_mvnt5u7l2b5u91t  "reference the late opening policy INSTEAD of the
 *                             attendance policy" → "Policy: Attendance, as you said".
 *   Q7  conv_mvntbka92uzz9zc  "… late to open on 10-20, she was coached on 9-15"
 *                             dated the form 9/15.
 *   H8  conv_mvnt5ds52v5vyfe  "today" typed; the form was dated 6/25, a prior
 *                             verbal warning's date.
 *   B-list                    a prior action's date printed as "Follow-up:".
 *   B15 (Ask Bubbles conv_mvnu46n823v1unt, salon for store)  "… she opened the
 *                             salon late today" left the Date blank.
 *   B17 (Ask Bubbles conv_mvnuh50i2hanl53)  "add that she was also on her phone"
 *                             was dropped: an explicit add appends, in the
 *                             manager's words, and the reply says so.
 *
 * FORM_EDIT_DATE_RULES_ENABLED (default off) is the fix. Each case runs with it
 * on; the flag-off runs pin what production does today.
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
const { createInlineForm } = await import("@/features/chat/create-inline-form");
const chatRoute = await import("./route");
const instancesRoute = await import("../forms/instances/route");
const instanceRoute = await import("../forms/instances/[id]/route");
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
const FLAG = "FORM_EDIT_DATE_RULES_ENABLED";

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

  async create() {
    expect(this.proposal, "no card to create from").not.toBeNull();
    const result = await createInlineForm({ proposal: this.proposal!, messages: this.messages, call, onCreated: () => {} });
    this.instanceId = toUuid(result.reference.instanceId);
    return this.instanceId;
  }
}

async function finalize(id: string) {
  const response = await instanceRoute.POST(
    new Request(`https://app.test/api/forms/instances/${id}`, {
      method: "POST",
      body: JSON.stringify({ action: "finalize", followUpDate: null, acknowledgeUnverifiedPolicy: true }),
    }),
    { params: Promise.resolve({ id }) },
  );
  joinOverview();
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
}

/** The value of one "**Label:** …" line in the reply, or null. */
function line(content: string, label: string): string | null {
  const found = content.split("\n").find((entry) => entry.trim().startsWith(`**${label}:**`));
  return found ? found.trim().slice(`**${label}:**`.length).trim() : null;
}

const observation = (answer: Answer) => line(answer.content, "Observation of Offense") ?? "";
const row = (id: string) => (store.form_instances ?? []).find((entry) => entry.id === id) ?? null;

/* ========================================================================= */

describe("S12 conv_mvnt2v9t245c4le: a grammar request is answered, never appended", () => {
  const REQUEST =
    "create a follow-up coaching form for Test Employee for a must see behavior. i trained her on the promotions, specificslly the $5 red light therapy promo, and i roleplayed a couple objections with her. the follow-up is that i'll listen in on her with client engagment, tie the mention of redlight into the reason the client is there in the first place";
  const GRAMMAR = "can you clean up my grammar and capitalizing on proper nouns?";
  const AGAIN = "ok, make the grammatical changes mentioned that CAN be made. i will listen to at least 10 check-ins on the next shift we overlap.";

  it("the request is not in the Observation, and the reply says what it will and won't change", async () => {
    const thread = new Thread();
    await thread.say(REQUEST, { employee: "Test Employee", formType: "Follow-Up Coaching Form" });
    const asked = await thread.say(GRAMMAR, { employee: "Test Employee", formType: "Follow-Up Coaching Form" });
    expect(observation(asked)).not.toMatch(/grammar|capitaliz/i);
    expect(asked.content).toMatch(/grammar/i);
    expect(asked.content).toMatch(/won't add|nothing is added|no facts/i);
    const again = await thread.say(AGAIN, { employee: "Test Employee", formType: "Follow-Up Coaching Form" });
    expect(observation(again)).not.toMatch(/grammatical changes|grammar|capitaliz/i);
    expect(observation(again)).toMatch(/i will listen to at least 10 check-ins/i);
  });
});

describe("S22 conv_mvnszqiq28bgs9z: \"change observation of offense to: …\" replaces the field", () => {
  const CHANGE =
    "change observation of offense to: Test completed onboarding with new hire Test Newhire on 9-28-26. As of 10-16-26 Test Newhire had not acknowledged onboarding policies in Woven that should have been completed during onboarding.";
  const LITERAL =
    "Test completed onboarding with new hire Test Newhire on 9-28-26. As of 10-16-26 Test Newhire had not acknowledged onboarding policies in Woven that should have been completed during onboarding.";

  it("the Observation is exactly the manager's text", async () => {
    const thread = new Thread();
    const reading = { employee: "Test Employee", title: "Salon Director", formType: "Corrective Action Form", policyHeading: "Standards of Conduct" };
    await thread.say("create a CA for salon director, test employee for violating the standards of conduct", reading);
    await thread.say("Test Employee, Salon Director", reading);
    const changed = await thread.say(CHANGE, reading);
    expect(observation(changed)).toBe(LITERAL);
    expect(changed.content).not.toMatch(/change observation of offense/i);
  });
});

describe("G12 conv_mvnt4qoo226yi34: \"change salon location to omaha center\" sets the salon", () => {
  const REQUEST =
    "do verbal corrective action for test employee, tanning consultant at NE Kearney location. previous coaching jba manual 9-9-26. payroll deduct applies. on 10-22-26 the register was short 8.65 which will be payroll deducted from tests check";

  it("the salon is NE Omaha 144th and Center and the edit is not appended", async () => {
    const thread = new Thread();
    const first = await thread.say(REQUEST, { employee: "test employee", salon: "NE Kearney", formType: "Corrective Action Form", warningLevel: "verbal" });
    expect(first.formProposal?.locationId).toBe("loc-0309");
    const changed = await thread.say("change salon location to omaha center", {
      employee: "test employee",
      salon: "Omaha Center",
      formType: "Corrective Action Form",
    });
    expect(changed.formProposal?.locationId).toBe("loc-0314");
    expect(changed.content).toMatch(/\*\*Salon:\*\* NE Omaha 144th and Center, as you said/);
    expect(changed.content).not.toMatch(/change salon location/i);
    /* A later turn that names no salon keeps the one the edit set. */
    const later = await thread.say("create a Corrective Action Form for Test Employee", { employee: "Test Employee", formType: "Corrective Action Form" });
    expect(later.formProposal?.locationId).toBe("loc-0314");
    expect(later.content).not.toMatch(/change salon location/i);
  });

  it("B-list: the prior coaching's 9-9-26 is not a Follow-up", async () => {
    const thread = new Thread();
    const first = await thread.say(REQUEST, { employee: "test employee", salon: "NE Kearney", formType: "Corrective Action Form" });
    expect(line(first.content, "Follow-up")).toBeNull();
    expect(line(first.content, "Date")).toBe("10/22/2026");
  });
});

describe("(d) conv_mvnt5u7l2b5u91t: \"X INSTEAD of Y\" means X", () => {
  it("the policy is Late Opening, and Attendance is not cited", async () => {
    const thread = new Thread();
    const reading = { employee: "Test Employee", formType: "Corrective Action Form", policyHeading: "Late Opening", warningLevel: "verbal" };
    await thread.say("create corrective action for for Test Employee for Late Opening from the policy manual. It is a verbal warning", reading);
    await thread.say("can you add late opening policy to the direct policy section of this from", reading);
    const swapped = await thread.say("can you reference the late opening policy INSTEAD of the attendance policy", reading);
    expect(line(swapped.content, "Policy")).toMatch(/^Late Opening\b/);
    expect(swapped.content).not.toMatch(/\*\*Policy:\*\* Attendance/);
    expect(swapped.content).not.toMatch(/Attendance Policy, JBA Policy Manual/);
    expect(observation(swapped)).not.toMatch(/instead of|can you add|can you reference/i);
  });
});

describe("Q7 conv_mvntbka92uzz9zc: the coaching date is not the form date", () => {
  it("dates the form 10/20, the late opening, never 9/15", async () => {
    const thread = new Thread();
    const answer = await thread.say(
      "create a verbal CA for Test Employee at NE Kearney for being late to open on 10-20, she was coached on 9-15 for being late, no payroll",
      { employee: "Test Employee", salon: "NE Kearney", formType: "Corrective Action Form", warningLevel: "verbal" },
    );
    expect(line(answer.content, "Date")).toBe("10/20/2026");
    expect(answer.formProposal?.formDate).toBe("2026-10-20");
    expect(line(answer.content, "Follow-up")).toBeNull();
  });
});

describe("H8 conv_mvnt5ds52v5vyfe: \"today\" dates the form today", () => {
  /* "Maddie" in the manager's words is replaced with a synthetic first name. */
  const ACCOUNT =
    "Test Employee, today, - Test set up a spray booth, then went into Room 4 and stayed there until the first customer arrived at 7:57am. - When we arrived at 8:15am, the lobby lights were still off. - When Wren asked whether she had completed her 10-minute sanitization, Test said yes. The footage showed that it had not been completed. - She was also not in dress code, was not wearing her nametag, and did not have a goal sheet until she was asked about it. Written warning. previous coaching. verbal (06/25/2026) and written (07/28/2026). no payroll deducation. TC";

  it("asks no date question about the prior warnings and dates the form 10/25", async () => {
    const thread = new Thread();
    await thread.say("I need a corrective action for f", { formType: "Corrective Action Form" });
    const account = await thread.say(ACCOUNT, { employee: "Test Employee", formType: "Corrective Action Form", warningLevel: "written", title: "TC" });
    expect(account.content).not.toMatch(/more than one date/i);
    expect(account.formProposal?.formDate ?? TODAY).toBe(TODAY);
    const named = await thread.say("test employee", { employee: "test employee", formType: "Corrective Action Form" });
    expect(line(named.content, "Date") ?? "10/25/2026").toBe("10/25/2026");
    expect(named.formProposal?.formDate ?? TODAY).toBe(TODAY);
    expect(line(named.content, "Follow-up")).toBeNull();
  });
});

describe("B-list: a prior action's date is never the Follow-up", () => {
  it.each([
    [
      "conv_mvnt3gvq2foc4ju",
      "do verbal for team member test employee at lincoln pine lake. payroll deduct does not apply. previous coaching jba manual 11-1-25. on 10-22-26 test was not scheduled to work and came into the salon to show her team her new puppy. Test was in the salon 45 min",
      "10/22/2026",
    ],
    [
      "conv_mvnt3i6g2d618l7",
      "create a written corrective action for Team Member, Test Employee. Test was assigned to complete policy acknowledgements in woven by 10-15-26 and failed to meet the deadline. Previous coaching was a Verbal CA 10-1-26. Payroll deduct is not applicable.",
      "10/15/2026",
    ],
    [
      "conv_mvnt86up29zm6vn",
      "create ca form for test employee for violating attendance policy on 10-20-26. verbal. no payroll deduct. jba manual 1-1-26 for previous coaching",
      "10/20/2026",
    ],
    [
      "conv_mvnt8mb52mdkcuj",
      "create a written CA for test employee for not attending the monthly meeting on 10-20-26. previous coaching: jba policy manual 1-1-26, verbal ca 9-1-26. payroll deduct not applicable",
      "10/20/2026",
    ],
    [
      "conv_mvntaf0v2tkf1ok",
      "write a verbal CA for Team Member, Test Employee at NE Kearney. On 10-20-26 Test was late for shift and did not call supervisor as outlined in attendance policy. payroll deduct is not applicable. previous coaching is JBA Manual 1-1-25",
      "10/20/2026",
    ],
    [
      "conv_mvntax7r2kuzome",
      "create verbal ca for test employee for opening salon late on 10-1-26. previous coaching is jba policy manual 1-1-26. payroll deduct DOES apply and state $25 will be payroll deducted",
      "10/1/2026",
    ],
    [
      "conv_mvntbatp2s6wr7q",
      "create a written corrective action for team member test employee at omaha center location. previous coaching jba manual 1-1-95, verbal ca 10-5-26. payroll deduct is applicable and $25 will be payroll deducted for late open on 10-21-26",
      "10/21/2026",
    ],
    [
      "conv_mvnta8lq20ks728",
      "create corrective action for test employee for violating standards of conduct policy on 10-20-26. test failed to acknowledge policies in woven by the 10-15-26 deadline.",
      "10/20/2026",
    ],
  ])("%s: no Follow-up line, and the Date is the incident's", async (_conv, words, date) => {
    const thread = new Thread();
    const answer = await thread.say(words, { employee: "test employee", formType: "Corrective Action Form" });
    expect(line(answer.content, "Follow-up")).toBeNull();
    expect(line(answer.content, "Date")).toBe(date);
  });

  it("an explicit follow-up phrase still sets Follow-up", async () => {
    const thread = new Thread();
    const answer = await thread.say(
      "create verbal ca for test employee for opening salon late on 10-21-26. payroll deduct no. follow up on 11-4-26",
      { employee: "test employee", formType: "Corrective Action Form" },
    );
    expect(line(answer.content, "Follow-up")).toBe("11/4/2026");
    expect(line(answer.content, "Date")).toBe("10/21/2026");
  });
});

describe("sibling conv_mvnsqglc2v7zuyk: a corrected prior-coaching date never dates the form", () => {
  it("\"jba manual 11-1-25\" on its own is the prior coaching; the form is dated 10/22", async () => {
    const thread = new Thread();
    const reading = { employee: "Test Employee", formType: "Corrective Action Form" };
    await thread.say(
      "do verbal for team member Test Employee at empire, sd. payroll deduct does not apply. previous coaching jba manual 11-1-26. on 10-22-26 Test was not scheduled to work and came into the salon to show her team her new puppy. Test was in the salon 45 min",
      reading,
    );
    await thread.say("jba manual 11-1-25", reading);
    const answer = await thread.say("salon location is empire, sd. create corrective action", reading);
    expect(answer.formProposal?.formDate).toBe("2026-10-22");
    expect(line(answer.content, "Follow-up")).toBeNull();
  });
});

describe("S21 conv_mvnt79t822zud9j: \"change the date\" on a FINALIZED form opens a revision", () => {
  it("opens a new draft of the finalized form, dated 10/20/2026, and appends nothing", async () => {
    const earlier = new Thread();
    await earlier.say("create a corrective action form for Test Employee for opening the salon late on 10-17-26. payroll deduct no", {
      employee: "Test Employee",
      formType: "Corrective Action Form",
    });
    const original = await earlier.create();
    await finalize(original);

    const thread = new Thread();
    await thread.say("create ca for Test Employee", { employee: "Test Employee", formType: "Corrective Action Form" });
    const edited = await thread.say("can you edit the form I already finalized for Test Employee? change the date to 10-20-26", {
      employee: "Test Employee",
      formType: "Corrective Action Form",
      incidentDate: "10-20-26",
    });
    expect(edited.formProposal).toBeUndefined();
    expect(edited.formOpened?.revisesInstanceId).toBe(original);
    expect(edited.content).not.toMatch(/Observation of Offense/);
    const revision = row(edited.formOpened!.instanceId);
    expect(revision?.status).toBe("draft");
    expect(revision?.form_date).toBe("2026-10-20");
    expect(row(original)?.status).toBe("finalized");
  });

  it("with nothing finalized on file it says so, and does not draft a card from the request", async () => {
    const thread = new Thread();
    await thread.say("create ca for Test Employee", { employee: "Test Employee", formType: "Corrective Action Form" });
    const edited = await thread.say("can you edit the form I already finalized for Test Employee? change the date to 10-20-26", {
      employee: "Test Employee",
      formType: "Corrective Action Form",
      incidentDate: "10-20-26",
    });
    expect(edited.content).not.toMatch(/Observation of Offense:\*\* can you edit/i);
    expect(edited.content).toMatch(/couldn't find/i);
  });
});

describe("B15 (sibling conv_mvnu46n823v1unt): \"late today\" dates the form today", () => {
  it("the Date is 10/25/2026", async () => {
    const thread = new Thread();
    const answer = await thread.say("create a CA for Test Employee at Kearney, she opened the salon late today", {
      employee: "Test Employee",
      salon: "Kearney",
      formType: "Corrective Action Form",
    });
    expect(answer.formProposal?.formDate).toBe(TODAY);
    expect(line(answer.content, "Date")).toBe("10/25/2026");
  });
});

describe("B17 (sibling conv_mvnuh50i2hanl53): an explicit add appends, a replace replaces, anything else leaves the field", () => {
  const REQUEST = "create a CA for Test Employee at Kearney for being late to open on 10-20-26, verbal, no payroll";
  const reading = { employee: "Test Employee", salon: "Kearney", formType: "Corrective Action Form", warningLevel: "verbal" };

  it("\"add that she was also on her phone\" is added in her words and the reply says so", async () => {
    const thread = new Thread();
    const first = await thread.say(REQUEST, reading);
    const before = observation(first);
    const added = await thread.say("add that she was also on her phone", reading);
    expect(added.formProposal?.templateKey).toBe("dpoa");
    expect(observation(added)).toContain("she was also on her phone");
    if (before) expect(observation(added).startsWith(before.replace(/[.]$/, ""))).toBe(true);
    expect(added.content).toMatch(/Added to \*\*Observation of Offense\*\*, in your words: "she was also on her phone"/);
    expect(observation(added)).not.toMatch(/add that/i);
    expect(line(added.content, "Date")).toBe("10/20/2026");
  });

  it("an instruction that is neither leaves the Observation as it was", async () => {
    const thread = new Thread();
    const first = await thread.say(REQUEST, reading);
    const other = await thread.say("can you clean up my grammar and capitalizing on proper nouns?", reading);
    expect(observation(other)).toBe(observation(first));
  });
});

/*
 * The full remap is off in this app's production and on in the sibling's; the
 * same guard is on it here, with the same cases (sibling conv_mvnuh50i2hanl53,
 * conv_mvnsowzl20ljr9m, conv_mvnu46n823v1unt).
 */
describe("the full remap path (FORM_FULL_REMAP_ENABLED): the same rules", () => {
  const remap = () => {
    process.env.FORM_FULL_REMAP_ENABLED = "true";
    delete process.env.INTENT_EXTRACTION_ENABLED;
  };
  const happened = (answer: Answer) => line(answer.content, "What happened") ?? "";
  const REQUEST = "create a CA for Test Employee at Kearney for being late to open on 10-20-26, verbal, no payroll";

  it("an add appends in her words; a grammar request leaves What happened", async () => {
    remap();
    const thread = new Thread();
    const first = await thread.say(REQUEST);
    expect(happened(first)).toBeTruthy();
    const added = await thread.say("add that she was also on her phone");
    expect(happened(added)).toContain(happened(first).replace(/[.]$/, ""));
    expect(happened(added)).toContain("she was also on her phone");
    expect(added.content).toMatch(/Added to \*\*What happened\*\*, in your words: "she was also on her phone"/);
    const asked = await thread.say("can you clean up my grammar and capitalizing on proper nouns?");
    expect(happened(asked)).toBe(happened(added));
    expect(asked.content).toMatch(/won't add or change any facts/);
  });

  it("a replace sets What happened to the manager's text", async () => {
    remap();
    const thread = new Thread();
    await thread.say("create a CA for salon director, test employee for violating the standards of conduct");
    const changed = await thread.say(
      "change observation of offense to: Test completed onboarding with new hire Test Newhire on 9-28-26.",
    );
    expect(happened(changed)).toBe("Test completed onboarding with new hire Test Newhire on 9-28-26.");
  });

  it("\"change the date to 10-23-26\" sets the Date and is never What happened", async () => {
    remap();
    const thread = new Thread();
    await thread.say(REQUEST);
    const changed = await thread.say("change the date to 10-23-26");
    expect(line(changed.content, "Date")).toBe("2026-10-23");
    expect(happened(changed)).not.toMatch(/change the date/i);
  });

  it("\"she opened the salon late today\" is dated today", async () => {
    remap();
    const thread = new Thread();
    const answer = await thread.say("create a CA for Test Employee at Kearney, she opened the salon late today");
    expect(answer.formProposal?.formDate).toBe(TODAY);
  });
});

describe("flag off: production today", () => {
  it("S22's edit is appended after the request, as live", async () => {
    delete process.env[FLAG];
    const thread = new Thread();
    const reading = { employee: "Test Employee", title: "Salon Director", formType: "Corrective Action Form" };
    await thread.say("create a CA for salon director, test employee for violating the standards of conduct", reading);
    const changed = await thread.say(
      "change observation of offense to: Test completed onboarding with new hire Test Newhire on 9-28-26.",
      reading,
    );
    expect(observation(changed)).toMatch(/^create a CA for salon director.*change observation of offense to:/);
  });
});
