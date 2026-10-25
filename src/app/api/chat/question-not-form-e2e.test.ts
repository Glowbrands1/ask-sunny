import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * P0 — A QUESTION IS ANSWERED, NEVER ROUTED INTO A FORM (LIVE, 25 OCT 2026)
 * ============================================================================
 *
 * Replay of production (20120d7, production flags) and the August chat with
 * the same "should i do a coaching" turn. The managers' exact words, each with
 * the turns before it in that conversation. The first answer in each chat is
 * the production reply, shortened in the middle; its closing offer ("ask me to
 * create a coaching form or a policy review for them") is verbatim, because
 * that offer is what made every later question a form turn:
 *
 *   conv_mvnt563o2sk0vcl  "how many hours is a part-time tanning consultant?"
 *                         → "Which form did you mean? … 1. Coaching Form
 *                            2. Policy Review"
 *   conv_mvnsyv362uddqp5  bereavement, "should i do a coaching or corrective
 *                         action", smoke breaks, pets → the same menu
 *   conv_mvnt4hjy2ox0jlq  "smoking policy", "difference between ca and
 *                         coaching form" → "Who is this Corrective Action
 *                         Form for?"
 *   conv_mvnt7pb32vj2qrb  "hey what policies can you write someone up for …"
 *                         → the same, with the question as Observation of
 *                         Offense
 *   conv_mvnt9at12004nks  "footwear for employees" → a Corrective Action Form
 *   conv_mue55ne8fq5tu3k  "employee has been late twice. should i do a
 *                         coaching or corrective action" → "Who is this
 *                         Corrective Action Form for?"
 *   (Ask Bubbles) conv_mvnsvw4t2a3btpw  "what policy does that fall under?"
 *                         after a Corrective Action card → written into the
 *                         card. Here in this app's words, with a salon.
 *
 * Each question gets the answer: no card, no menu, no "Who is this … for?",
 * and the open card is not rewritten. A create request (also one phrased as a
 * question), a statement field edit, the exit-form request and "create a
 * coaching document for … regarding …" still make or edit their card.
 *
 * Behind QUESTION_NOT_FORM_ENABLED (default off): the exact turns run with it
 * on; with it off, the last block shows the routing is what it was.
 *
 * Every turn goes through POST /api/chat. Faked: identity, the database
 * (in memory), the directory, the models, analytics. The slot model is read
 * two ways: as a reading that names nothing, and as the reading the live
 * traces show for the Corrective Action turns (the Corrective Action Form, a
 * form turn). Synthetic names.
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
  slotReading: "none" as "none" | "ca",
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
      if (!hasPermission(DEFAULT_PERMISSION_MATRIX, "district_manager" as never, permission as never)) {
        throw new AuthError("forbidden", "Your role does not have permission to do that.");
      }
      return {
        identity: {
          subject: "qa-manager",
          email: "qa-manager@example.test",
          displayName: "QA Manager",
          role: "district_manager",
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

const ANSWER = "A grounded answer from the policy manual.";

vi.mock("@/lib/ai/call-claude", () => ({
  callClaude: async () => {
    state.chatModelCalls += 1;
    return ANSWER;
  },
  callClaudeTool: async (input: { tool?: { name?: string } }) => {
    if (input.tool?.name !== "record_intent_slots") return null;
    return {
      employee: null,
      salon: null,
      title: null,
      incidentType: null,
      incidentDate: null,
      payrollAmount: null,
      warningLevel: null,
      formType: state.slotReading === "ca" ? "Corrective Action Form" : null,
      formTurn: state.slotReading === "ca",
      policyHeading: null,
    };
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
    readDirectoryFacts: async () => [],
    loadScopedRoster: async (scope: AccessScope | null) => actual.scopeRoster(state.directory as never, scope),
  };
});

vi.mock("@/lib/forms/prior-forms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/forms/prior-forms")>()),
  priorFormsReadingForChat: async () => ({ attach: [], possible: [], identity: "none" }),
}));

process.env.NEXT_PUBLIC_DEMO_MODE = "false";

vi.setConfig({ hookTimeout: 30_000, testTimeout: 30_000 });

const { ensureTemplateLibrary } = await import("@/lib/forms/repository");
const { createInlineForm } = await import("@/features/chat/create-inline-form");
const chatRoute = await import("./route");
const instancesRoute = await import("../forms/instances/route");
const draftRoute = await import("../forms/instances/[id]/draft/route");

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

/** The chat route only accepts a UUID for the open form; the fake numbers rows `fake-N`. */
function toUuid(id: string): string {
  if (/^[0-9a-f-]{36}$/.test(id)) return id;
  const uuid = randomUUID();
  for (const table of ["form_instances", "form_instance_values", "form_instance_events"] as const) {
    for (const row of store[table]) {
      if (row.id === id) row.id = uuid;
      if (row.instance_id === id) row.instance_id = uuid;
    }
  }
  return uuid;
}

const TODAY = "2026-10-25";

/** The production profile (20120d7): intent extraction on, the full remap off. */
const PRODUCTION = [
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

/** The integration bundle's flags (b44c540), default off, turned on together. */
const BUNDLE = [
  "PLACE_SPAN_GUARD_ENABLED",
  "MANAGER_WORDS_ONLY_ENABLED",
  "CONVERSATION_DRAFT_REUSE_ENABLED",
  "DRAFT_ACTIONS_ENABLED",
  "LATE_OPEN_DATE_ENABLED",
  "CA_TEMPLATE_MAP_ENABLED",
  "FORM_CHOICE_STATED_ENABLED",
  "REMAP_INCIDENT_FIX_ENABLED",
  "PRIOR_ACTIONS_PARSE_ENABLED",
  "KEEP_FORM_EMPLOYEE_ENABLED",
  "TITLE_WHOLE_WORD_ENABLED",
  "NOT_A_NAME_GUARD_ENABLED",
  "WARNING_LEVEL_MANAGER_ONLY_ENABLED",
  "INTENT_PAYROLL_MANAGER_ONLY_ENABLED",
] as const;

const PROFILES: readonly (readonly [string, readonly string[]])[] = [
  ["production flags", PRODUCTION],
  ["production flags + the bundle's flags", [...PRODUCTION, ...BUNDLE]],
];

/** This fix's flag, default off. The exact-turn cases run with it on. */
const FLAG = "QUESTION_NOT_FORM_ENABLED";

const ALL_FLAGS = [...PRODUCTION, ...BUNDLE, FLAG];

type Answer = {
  content: string;
  formProposal?: ChatFormProposal;
  formSelection?: unknown;
  formOpened?: { instanceId: string };
  formUpdate?: { instanceId: string; updated: string[] };
};

/** The thread as the browser holds it: a card the answer carried stays open. */
class Thread {
  readonly messages: ChatMessage[] = [];
  proposal: ChatFormProposal | null = null;
  instanceId: string | null = null;
  private sequence = 0;
  private readonly conversationId = `conv-${randomUUID()}`;

  replay(question: string, answer: string) {
    const id = `m${(this.sequence += 1)}`;
    this.messages.push(
      { id, role: "user", content: question, createdAt: `${TODAY}T12:27:20Z` } as ChatMessage,
      { id: `a${this.sequence}`, role: "assistant", content: answer, createdAt: `${TODAY}T12:27:33Z` } as ChatMessage,
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
          conversationId: this.conversationId,
          ...(this.proposal && !this.instanceId ? { continueProposalTemplateKey: this.proposal.templateKey } : {}),
          ...(this.instanceId ? { activeFormInstanceId: this.instanceId } : {}),
        }),
      }),
    );
    const payload = (await response.json()) as Answer & { error?: string };
    expect(response.status, JSON.stringify(payload)).toBe(200);
    this.messages.push(
      { id, role: "user", content: question, createdAt: `${TODAY}T12:28:00Z` } as ChatMessage,
      {
        id: `a${this.sequence}`,
        role: "assistant",
        content: payload.content,
        createdAt: `${TODAY}T12:28:01Z`,
        ...(payload.formProposal ? { formProposal: payload.formProposal } : {}),
      } as ChatMessage,
    );
    if (payload.formProposal) this.proposal = payload.formProposal;
    return payload;
  }

  /** The card's Create, as the browser does it. */
  async create(): Promise<string> {
    expect(this.proposal, "no card to create from").not.toBeNull();
    const result = await createInlineForm({ proposal: this.proposal!, messages: this.messages, call, onCreated: () => {} });
    this.instanceId = toUuid(result.reference.instanceId);
    return this.instanceId;
  }
}

/** Every value saved on the form, as one string. */
function savedValues(instanceId: string): string {
  return JSON.stringify(store.form_instance_values.filter((row) => row.instance_id === instanceId));
}

/** The proposal card's values as one string, to see what was written into it. */
function cardText(proposal: ChatFormProposal | undefined | null): string {
  return JSON.stringify(proposal ?? {});
}

const MENU = /Which form did you mean\?|Which form should I start with\?/;
const WHO_FOR = /Who is this \*\*[^*]+\*\* for\?|Who is this for\?/;
const CA_INTAKE = /I can help you create a \*\*Corrective Action Form\*\*/;

/** Answered: the model's answer, no card, no menu, no form prompt. */
function expectAnswered(answer: Answer) {
  expect(answer.content).not.toMatch(MENU);
  expect(answer.content).not.toMatch(WHO_FOR);
  expect(answer.content).not.toMatch(CA_INTAKE);
  expect(answer.content.startsWith(ANSWER), answer.content).toBe(true);
  expect(answer.formProposal).toBeUndefined();
}

/* Production replies, shortened in the middle; the closing offer is verbatim. */
const TATTOO_ANSWER =
  "Here's what the manual actually covers:\n\n**Tattoos** — Large, inappropriate, or offensive tattoos must be covered; all other tattoos are acceptable as long as they are not discriminatory or offensive in nature (Tattoos, JBA Policy Manual p.16 [p.16]).\n\n**Piercings** — There's no piercing-specific policy in the manual. …\n\nAs a general approach, if you've got a specific piercing situation that feels borderline, it's worth a quick check with HR rather than making a judgement call on your own — the manual leaves that gap deliberately open, and you don't want inconsistent standards across salons. If this is heading toward a documented conversation with someone, ask me to create a coaching form or a policy review for them.";
const WAIVER_ANSWER =
  "The one that's directly on point is the consent form requirement: every client must complete and sign a consent form (New Client Release Form) found in our system … (\"Consent Forms (New Client Release Forms)\", JBA Policy Manual p.49 [p.49]).\n\nAs a general approach, before you decide on the step, pin down whether this was a one-off miss or a pattern, and whether the client actually tanned without a signed form — that changes how serious it reads.\n\nIf you want this documented, tell me the employee and what happened and ask me to create a coaching form, a policy review, or a corrective action form for them, and the draft card will come up here.";
const ATTENDANCE_ANSWER =
  "Here's what the manual covers on attendance:\n\n**The core policy**\n- Each employee is responsible for knowing their schedule and always being on time (\"Attendance\", JBA Policy Manual p.14 [p.14]).\n- If an opener can't open on time, they must notify the manager as soon as possible, and the employee who failed to open reimburses the company $25.00 via payroll deduction where applicable (\"Late Opening\", JBA Policy Manual p.15 [p.15]).\n…\n\nIf you're dealing with a specific employee on this, tell me what's happened and I can walk you through the options — and if you want it documented, ask me to create a coaching form or corrective action form for them by name.";
const WORKSHEET_ANSWER =
  "Happy to. Everything below comes straight from the manuals, so it's safe to hand to a new TC — just keep in mind it's a training aid, not an official form.\n\n**Closing duties — Tanning Consultant**\n\n- Empty trash\n- Clean bathrooms\n…\n\nAnd if you want the training conversation documented for someone's file, ask me to create a coaching form for them.";
const UGGS_ANSWER =
  "The manual doesn't name Uggs — or any brand — so there's no policy specific to them. What it does say on footwear:\n\n- Tennis shoes or other full-coverage closed-toe shoes are to be worn (Shoes, JBA Policy Manual p.15 [p.15]).\n…\n\nIf you want it documented with a specific employee, ask me to create a coaching form or a policy review for them.";

const saved = new Map<string, string | undefined>();

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  state.slotReading = "none";
  state.draft = { values: {} };
  state.revision = { values: {} };
  state.revisionCalls = 0;
  state.chatModelCalls = 0;
  state.directory = [
    { id: "e-1", firstName: "Test", lastName: "Employee", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0468"] },
  ];
  for (const name of ALL_FLAGS) saved.set(name, process.env[name]);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:30:00Z`));
  await ensureTemplateLibrary("system");
});

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.useRealTimers();
});

function useProfile(flags: readonly string[], fix = true) {
  for (const name of ALL_FLAGS) delete process.env[name];
  for (const name of flags) process.env[name] = "true";
  if (fix) process.env[FLAG] = "true";
}

describe.each(PROFILES)("P0: a question is answered (%s)", (_label, flags) => {
  describe.each([["a slot reading that names nothing", "none"], ["the live Corrective Action reading", "ca"]] as const)(
    "with %s",
    (_reading, reading) => {
      beforeEach(() => {
        useProfile(flags);
        state.slotReading = reading;
      });

      it("conv_mvnt563o2sk0vcl: hours of a part-time tanning consultant, then hiring qualities", async () => {
        const thread = new Thread();
        thread.replay("what's our policy on visible tattoos and piercings?", TATTOO_ANSWER);
        expectAnswered(await thread.say("how many hours is a part-time tanning consultant?"));
        expectAnswered(await thread.say("what qualities do we look for before hiring a tanning consultant?"));
      });

      it("conv_mvnsyv362uddqp5: bereavement, coaching or CA, smoke breaks, pets", async () => {
        const thread = new Thread();
        thread.replay("what policy is violated when employee fails to have client sign waiver", WAIVER_ANSWER);
        expectAnswered(await thread.say("what's policy on bereavement"));
        expectAnswered(await thread.say("employee has been late twice. should i do a coaching or corrective action"));
        expectAnswered(await thread.say("whats policy about smoke breaks"));
        expectAnswered(await thread.say("whats policy about brining pets into salon"));
      });

      it("conv_mvnt4hjy2ox0jlq: smoking policy, then the difference between a CA and a coaching form", async () => {
        const thread = new Thread();
        thread.replay("What does our policy say about attendance?", ATTENDANCE_ANSWER);
        expectAnswered(await thread.say("smoking policy"));
        expectAnswered(await thread.say("difference between ca and coaching form"));
      });

      it("conv_mvnt7pb32vj2qrb: what policies can you write someone up for", async () => {
        const thread = new Thread();
        thread.replay("Can you make me a training worksheet for closing duties at night?", WORKSHEET_ANSWER);
        expectAnswered(
          await thread.say("hey what policies can you write someone up for not signing a memebership up on a credit card"),
        );
      });

      it("conv_mvnt9at12004nks: footwear for employees", async () => {
        const thread = new Thread();
        thread.replay("policy specific to uggs?", UGGS_ANSWER);
        expectAnswered(await thread.say("footwear for employees"));
      });

      it("conv_mue55ne8fq5tu3k: should i do a coaching or corrective action, after policy questions", async () => {
        const thread = new Thread();
        thread.replay("what policy is violated when employee fails to have client sign waiver", WAIVER_ANSWER);
        expectAnswered(await thread.say("what's policy on bereavement"));
        expectAnswered(await thread.say("employee has been late twice. should i do a coaching or corrective action"));
      });
    },
  );

  describe("an open card", () => {
    beforeEach(() => useProfile(flags));

    it('Ask Bubbles conv_mvnsvw4t2a3btpw: "what policy does that fall under?" is answered and nothing is written', async () => {
      const thread = new Thread();
      const card = await thread.say("create a verbal CA for Test Employee at Lawrence for a late opening on 10-20-26");
      expect(card.formProposal?.templateKey).toBe("dpoa");
      const before = cardText(thread.proposal);
      const answer = await thread.say("what policy does that fall under?");
      expectAnswered(answer);
      expect(cardText(thread.proposal)).toBe(before);
      expect(cardText(thread.proposal)).not.toMatch(/what policy does that fall under/i);
    });

    it("a question about a created form is answered; the form is not corrected or revised", async () => {
      const thread = new Thread();
      await thread.say("create a verbal CA for Test Employee at Lawrence for a late opening on 10-20-26");
      const id = await thread.create();
      const before = savedValues(id);
      state.revision = { values: { observation: "what policy does that fall under?" } };
      const answer = await thread.say("what policy does that fall under?");
      expectAnswered(answer);
      expect(answer.formUpdate).toBeUndefined();
      expect(state.revisionCalls).toBe(0);
      expect(savedValues(id)).toBe(before);
    });

    it("a statement edit with a created form open stays on the form path", async () => {
      const thread = new Thread();
      await thread.say("create a verbal CA for Test Employee at Lawrence for a late opening on 10-20-26");
      await thread.create();
      const answer = await thread.say("change the date to 10-22-26");
      // Handled by the form paths exactly as on main (a correction or a card), never answered as a question.
      expect(answer.content.startsWith(ANSWER)).toBe(false);
      expect(Boolean(answer.formUpdate || answer.formProposal || answer.formOpened)).toBe(true);
    });

    it("a question after a card never fills the next card's What happened", async () => {
      const thread = new Thread();
      thread.replay("what policy is violated when employee fails to have client sign waiver", WAIVER_ANSWER);
      expectAnswered(await thread.say("whats policy about brining pets into salon"));
      expectAnswered(await thread.say("employee has been late twice. should i do a coaching or corrective action"));
      const card = await thread.say("create a CA for Test Employee for being late twice");
      expect(card.formProposal?.templateKey).toBe("dpoa");
      expect(cardText(card.formProposal)).not.toMatch(/brining pets|should i do a coaching/i);
    });
  });

  describe("requests still make or edit their card", () => {
    beforeEach(() => useProfile(flags));

    it("an explicit create request", async () => {
      const thread = new Thread();
      thread.replay("What does our policy say about attendance?", ATTENDANCE_ANSWER);
      const card = await thread.say("create a CA for Test Employee for opening the salon late on 10-20-26");
      expect(card.formProposal?.templateKey).toBe("dpoa");
    });

    it("a create request phrased as a question", async () => {
      const thread = new Thread();
      thread.replay("What does our policy say about attendance?", ATTENDANCE_ANSWER);
      const card = await thread.say("can you create a CA for Test Employee for opening the salon late on 10-20-26?");
      expect(card.formProposal?.templateKey).toBe("dpoa");
    });

    it("write a coaching for …", async () => {
      const thread = new Thread();
      const card = await thread.say("write a coaching for Test Employee for not completing closing duties");
      expect(card.formProposal?.templateKey).toBe("coaching");
    });

    it("create a coaching document for … regarding …", async () => {
      const thread = new Thread();
      const card = await thread.say("create a coaching document for Test Employee regarding not completing closing duties");
      expect(card.formProposal?.templateKey).toBe("coaching");
    });

    it("the exit-form request", async () => {
      const thread = new Thread();
      const card = await thread.say("create an exit form for Test Employee at Lawrence, she resigned and her last day was 10-20");
      expect(card.formProposal?.templateName).toMatch(/Exit/i);
    });

    it("a statement field edit on the open card", async () => {
      const thread = new Thread();
      const card = await thread.say("create a verbal CA for Test Employee at Lawrence for a late opening on 10-20-26");
      expect(card.formProposal?.templateKey).toBe("dpoa");
      const edited = await thread.say("change the date to 10-22");
      expect(edited.content.startsWith(ANSWER)).toBe(false);
      expect(edited.formProposal?.templateKey).toBe("dpoa");
      // The new date lands with LATE_OPEN_DATE_ENABLED (the bundle); without it the card keeps 10-20, as on main.
      if (flags.includes("LATE_OPEN_DATE_ENABLED")) expect(cardText(edited.formProposal)).toMatch(/2026-10-22/);
    });

    // Production only: with FORM_CHOICE_STATED_ENABLED (the bundle) the assistant's offer never picks the form.
    it.runIf(!flags.includes("FORM_CHOICE_STATED_ENABLED"))("the name after an offer still opens the offered card", async () => {
      const thread = new Thread();
      thread.replay(
        "One of my TCs keeps leaving the closing duties half done",
        "Talk to them privately first. If you want this documented, ask me to create a coaching form for them and the draft card will come up here.",
      );
      const card = await thread.say("Her name is Test Employee");
      expect(card.formProposal?.templateKey).toMatch(/coaching/);
    });
  });
});

/*
 * QUESTION_NOT_FORM_ENABLED OFF: the routing is what production has today, so
 * the live failures still reproduce. When this block starts failing with the
 * flag off, the old routing changed.
 */
describe("QUESTION_NOT_FORM_ENABLED off: every turn is routed as before (production flags)", () => {
  beforeEach(() => useProfile(PRODUCTION, false));

  it('conv_mvnt563o2sk0vcl: still "Which form did you mean?"', async () => {
    const thread = new Thread();
    thread.replay("what's our policy on visible tattoos and piercings?", TATTOO_ANSWER);
    const answer = await thread.say("how many hours is a part-time tanning consultant?");
    expect(answer.content).toMatch(MENU);
  });

  it('conv_mvnt4hjy2ox0jlq with the live reading: still "Who is this Corrective Action Form for?"', async () => {
    state.slotReading = "ca";
    const thread = new Thread();
    thread.replay("What does our policy say about attendance?", ATTENDANCE_ANSWER);
    const answer = await thread.say("smoking policy");
    expect(answer.content).toMatch(WHO_FOR);
  });

  it("requests make their card exactly as with the flag on", async () => {
    const thread = new Thread();
    thread.replay("What does our policy say about attendance?", ATTENDANCE_ANSWER);
    const card = await thread.say("can you create a CA for Test Employee for opening the salon late on 10-20-26?");
    expect(card.formProposal?.templateKey).toBe("dpoa");
  });
});
