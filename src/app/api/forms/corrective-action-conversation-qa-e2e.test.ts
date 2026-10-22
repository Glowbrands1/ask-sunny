import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * CORRECTIVE ACTION CONVERSATIONS — QA, 22 OCT 2026
 * ============================================================================
 *
 * Multi-turn conversations replayed through the handlers the chat route tries,
 * in the order it tries them (correction, policy change, redraft, revision,
 * then the proposal flow), with the browser's own reading of the history for
 * which card continues and which form is open — so a reload, which rebuilds
 * the history from what was stored, is replayed exactly. Every check is made
 * on the SAVED form, read back through the review route.
 *
 * Only identity, the model, the knowledge provider, the employee directory
 * read and the database are stand-ins. Every person is synthetic.
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
  /** What the drafting model returns. */
  draft: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown> },
  /** What the drafting model was given, per call: its system prompt and messages. */
  modelNotes: [] as string[],
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
      create: async (request: { system?: unknown; messages?: unknown[] }) => {
        state.modelNotes.push(JSON.stringify([request.system ?? null, request.messages ?? []]));
        return {
          content: [{ type: "tool_use", name: "write_form_fields", input: state.draft }],
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
    // A healthy Performance Management Framework, so the governed draft runs.
    async fetchRoleGrounding() {
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

/*
 * THE DIRECTORY READ IS FAKED; ITS SCOPING IS NOT — see
 * `coaching-feedback-e2e.test.ts`.
 */
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
const instanceRoute = await import("./instances/[id]/route");
const draftRoute = await import("./instances/[id]/draft/route");
const { continuationFor, activeFormInstanceFor } = await import("@/lib/forms/proposal-continuation");
const { correctActiveForm } = await import("@/lib/forms/chat-correction");
const { changeActiveFormPolicy } = await import("@/lib/forms/chat-policy-change");
const { redraftActiveForm } = await import("@/lib/forms/chat-redraft");
const { reviseActiveForm } = await import("@/lib/forms/chat-revision");

/** The view's join, which the fake does not model — see `exit-form-e2e.test.ts`. */
function joinOverview() {
  for (const row of store.form_instances ?? []) {
    const template = store.form_templates!.find((entry) => entry.id === row.template_id);
    const version = store.form_template_versions.find((entry) => entry.id === row.template_version_id);
    Object.assign(row, {
      form_date: row.form_date ?? "2026-10-21",
      template_key: template?.key,
      template_name: template?.name,
      layout_family: template?.layout_family,
      template_version: version?.version,
    });
  }
}

const requests: { url: string; body: Record<string, unknown> }[] = [];

/** The browser's `formsFetch`, dispatched straight into the route handlers. */
async function call<T>(url: string, init?: RequestInit): Promise<T> {
  requests.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
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

async function review(id: string) {
  joinOverview();
  const response = await instanceRoute.GET(new Request(`https://app.test/api/forms/instances/${id}`), {
    params: Promise.resolve({ id }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    instance: Record<string, unknown>;
    values: {
      fieldKey: string;
      value: string | null;
      checked: string[];
      filledBy: string;
      provenance?: Record<string, unknown>;
    }[];
  };
}


let sequence = 0;
const said = (content: string): ChatMessage => ({
  id: `m${(sequence += 1)}`,
  role: "user",
  content,
  createdAt: "2026-10-21T15:00:00Z",
});


/* Synthetic people only. */
const DIRECTORY = [
  { id: "e-1", firstName: "Remy", lastName: "Calder", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0310"] },
  { id: "e-2", firstName: "Tess", lastName: "Varga", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0310"] },
];

/*
 * THE MANUAL AS THE KNOWLEDGE BASE HOLDS IT: each section on the sheet it is
 * printed on, with the page the manual prints. Wording shortened, never
 * reworded, except the last sentence under Late Opening, which stands in for
 * its "$25.00 via payroll deduction".
 */
const STANDARDS_OF_CONDUCT_CHUNK = {
  chunkIndex: 30,
  page: 13,
  printedPage: 12,
  sections: [{ heading: "Standards of Conduct", page: 12 }],
  section: "Standards of Conduct",
  content:
    "12 | P a g e\nStandards of Conduct\nThe Company expects Employees to follow rules of conduct that will protect the interests and\nsafety of all clients, Employees, and The Company.\nThe following are examples (non-inclusive list) of infractions that may result in disciplinary\naction:\no Failing to follow the policies and procedures of The Company\no Failure to complete assigned work or required tasks by the deadline\no Register / Bank shortages",
};

const ATTENDANCE_CHUNK = {
  chunkIndex: 33,
  page: 15,
  printedPage: 14,
  sections: [{ heading: "Attendance", page: 14 }],
  section: "Attendance",
  content:
    "14 | P a g e\nAttendance\nIt is the responsibility of each employee to know his or her work schedule and to always be on\ntime.",
};

const VISITORS_CHUNK = {
  chunkIndex: 64,
  page: 31,
  printedPage: 30,
  sections: [{ heading: "Visitors in the Workplace", page: 30 }],
  section: "Visitors in the Workplace",
  content:
    "30 | P a g e\nVisitors in the Workplace\nTo provide for the safety and security of Employees and the facilities, only authorized visitors are\nallowed in the workplace. If the Employee is uncomfortable with allowing the visitor into the\nworkplace, the Supervisor or manager on duty must refuse to allow the visitor into the\nworkplace.",
};

const LATE_OPENING_CHUNK = {
  chunkIndex: 34,
  page: 16,
  printedPage: 15,
  sections: [{ heading: "Late Opening", page: 15 }],
  section: "Late Opening",
  content:
    "15 | P a g e\nLate Opening\nWhen an employee assigned to open a location is unable to open the location at the proper\ntime, the employee must notify the manager as soon as possible. The employee will reimburse The\nCompany $25.00 via payroll deduction.",
};

const CELL_PHONE_CHUNK = {
  chunkIndex: 43,
  page: 20,
  printedPage: 19,
  sections: [{ heading: "Cell Phone/Smart Watch Policy", page: 19 }],
  section: "Cell Phone/Smart Watch Policy",
  content:
    "19 | P a g e\nCell Phone/Smart Watch Policy\nPersonal Employee cell phones are permitted in the workplace but must be kept out of sight. It\nis the Employee's personal responsibility to protect the client's experience.",
};

/* Real headings an account's ordinary words also say: never cited unasked. */
const PAYROLL_DEDUCTIONS_CHUNK = {
  chunkIndex: 100,
  page: 40,
  printedPage: 39,
  sections: [{ heading: "Payroll Deductions", page: 39 }],
  section: "Payroll Deductions",
  content: "39 | P a g e\nPayroll Deductions\nDeductions from an employee's pay are made only as required by law.",
};

const MANUAL = {
  chunks: [
    STANDARDS_OF_CONDUCT_CHUNK,
    ATTENDANCE_CHUNK,
    LATE_OPENING_CHUNK,
    CELL_PHONE_CHUNK,
    VISITORS_CHUNK,
    PAYROLL_DEDUCTIONS_CHUNK,
  ],
};

/* HR, 21 Oct 2026: the production request, name replaced. */
const E1 =
  "create a written CA for tess varga for not attending the monthly meeting on 10-20-26. previous coaching: jba policy manual 1-1-26, verbal ca 9-1-26. payroll deduct not applicable";

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  requests.length = 0;
  state.role = "salon_director";
  state.scope = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: [] };
  state.draft = { values: {}, checked: {} };
  state.modelNotes = [];
  state.manual = MANUAL;
  state.directory = DIRECTORY;
  sequence = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T15:00:00Z"));
  await ensureTemplateLibrary("system");
});

/* ------------------------------------------------------------ the chat -- */

const TODAY = "2026-10-21";

/**
 * One conversation, as the chat surface holds it. `say` answers a turn the way
 * the chat route does: an open form (read from the history, as the browser
 * reads it) is tried first by the in-place handlers; anything else is the
 * proposal flow, continuing the card the history shows. `create` presses the
 * card's Create draft button; `reload` rebuilds the history from what was
 * stored, as a refresh does.
 */
class Chat {
  messages: ChatMessage[] = [];

  async say(text: string): Promise<string> {
    const message = said(text);
    const history = this.messages;
    const active = activeFormInstanceFor(history);
    let answer: { content: string; formProposal?: unknown } | null = null;
    if (active) {
      const request = () => new Request("https://app.test/api/chat", { method: "POST", headers: { cookie: "session=abc" } });
      const base = { instanceId: active, question: text, history };
      answer =
        (await correctActiveForm({ ...base, request: request(), today: TODAY })) ??
        (await changeActiveFormPolicy({ ...base, request: request() })) ??
        (await redraftActiveForm({ ...base, request: request() })) ??
        (await reviseActiveForm({ ...base, request: request(), today: TODAY }));
    }
    if (!answer) {
      const continued = continuationFor(history)?.templateKey;
      answer = await proposeFormForTurn({
        history,
        question: text,
        questionMessageId: message.id,
        actor: { role: state.role as never, scope: state.scope as AccessScope },
        summaries: await listTemplateSummaries(),
        today: TODAY,
        policyManual: async () => (state.manual?.chunks as never) ?? null,
        ...(continued ? { continueTemplateKey: continued } : {}),
      });
    }
    expect(answer, `turn went unanswered by every form path: ${JSON.stringify(text)}`).not.toBeNull();
    this.messages.push(message, {
      id: `a${sequence}`,
      role: "assistant",
      content: answer!.content,
      createdAt: "2026-10-21T15:00:01Z",
      ...(answer!.formProposal ? { formProposal: answer!.formProposal } : {}),
    } as ChatMessage);
    return answer!.content;
  }

  /** The card on screen, as the last assistant message carrying one. */
  get card() {
    const holder = [...this.messages].reverse().find((entry) => entry.role === "assistant" && entry.formProposal);
    return holder?.formProposal ?? null;
  }

  async create(): Promise<string> {
    const holder = [...this.messages].reverse().find((entry) => entry.role === "assistant" && entry.formProposal)!;
    const { reference } = await createInlineForm({
      proposal: holder.formProposal!,
      messages: this.messages,
      call,
      onCreated: (ref) => {
        holder.formInstanceRef = ref;
      },
    });
    holder.formInstanceRef = reference;
    return reference.instanceId;
  }

  reload() {
    this.messages = JSON.parse(JSON.stringify(this.messages)) as ChatMessage[];
  }
}

/** The saved form, field by field: a value, or the boxes ticked. */
async function saved(id: string): Promise<Record<string, string | string[]>> {
  const form = await review(id);
  const out: Record<string, string | string[]> = {};
  for (const entry of form.values) {
    if (entry.checked.length > 0) out[entry.fieldKey] = entry.checked;
    else if ((entry.value ?? "").trim() !== "") out[entry.fieldKey] = entry.value!;
  }
  return out;
}

/* The manual as the knowledge base holds it, with the two sentences the 21 Oct incident turns on. */
const ATTENDANCE_WITH_MEETINGS_CHUNK = {
  ...ATTENDANCE_CHUNK,
  content: `${ATTENDANCE_CHUNK.content}\no If an employee is going to be tardy or absent, it is mandatory that the employee call and speak to their direct manager on duty.\no Seminars/Meetings/ Training sessions are considered scheduled shifts. (See Seminar/Webinar\nAttendance section)`,
};
const SEMINAR_CHUNK = {
  chunkIndex: 123,
  chunkId: "c-123",
  locator: "Page 37",
  page: 38,
  printedPage: 37,
  sections: [{ heading: "Seminar/Webinar Attendance", page: 37 }],
  section: "Seminar/Webinar Attendance",
  content:
    "Seminar/Webinar Attendance\nIf you are enrolled in a seminar/webinar and do not attend the seminar without notifying your\nSupervisor, it is considered a no call no show to a scheduled shift.",
};
const FULL_MANUAL = {
  chunks: [STANDARDS_OF_CONDUCT_CHUNK, ATTENDANCE_WITH_MEETINGS_CHUNK, LATE_OPENING_CHUNK, CELL_PHONE_CHUNK, VISITORS_CHUNK, SEMINAR_CHUNK],
};


/** The manager typing into the open form and saving, as the inline editor does. */
async function managerSaves(id: string, body: { values?: Record<string, string>; checked?: Record<string, string[]> }) {
  const response = await instanceRoute.PATCH(
    new Request(`https://app.test/api/forms/instances/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
  expect(response.status).toBe(200);
}

/** What the drafting model returns, for a draft that has to be written from the account. */
const MODEL = (observation: string, offense = "standards_of_conduct"): typeof state.draft => ({
  values: { observation: `Observed:\n${observation}` },
  checked: { offense_type: [offense] },
});

/** Every value on the form, to check that nothing anywhere says what nobody said. */
const everything = (form: Record<string, string | string[]>) => JSON.stringify(form);

/* The 21 Oct production turns, synthetic name. */
const OCT21 = E1;
const OCT21_WITHOUT_LEVEL =
  "create a CA for tess varga for not attending the monthly meeting on 10-20-26. previous coaching: jba policy manual 1-1-26, verbal ca 9-1-26";

const BOTH_PRIOR_ACTIONS = "Coaching — JBA Policy Manual — signed 01/01/2026\nVerbal corrective action — signed 09/01/2026";

beforeEach(() => {
  state.manual = FULL_MANUAL;
});

/* ========================================================================= */
/* 1, 3 — EVERY TURN IS KEPT; A ONE-WORD ANSWER ERASES NOTHING                */
/* ========================================================================= */

describe("Q1 the original 21 Oct request, as typed", () => {
  it("is one complete draft: level, history, payroll, the incident's date, and the policy the manual puts it under", async () => {
    const chat = new Chat();
    const reply = await chat.say(OCT21);
    expect(reply).toMatch(/\*\*Type of Warning:\*\* Written Warning, as you said/);
    expect(reply).toMatch(/\*\*Policy:\*\* \"missed the monthly meeting\" reads as the policy manual's \*\*Attendance\*\*/);
    expect(reply).not.toMatch(/Which policy applies|warning level on the form|more than one date/);
    expect(reply).not.toMatch(/no call|no show/i);

    state.draft = MODEL("Tess Varga did not attend the scheduled monthly meeting on October 20, 2026.");
    const form = await saved(await chat.create());

    expect(form).toMatchObject({
      employee_name: "Tess Varga",
      form_date: "2026-10-20",
      warning_type: ["written"],
      payroll_deduct: ["no"],
      prior_actions: BOTH_PRIOR_ACTIONS,
      offense_type: ["absenteeism"],
      policy_violated: "Absenteeism",
    });
    expect(form.policy_language).toContain("Seminars/Meetings/ Training sessions are considered scheduled shifts.");
    expect(form.policy_language).toContain("Source: JBA Policy Manual — Attendance, p. 14");
    expect(form.action_plan).toMatch(/^Management will review the Attendance policy with Tess\./);
    expect(Object.keys(form).some((key) => /signature/i.test(key))).toBe(false);
    expect(store.form_instances).toHaveLength(1);
  });
});

describe("Q2 the production failure's shape: the level asked, then one-word answers", () => {
  it('"written", then "no", keep the account, the history and the date', async () => {
    const chat = new Chat();
    expect(await chat.say(OCT21_WITHOUT_LEVEL)).toMatch(/verbal\/written warning level on the form/);
    expect(await chat.say("written")).toMatch(/\*\*Type of Warning:\*\* Written Warning, as you said/);
    const last = await chat.say("no");
    expect(last).toMatch(/\*\*Prior actions:\*\* Coaching — JBA Policy Manual — signed 01\/01\/2026; Verbal corrective action — signed 09\/01\/2026/);
    expect(last).toMatch(/Is payroll deduct applicable\? \*\*No\*\*/);

    state.draft = MODEL("Tess Varga did not attend the monthly meeting on October 20, 2026.");
    const form = await saved(await chat.create());
    expect(form).toMatchObject({
      form_date: "2026-10-20",
      warning_type: ["written"],
      payroll_deduct: ["no"],
      prior_actions: BOTH_PRIOR_ACTIONS,
      offense_type: ["absenteeism"],
    });
    expect(form.observation).toContain("did not attend the monthly meeting");
  });

  it("a reload mid-intake, and the same answer twice, lose nothing and add nothing", async () => {
    const chat = new Chat();
    await chat.say(OCT21_WITHOUT_LEVEL);
    await chat.say("written");
    chat.reload();
    await chat.say("written");
    await chat.say("no payroll deduct");
    await chat.say("no payroll deduct");
    const form = await saved(await chat.create());
    expect(form).toMatchObject({ warning_type: ["written"], payroll_deduct: ["no"], prior_actions: BOTH_PRIOR_ACTIONS });
    expect(store.form_instances).toHaveLength(1);
  });
});

/* ========================================================================= */
/* 3, 4 — ASKED ONLY WHEN NEEDED; NOTHING UNSAID IS FILLED                    */
/* ========================================================================= */

describe("Q3 where the manual does not settle the policy", () => {
  beforeEach(() => {
    // The manual as the older fixtures hold it: its Attendance section says nothing about meetings.
    state.manual = MANUAL;
  });

  it("asks once; answered in chat before the draft, the answer fills the form", async () => {
    const chat = new Chat();
    expect(await chat.say(OCT21)).toMatch(/\*\*Which policy applies\?\*\* Missing the monthly meeting could fall under \*\*Attendance\*\*/);
    expect(await chat.say("attendance")).not.toMatch(/Which policy applies/);
    state.draft = MODEL("Tess Varga did not attend the monthly meeting on October 20, 2026.");
    const form = await saved(await chat.create());
    expect(form).toMatchObject({ offense_type: ["absenteeism"], policy_violated: "Absenteeism", prior_actions: BOTH_PRIOR_ACTIONS });
    expect(form.policy_language).toContain("Source: JBA Policy Manual — Attendance, p. 14");
  });

  it("left unanswered, the draft ticks nothing and cites nothing — the model's pick is not saved", async () => {
    const chat = new Chat();
    await chat.say(OCT21);
    state.draft = MODEL("Tess Varga did not attend the monthly meeting on October 20, 2026.");
    const form = await saved(await chat.create());
    expect(form.offense_type).toBeUndefined();
    expect(form.policy_violated).toBeUndefined();
    expect(form.policy_language).toBeUndefined();
    expect(form.action_plan).toMatch(/^Management will review the applicable company policy with Tess\./);
    // Everything that WAS said is still there.
    expect(form).toMatchObject({ warning_type: ["written"], payroll_deduct: ["no"], prior_actions: BOTH_PRIOR_ACTIONS, form_date: "2026-10-20" });
  });

  it("answered after the draft exists, the open form is completed in place", async () => {
    const chat = new Chat();
    await chat.say(OCT21);
    state.draft = MODEL("Tess Varga did not attend the monthly meeting on October 20, 2026.");
    const id = await chat.create();
    const reply = await chat.say("attendance");
    expect(reply).toMatch(/Type of Offense now reads \*\*Absenteeism\*\*/);
    const form = await saved(id);
    expect(form).toMatchObject({
      offense_type: ["absenteeism"],
      policy_violated: "Absenteeism",
      warning_type: ["written"],
      payroll_deduct: ["no"],
      prior_actions: BOTH_PRIOR_ACTIONS,
    });
    expect(form.action_plan).toMatch(/^Management will review the Attendance policy with Tess\./);
    expect(store.form_instances).toHaveLength(1);
  });

  it("with no manual to read, it asks, cites nothing, and claims nothing about a policy", async () => {
    state.manual = null;
    const chat = new Chat();
    expect(await chat.say(OCT21)).toMatch(/Which policy applies\?/);
    state.draft = MODEL("Tess Varga did not attend the monthly meeting on October 20, 2026.");
    const form = await saved(await chat.create());
    expect(form.offense_type).toBeUndefined();
    expect(form.policy_language).toBeUndefined();
  });
});

describe("Q4 nothing the manager did not say is put on the form", () => {
  it("a name alone: no level, no history, no payroll answer, no policy, no account", async () => {
    const chat = new Chat();
    expect(await chat.say("create a CA for tess varga")).toMatch(/You haven't told me what happened yet/);
    state.draft = { values: {}, checked: { offense_type: ["standards_of_conduct"], warning_type: ["final"] } };
    const form = await saved(await chat.create());
    expect(form.offense_type).toBeUndefined();
    expect(form.policy_language).toBeUndefined();
    expect(form.policy_violated).toBeUndefined();
    expect(form.warning_type).toBeUndefined();
    expect(form.payroll_deduct).toBeUndefined();
    expect(form.prior_actions).toBeUndefined();
    expect(form.observation).toBeUndefined();
  });

  it("an account with no history, level or payroll answer: those stay open, and nothing says no call/no show", async () => {
    const chat = new Chat();
    const reply = await chat.say("create a CA for tess varga, she skipped the monthly meeting on 10-20-26");
    expect(reply).toMatch(/verbal\/written warning level/);
    expect(reply).toMatch(/Is payroll deduct applicable\?\*\* Yes or No/);
    state.draft = {
      values: {
        observation:
          "Observed:\nTess Varga skipped the monthly meeting on October 20, 2026. This was a no call/no show. She did not notify her manager.\n\nExpectation:\nAttend scheduled meetings.",
        prior_actions: "Verbal warning — signed 08/14/2026",
      },
      checked: { offense_type: ["standards_of_conduct"], warning_type: ["written"] },
    };
    const id = await chat.create();
    const form = await saved(id);
    /*
     * ASK SUNNY BY DESIGN: with no level stated, the performance-management
     * framework's suggested level is written and marked AI-filled for the
     * manager to confirm (`draft/route.ts`) — although the chat says it won't
     * guess. Left as designed pending a business decision (QA, 22 Oct 2026).
     */
    expect((await review(id)).values.find((entry) => entry.fieldKey === "warning_type")?.filledBy).toBe("ai");
    expect(form.payroll_deduct).toBeUndefined();
    expect(form.prior_actions).toBeUndefined();
    expect(form.observation).toContain("skipped the monthly meeting on October 20, 2026.");
    expect(everything(form)).not.toMatch(/no call\/no show|did not notify/i);
    expect(form.form_date).toBe("2026-10-20");
  });

  it("a no call/no show the manager DID report is kept", async () => {
    const chat = new Chat();
    await chat.say("create a written CA for tess varga. she was a no call no show to the monthly meeting on 10-20-26. no payroll deduct");
    state.draft = MODEL("Tess Varga was a no call/no show to the monthly meeting on October 20, 2026.");
    const form = await saved(await chat.create());
    expect(form.observation).toContain("was a no call/no show to the monthly meeting");
    expect(form.offense_type).toEqual(["absenteeism"]);
  });
});

/* ========================================================================= */
/* 6 — ATTENDANCE, AND SEMINAR/WEBINAR ATTENDANCE                             */
/* ========================================================================= */

describe("Q5 which attendance section a missed event rests on", () => {
  it("a monthly meeting is the Attendance section only — the seminar section is not cited for it", async () => {
    const chat = new Chat();
    await chat.say(OCT21);
    state.draft = MODEL("Tess Varga did not attend the monthly meeting on October 20, 2026.");
    const form = await saved(await chat.create());
    expect(form.policy_language).toContain("Source: JBA Policy Manual — Attendance, p. 14");
    expect(form.policy_language).not.toContain("Seminar/Webinar Attendance, p. 37");
  });

  it("a webinar cites its own section; the chat never calls it a no call/no show", async () => {
    const chat = new Chat();
    const reply = await chat.say("create a verbal CA for tess varga, she didn't log in to the required webinar on 10-20-26. no payroll deduct");
    expect(reply).toMatch(/\*\*Policy:\*\* "missed the required webinar" reads as the policy manual's \*\*Seminar\/Webinar Attendance\*\* \(page 37\)\. The manual's Attendance section \(page 14\) says "Seminars\/Meetings\/ Training sessions are considered scheduled shifts\."/);
    expect(reply).not.toMatch(/no call|no show/i);
    state.draft = MODEL("Tess Varga did not log in to the required webinar on October 20, 2026.");
    const form = await saved(await chat.create());
    expect(form.offense_type).toEqual(["absenteeism"]);
    expect(form.policy_violated).toBe("Absenteeism — Seminar/Webinar Attendance");
    expect(form.policy_language).toContain("Source: JBA Policy Manual — Seminar/Webinar Attendance, p. 37");
  });
});

/* ========================================================================= */
/* 7 — CORRECTIONS, BEFORE AND AFTER THE DRAFT                                */
/* ========================================================================= */

describe("Q6 corrections before the draft is created", () => {
  it("level, incident date and a prior action's date are each corrected, and nothing else moves", async () => {
    const chat = new Chat();
    await chat.say(OCT21);
    expect(await chat.say("actually make it verbal")).toMatch(/\*\*Type of Warning:\*\* Verbal Warning/);
    await chat.say("the meeting was actually on 10-19-26");
    expect(await chat.say("sorry, the verbal ca was on 9-2-26 not 9-1-26")).toMatch(
      /Verbal corrective action — signed 09\/02\/2026/,
    );
    // A turn after the correction keeps everything before it.
    expect(await chat.say("no payroll deduct")).toMatch(/Verbal corrective action — signed 09\/02\/2026/);
    expect(chat.card?.formDate).toBe("2026-10-19");
    state.draft = {
      ...MODEL("Tess Varga did not attend the monthly meeting on October 19, 2026."),
      values: {
        observation: "Observed:\nTess Varga did not attend the monthly meeting on October 19, 2026.",
        prior_actions: "Verbal corrective action — signed 09/01/2026",
      },
    };
    const form = await saved(await chat.create());
    expect(form).toMatchObject({
      form_date: "2026-10-19",
      warning_type: ["verbal"],
      payroll_deduct: ["no"],
      prior_actions: "Coaching — JBA Policy Manual — signed 01/01/2026\nVerbal corrective action — signed 09/02/2026",
      offense_type: ["absenteeism"],
    });
    expect(store.form_instances).toHaveLength(1);
  });
});

describe("Q7 corrections after the draft exists, on the same form", () => {
  it("Written → Verbal, a policy override and back, after a reload — every other field stands", async () => {
    const chat = new Chat();
    await chat.say(OCT21);
    state.draft = MODEL("Tess Varga did not attend the monthly meeting on October 20, 2026.");
    const id = await chat.create();
    const before = await saved(id);

    await chat.say("change it to a verbal warning");
    expect((await saved(id)).warning_type).toEqual(["verbal"]);
    chat.reload();
    expect(await chat.say("use the standards of conduct policy instead")).toMatch(/Type of Offense now reads \*\*Standards of Conduct\*\*/);
    let form = await saved(id);
    expect(form).toMatchObject({ warning_type: ["verbal"], offense_type: ["standards_of_conduct"], policy_violated: "Standards of Conduct" });
    expect(form.policy_language).toContain("Source: JBA Policy Manual — Standards of Conduct, p. 12");
    expect(form.action_plan).toMatch(/Standards of Conduct policy/);

    expect(await chat.say("actually it should be attendance")).toMatch(/Type of Offense now reads \*\*Absenteeism\*\*/);
    form = await saved(id);
    expect(form).toMatchObject({ offense_type: ["absenteeism"], policy_violated: "Absenteeism" });
    for (const key of ["employee_name", "form_date", "job_title", "location", "payroll_deduct", "observation", "prior_actions"]) {
      expect(form[key], key).toEqual(before[key]);
    }
    expect(store.form_instances).toHaveLength(1);
  });

  /*
   * NOT CHANGED FROM CHAT, BY DECISION. Once the form exists, its Date line is
   * edited on the form: the reference platform's rule for the Corrective
   * Action Form is that chat corrects only the payroll answer
   * (`config/company/forms/index.ts`). Pinned here so a change to that rule is
   * a decision, not an accident — and so nothing else on the form moves.
   */
  it("a date change typed after the draft exists leaves the form exactly as it was", async () => {
    const chat = new Chat();
    await chat.say(OCT21);
    state.draft = MODEL("Tess Varga did not attend the monthly meeting on October 20, 2026.");
    const id = await chat.create();
    const before = await saved(id);
    await chat.say("change the date to 10-19-26").catch(() => null);
    expect(await saved(id)).toEqual(before);
  });

  it("an offense the manager ticked by hand is theirs: a policy swap does not move it", async () => {
    const chat = new Chat();
    await chat.say(OCT21);
    state.draft = MODEL("Tess Varga did not attend the monthly meeting on October 20, 2026.");
    const id = await chat.create();
    await managerSaves(id, { checked: { offense_type: ["tardiness"] } });
    await chat.say("use the standards of conduct policy instead");
    expect((await saved(id)).offense_type).toEqual(["tardiness"]);
  });

  it('"make sure her attendance improves" is not a policy change', async () => {
    const chat = new Chat();
    await chat.say(OCT21);
    state.draft = MODEL("Tess Varga did not attend the monthly meeting on October 20, 2026.");
    const id = await chat.create();
    const before = await saved(id);
    await chat.say("make sure her attendance improves").catch(() => null);
    expect(await saved(id)).toEqual(before);
  });
});

/* ========================================================================= */
/* 8 — RELOADS, REOPENING, REPEATS                                            */
/* ========================================================================= */

describe("Q8 the draft survives reloads, reopening and repeats", () => {
  it("reopened twice reads the same; a repeated answer after a reload changes nothing; a second press of Create makes no second form", async () => {
    const chat = new Chat();
    await chat.say(OCT21);
    state.draft = MODEL("Tess Varga did not attend the monthly meeting on October 20, 2026.");
    const id = await chat.create();
    const first = await saved(id);
    chat.reload();
    expect(await saved(id)).toEqual(first);
    /* No form path in Ask Sunny answers a bare repeat of the level once the form exists; it reaches ordinary chat, and the form is untouched. */
    await chat.say("written").catch(() => null);
    expect(await saved(id)).toEqual(first);
    await chat.create().catch(() => null);
    expect(store.form_instances).toHaveLength(1);
  });

  it("a redraft keeps what the manager typed", async () => {
    const chat = new Chat();
    await chat.say(OCT21);
    state.draft = MODEL("Tess Varga did not attend the monthly meeting on October 20, 2026.");
    const id = await chat.create();
    await managerSaves(id, { values: { observation: "Observed:\nTess was not at the 10/20 monthly meeting. I typed this." } });
    state.draft = MODEL("Something the model wrote instead.");
    await call(`/api/forms/instances/${id}/draft`, {
      method: "POST",
      body: JSON.stringify({ notes: OCT21, keepManagerValues: true }),
    });
    const form = await saved(id);
    expect(form.observation).toBe("Observed:\nTess was not at the 10/20 monthly meeting. I typed this.");
    expect(form).toMatchObject({ warning_type: ["written"], prior_actions: BOTH_PRIOR_ACTIONS, offense_type: ["absenteeism"] });
  });
});

/* ========================================================================= */
/* 2 — WORDING NOBODY WROTE A RULE FOR, END TO END                            */
/* ========================================================================= */

describe("Q9 the same situation in other words reaches the same saved form", () => {
  it.each([
    "create a written CA for tess varga, she was a no-show at the all-staff on 10/20. no payroll deduct",
    "written CA for tess varga - she didn't make it to the monthly mtg on 10-20-26, no payroll deduct",
    "tess varga needs a written CA. monthly meeting 10-20-26, which she skipped. payroll deduct not applicable",
  ])("%s", async (request) => {
    const chat = new Chat();
    const reply = await chat.say(request);
    expect(reply).toMatch(/reads as the policy manual's \*\*Attendance\*\*/);
    state.draft = MODEL("Tess Varga did not attend the meeting on October 20, 2026.");
    const form = await saved(await chat.create());
    expect(form).toMatchObject({ warning_type: ["written"], payroll_deduct: ["no"], offense_type: ["absenteeism"], form_date: "2026-10-20" });
  });

  it("the meeting as the setting of something else is not an absence: on her phone during it is the Cell Phone policy", async () => {
    const chat = new Chat();
    const reply = await chat.say("create a verbal CA for tess varga, she was on her phone during the monthly meeting on 10-20-26. no payroll deduct");
    expect(reply).not.toMatch(/Attendance/);
    expect(reply).toMatch(/Cell Phone\/Smart Watch Policy/);
  });
});
