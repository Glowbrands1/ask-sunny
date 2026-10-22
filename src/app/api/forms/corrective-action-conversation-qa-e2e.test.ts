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
  /** How the manual was found: "tag" is an owner's confirmation; "fallback" is by its name, as in production today. */
  manualMatchedBy: "fallback" as "tag" | "fallback",
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
        documentTitle: "JBA Policy Manual Edited 5.2025",
        documentCategory: "policies_compliance",
        matchedBy: state.manualMatchedBy,
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
  state.manualMatchedBy = "fallback";
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
        policyManualIdentity: async () =>
          state.manual ? { title: "JBA Policy Manual", confirmed: state.manualMatchedBy === "tag" } : null,
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
    expect(reply).not.toMatch(/Which policy applies|Verbal or Written\?|more than one date/);
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
    expect(await chat.say(OCT21_WITHOUT_LEVEL)).toMatch(/\*\*Type of Warning:\*\* Verbal or Written\?/);
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
    expect(reply).toMatch(/\*\*Type of Warning:\*\* Verbal or Written\?/);
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

/* ========================================================================= */
/* QA ROUND 2 — 22 OCT 2026: wording, follow-ups, dates, the level, duplicates */
/* ========================================================================= */

/*
 * The overview view's join, as rows are written: a draft opened in the middle
 * of a chat turn (a correction to a finalized form) is read back in that same
 * turn, as the view returns it in production.
 */
beforeEach(() => {
  const rows: Record<string, unknown>[] = [];
  const push = rows.push.bind(rows);
  rows.push = (...added: Record<string, unknown>[]) => {
    const length = push(...added);
    joinOverview();
    return length;
  };
  store.form_instances = rows as never;
});

/** Pressing Finalize on the form card. */
async function finalize(id: string, extra: Record<string, unknown> = {}) {
  joinOverview();
  const response = await instanceRoute.POST(
    new Request(`https://app.test/api/forms/instances/${id}`, {
      method: "POST",
      body: JSON.stringify({ action: "finalize", followUpDate: null, ...extra }),
    }),
    { params: Promise.resolve({ id }) },
  );
  return { status: response.status, body: (await response.json()) as { error?: string; code?: string; instance?: { id: string } } };
}

/** The record's own audit trail. */
const eventsOf = (id: string) =>
  (store.form_instance_events ?? []).filter((event) => event.instance_id === id) as {
    kind: string;
    actor: string;
    detail: Record<string, unknown>;
    created_at?: string;
  }[];

const rowOf = (id: string) => (store.form_instances ?? []).find((row) => row.id === id) as Record<string, unknown>;

const valueRow = async (id: string, key: string) => (await review(id)).values.find((entry) => entry.fieldKey === key);

const OCT21_NO_HISTORY =
  "create a written CA for tess varga for not attending the monthly meeting on 10-20-26. payroll deduct not applicable";
const DATED_ACCOUNT = "Observed:\nTess Varga did not attend the monthly meeting on October 20, 2026.";

describe("Q10 request wording nobody wrote a rule for reaches the same saved form", () => {
  it.each([
    "Write up Tess Varga for missing the monthly meeting on 10-20-26. Written. No payroll deduct.",
    "Written CA for Tess Varga: missed the monthly meeting 10-20-26. no payroll deduct",
    "Tess Varga skipped the monthly meeting on 10-20-26 and nobody heard from her. Can you make a written CA? No payroll deduct.",
    "Tess Varga no-showed the 10/20 all-staff. Need a written CA, no payroll deduct.",
    "could you do a written CA on tess varga — she ditched the 10/20 team meeting. payroll deduct n/a",
    "tess varga wasn't at our monthly mtg on 10-20-26. she needs a written CA. no payroll deduct",
  ])("%s", async (request) => {
    const chat = new Chat();
    const reply = await chat.say(request);
    expect(reply).toMatch(/I'll draft a \*\*Corrective Action Form\*\* for \*\*Tess Varga\*\*/);
    expect(reply).not.toMatch(/Which form|haven't told me what happened/);
    state.draft = MODEL("Tess Varga did not attend the meeting on October 20, 2026.");
    const form = await saved(await chat.create());
    expect(form).toMatchObject({ warning_type: ["written"], payroll_deduct: ["no"], offense_type: ["absenteeism"], form_date: "2026-10-20" });
    expect(form.observation).toContain("did not attend");
  });

  it("the account before the request: \"Tess Varga missed the deadline. Create a verbal CA for her.\"", async () => {
    const chat = new Chat();
    const reply = await chat.say("Tess Varga missed the deadline. Create a verbal CA for her.");
    expect(reply).not.toMatch(/haven't told me what happened/);
    expect(chat.card?.awaitingIncident ?? false).toBe(false);
    expect(chat.card?.warningLevel).toBe("verbal");
  });
});

describe("Q11 prior coaching given as a follow-up", () => {
  it("before the draft: read back, and on the saved form", async () => {
    const chat = new Chat();
    await chat.say(OCT21_NO_HISTORY);
    expect(await chat.say("prior coaching: jba policy manual 1-1-26, verbal ca 9-1-26")).toMatch(
      /\*\*Prior actions:\*\* Coaching — JBA Policy Manual — signed 01\/01\/2026; Verbal corrective action — signed 09\/01\/2026/,
    );
    state.draft = MODEL("Tess Varga did not attend the monthly meeting.");
    const form = await saved(await chat.create());
    expect(form.prior_actions).toBe(BOTH_PRIOR_ACTIONS);
    expect(form).toMatchObject({ warning_type: ["written"], payroll_deduct: ["no"], form_date: "2026-10-20" });
  });

  it("after the draft: added to the open form, in date order, never twice, and recorded", async () => {
    const chat = new Chat();
    await chat.say(OCT21_NO_HISTORY);
    state.draft = MODEL("Tess Varga did not attend the monthly meeting.");
    const id = await chat.create();
    const before = await saved(id);
    expect(before.prior_actions).toBeUndefined();

    expect(await chat.say("prior coaching: jba policy manual 1-1-26, verbal ca 9-1-26")).toMatch(/added "Coaching — JBA Policy Manual — signed 01\/01\/2026"/);
    chat.reload();
    await chat.say("she was also coached on 9/15 about attendance");
    await chat.say("prior coaching: jba policy manual 1-1-26, verbal ca 9-1-26");
    const form = await saved(id);
    expect(form.prior_actions).toBe(
      "Coaching — JBA Policy Manual — signed 01/01/2026\nVerbal corrective action — signed 09/01/2026\nCoaching about attendance — signed 09/15/2026",
    );
    for (const key of ["warning_type", "payroll_deduct", "observation", "form_date", "offense_type"]) expect(form[key], key).toEqual(before[key]);
    const recorded = eventsOf(id).filter((event) => event.detail.via === "chat_correction");
    expect(recorded).toHaveLength(2);
    expect(recorded[0]!.actor).toBe("manager-1");
    expect(store.form_instances).toHaveLength(1);
  });
});

describe("Q12 dates corrected after the draft exists", () => {
  async function opened(observation = DATED_ACCOUNT) {
    const chat = new Chat();
    await chat.say(OCT21);
    state.draft = { values: { observation }, checked: { offense_type: ["standards_of_conduct"] } };
    const id = await chat.create();
    return { chat, id };
  }

  it("the incident's date: the Date line and the drafted account move together, the row follows, and it is recorded", async () => {
    const { chat, id } = await opened();
    const before = await saved(id);
    const reply = await chat.say("the meeting was actually on 10-19-26");
    expect(reply).toMatch(/Updated the \*\*Corrective Action Form\*\* for \*\*Tess Varga\*\*: Date → 10\/19\/2026/);
    const form = await saved(id);
    expect(form.form_date).toBe("2026-10-19");
    expect(form.observation).toBe("Observed:\nTess Varga did not attend the monthly meeting on October 19, 2026.");
    expect(rowOf(id).form_date).toBe("2026-10-19");
    for (const key of ["warning_type", "payroll_deduct", "prior_actions", "offense_type", "policy_language", "action_plan"]) {
      expect(form[key], key).toEqual(before[key]);
    }
    const recorded = eventsOf(id).find((event) => event.detail.via === "chat_correction")!;
    expect(recorded.actor).toBe("manager-1");
    expect(recorded.created_at).toBeTruthy();
    expect(recorded.detail.changes).toEqual([
      { field: "form_date", from: "2026-10-20", to: "2026-10-19" },
      { field: "observation", from: DATED_ACCOUNT, to: "Observed:\nTess Varga did not attend the monthly meeting on October 19, 2026." },
    ]);
  });

  it("the form's Date line only, when that is what is named", async () => {
    const { chat, id } = await opened();
    await chat.say("change the form date to 10-21-26");
    const form = await saved(id);
    expect(form.form_date).toBe("2026-10-21");
    expect(form.observation).toBe(DATED_ACCOUNT);
  });

  it("asks which date when it cannot tell, writes nothing, then applies the answer", async () => {
    const { chat, id } = await opened();
    const before = await saved(id);
    expect(await chat.say("change the date to 10-19-26")).toMatch(/Which date is \*\*10\/19\/2026\*\*/);
    expect(await saved(id)).toEqual(before);
    chat.reload();
    await chat.say("the incident");
    const form = await saved(id);
    expect(form.form_date).toBe("2026-10-19");
    expect(form.observation).toContain("October 19, 2026");
  });

  it("a prior action's date, and only that line", async () => {
    const { chat, id } = await opened();
    const level = await valueRow(id, "warning_type");
    await chat.say("the verbal ca was 9-2-26, not 9-1-26");
    const form = await saved(id);
    // A prior action's date is history: the form's own level is neither changed nor confirmed by it.
    expect(await valueRow(id, "warning_type")).toEqual(level);
    expect(eventsOf(id).some((event) => event.detail.via === "chat_confirmation")).toBe(false);
    expect(form.prior_actions).toBe("Coaching — JBA Policy Manual — signed 01/01/2026\nVerbal corrective action — signed 09/02/2026");
    expect(form.form_date).toBe("2026-10-20");
  });

  it("the same correction twice changes nothing the second time and records nothing more", async () => {
    const { chat, id } = await opened();
    await chat.say("the meeting was actually on 10-19-26");
    const recorded = eventsOf(id).length;
    expect(await chat.say("the meeting was actually on 10-19-26")).toMatch(/already has 10\/19\/2026|Nothing needed changing/);
    expect(eventsOf(id)).toHaveLength(recorded);
  });

  it("the manager's own wording is never rewritten; the reply says what still names the old date", async () => {
    const { chat, id } = await opened();
    await managerSaves(id, { values: { observation: "Tess was not at the meeting on 10/20/2026. I typed this." } });
    const reply = await chat.say("the meeting was actually on 10-19-26");
    expect(reply).toMatch(/The account you wrote still says 10\/20\/2026/);
    const form = await saved(id);
    expect(form.form_date).toBe("2026-10-19");
    expect(form.observation).toBe("Tess was not at the meeting on 10/20/2026. I typed this.");
  });

  it("a later redraft keeps the corrected dates", async () => {
    const { chat, id } = await opened();
    await chat.say("the meeting was actually on 10-19-26");
    state.draft = MODEL("Tess Varga did not attend the monthly meeting on October 20, 2026.");
    await call(`/api/forms/instances/${id}/draft`, { method: "POST", body: JSON.stringify({ notes: OCT21, keepManagerValues: true }) });
    const form = await saved(id);
    expect(form.form_date).toBe("2026-10-19");
    expect(form.observation).toContain("October 19, 2026");
  });

  it("a finalized form is never changed in place: the correction lands on a new draft of it", async () => {
    const { chat, id } = await opened();
    expect((await finalize(id)).status).toBe(200);
    const reply = await chat.say("the meeting was actually on 10-19-26");
    expect(reply).toMatch(/was finalized, so I opened a new draft of it/);
    expect(rowOf(id).status).toBe("finalized");
    expect((await saved(id)).form_date).toBe("2026-10-20");
    const draft = (store.form_instances ?? []).find((row) => row.id !== id && row.status === "draft")!;
    expect((await saved(String(draft.id))).form_date).toBe("2026-10-19");
  });
});

describe("Q14 the warning level: a suggestion is never the manager's decision", () => {
  it("Finalize is never blocked by the level, and a suggestion stays the assistant's when it is filed (owner, 22 Oct 2026)", async () => {
    const chat = new Chat();
    await chat.say("create a CA for tess varga for not attending the monthly meeting on 10-20-26. no payroll deduct");
    state.draft = MODEL("Tess Varga did not attend the monthly meeting on October 20, 2026.");
    const blank = await chat.create();
    expect((await finalize(blank)).status).toBe(200);
    expect((await saved(blank)).warning_type).toBeUndefined();

    const other = new Chat();
    await other.say("create a CA for tess varga for being late on 10-21-26. no payroll deduct");
    const suggested = await other.create();
    const { applyAssistantDraft } = await import("@/lib/forms/instances");
    await applyAssistantDraft(suggested, { values: {}, checked: { warning_type: ["written"] } }, "assistant");
    expect((await finalize(suggested)).status).toBe(200);
    expect(await valueRow(suggested, "warning_type")).toMatchObject({ checked: ["written"], filledBy: "ai" });
  });

  it("the manager's confirmation or change is recorded as theirs, and not asked again", async () => {
    const chat = new Chat();
    await chat.say("create a CA for tess varga for not attending the monthly meeting on 10-20-26. no payroll deduct");
    state.draft = MODEL("Tess Varga did not attend the monthly meeting on October 20, 2026.");
    const id = await chat.create();
    // The assistant's own tick (a suggestion) is still not the manager's.
    const { applyAssistantDraft } = await import("@/lib/forms/instances");
    await applyAssistantDraft(id, { values: {}, checked: { warning_type: ["written"] } }, "assistant");
    expect((await valueRow(id, "warning_type"))?.filledBy).toBe("ai");

    expect(await chat.say("confirm the written warning")).toMatch(/Confirmed \*\*Written Warning\*\* as your decision/);
    const level = await valueRow(id, "warning_type");
    expect(level).toMatchObject({ checked: ["written"], filledBy: "manager" });
    expect(level?.provenance).toMatchObject({ source: "manager_confirmation", suggested: ["written"] });
    expect(eventsOf(id).some((event) => event.detail.via === "chat_confirmation")).toBe(true);

    const events = eventsOf(id).length;
    expect(await chat.say("confirm the written warning")).toMatch(/already confirmed/);
    expect(eventsOf(id)).toHaveLength(events);

    expect(await chat.say("make it a verbal instead")).toMatch(/Verbal Warning/);
    expect(await valueRow(id, "warning_type")).toMatchObject({ checked: ["verbal"], filledBy: "manager" });
    expect((await saved(id)).payroll_deduct).toEqual(["no"]);
    expect((await finalize(id)).status).toBe(200);
  });

  it("a level stated in the request is the manager's, and files", async () => {
    const chat = new Chat();
    await chat.say(OCT21);
    state.draft = MODEL("Tess Varga did not attend the monthly meeting on October 20, 2026.");
    const id = await chat.create();
    expect((await finalize(id)).status).toBe(200);
  });
});

describe("Q15 duplicate Create presses make one record", () => {
  it("two presses at once: one form, both told its id, drafted once", async () => {
    const chat = new Chat();
    await chat.say(OCT21);
    state.draft = MODEL("Tess Varga did not attend the monthly meeting on October 20, 2026.");
    const [first, second] = await Promise.all([chat.create(), chat.create()]);
    expect(first).toBe(second);
    expect(store.form_instances).toHaveLength(1);
    expect(eventsOf(first).filter((event) => event.kind === "created")).toHaveLength(1);
  });

  it("a press after a reload returns the same draft and leaves the manager's edits alone", async () => {
    const chat = new Chat();
    await chat.say(OCT21);
    state.draft = MODEL("Tess Varga did not attend the monthly meeting on October 20, 2026.");
    const id = await chat.create();
    await managerSaves(id, { values: { observation: "Edited by me." } });
    chat.reload();
    state.draft = MODEL("Something the model wrote instead.");
    expect(await chat.create()).toBe(id);
    expect((await saved(id)).observation).toBe("Edited by me.");
    expect(store.form_instances).toHaveLength(1);
  });

  it("a new card for the same person is a new form", async () => {
    const chat = new Chat();
    await chat.say(OCT21);
    const first = await chat.create();
    await chat.say("create a verbal CA for tess varga, she was 20 minutes late on 10-21-26. no payroll deduct");
    const second = await chat.create();
    expect(second).not.toBe(first);
    expect(store.form_instances).toHaveLength(2);
  });
});
describe("Q16 repeated, different date corrections and forms other than the CA", () => {
  it("a second, different date: the account the chat fixed is still the assistant's and moves again", async () => {
    const chat = new Chat();
    await chat.say(OCT21);
    state.draft = { values: { observation: DATED_ACCOUNT }, checked: { offense_type: ["standards_of_conduct"] } };
    const id = await chat.create();
    await chat.say("the meeting was actually on 10-19-26");
    chat.reload();
    await chat.say("sorry, the meeting was actually on 10-18-26");
    const form = await saved(id);
    expect(form.form_date).toBe("2026-10-18");
    expect(form.observation).toBe("Observed:\nTess Varga did not attend the monthly meeting on October 18, 2026.");
    const changes = eventsOf(id)
      .filter((event) => event.detail.via === "chat_correction")
      .map((event) => (event.detail.changes as { field: string; to: string }[]).map((change) => `${change.field}:${change.field === "form_date" ? change.to : ""}`));
    expect(changes).toEqual([["form_date:2026-10-19", "observation:"], ["form_date:2026-10-18", "observation:"]]);
  });

  it("the manager edits the account after the chat fixed it: their wording is not rewritten again", async () => {
    const chat = new Chat();
    await chat.say(OCT21);
    state.draft = { values: { observation: DATED_ACCOUNT }, checked: { offense_type: ["standards_of_conduct"] } };
    const id = await chat.create();
    await chat.say("the meeting was actually on 10-19-26");
    await managerSaves(id, { values: { observation: "My own words: Tess missed the meeting on 10/19/2026." } });
    await chat.say("sorry, the meeting was actually on 10-18-26");
    expect((await saved(id)).observation).toBe("My own words: Tess missed the meeting on 10/19/2026.");
    expect((await saved(id)).form_date).toBe("2026-10-18");
  });

  it("a form other than the CA is not touched by the CA's date or level readers", async () => {
    const { correctCaFromChat } = await import("@/lib/forms/ca-chat-corrections");
    const created = await call<{ instance: { id: string } }>("/api/forms/instances", {
      method: "POST",
      body: JSON.stringify({ templateKey: "coaching", employeeName: "Tess Varga", source: "manual", formDate: "2026-10-20" }),
    });
    const before = await saved(created.instance.id);
    const request = new Request("https://app.test/api/chat", { method: "POST", headers: { cookie: "session=abc" } });
    for (const question of ["the meeting was actually on 10-19-26", "confirm the written warning", "prior coaching: verbal ca 9-1-26"]) {
      expect(await correctCaFromChat({ request, instanceId: created.instance.id, question, today: TODAY }), question).toBeNull();
    }
    expect(await saved(created.instance.id)).toEqual(before);
  });
});

describe("Q17 the manual's standing: kept, cited by section and page, and marked until an owner confirms it", () => {
  async function drafted() {
    state.manual = FULL_MANUAL;
    const chat = new Chat();
    const reply = await chat.say(OCT21);
    state.draft = MODEL("Tess Varga did not attend the monthly meeting on October 20, 2026.");
    const id = await chat.create();
    const redraft = await call<{ notice?: string | null }>(`/api/forms/instances/${id}/draft`, {
      method: "POST",
      body: JSON.stringify({ notes: OCT21, keepManagerValues: true }),
    });
    return { reply, id, notice: redraft.notice ?? "" };
  }

  it("found by its name only: the card and the draft say it requires owner confirmation; the citation is the manual's own", async () => {
    const { reply, id, notice } = await drafted();
    expect(reply).toMatch(/\*\*Policy source:\*\* "JBA Policy Manual" — requires owner confirmation as Ask Sunny's approved policy manual/);
    expect(notice).toContain('Policy source: "JBA Policy Manual" (JBA Policy Manual Edited 5.2025) requires owner confirmation');
    const form = await saved(id);
    expect(form.policy_language).toContain("Seminars/Meetings/ Training sessions are considered scheduled shifts.");
    expect(form.policy_language).toContain("Source: JBA Policy Manual — Attendance, p. 14");
    expect(form.observation).not.toMatch(/no[- ]call/i);
    const provenance = (await valueRow(id, "policy_language"))?.provenance as Record<string, unknown>;
    expect(provenance).toMatchObject({ matchedBy: "fallback" });
  });

  it("confirmed by an owner (the official-policy-manual tag): cited without the mark", async () => {
    state.manualMatchedBy = "tag";
    const { reply, id, notice } = await drafted();
    expect(reply).not.toMatch(/requires owner confirmation/);
    expect(notice).not.toMatch(/requires owner confirmation/);
    expect((await saved(id)).policy_language).toContain("Source: JBA Policy Manual — Attendance, p. 14");
  });
});

const { manualStandingNotice, warningLevelStandingNotice } = await import("@/lib/forms/standing-notices");
const APP = "Ask Sunny";
const ACTOR = "manager-1";
/** Whether a citation stored before `ownerConfirmed` existed reads as unconfirmed in this app. */
const LEGACY_CITATION_UNCONFIRMED = true;

/* ========================================================================= */
/* QA ROUND 3 — 22 OCT 2026 (overnight): drafts already open when this ships */
/* ========================================================================= */

/** The form as the card reads it on reopening: its values, its template and its standing notices. */
async function reopened(id: string) {
  const form = (await review(id)) as Awaited<ReturnType<typeof review>> & { version: { document: unknown } };
  const status = String(form.instance.status);
  return {
    form,
    level: warningLevelStandingNotice({
      status,
      document: form.version.document as never,
      variantKey: (form.instance.variantKey as string | null) ?? null,
      rows: form.values,
    }),
    manual: manualStandingNotice(form.values),
  };
}

/** Pressing the notice's Confirm button (or another level's). */
async function confirmOnForm(id: string, level: unknown) {
  const response = await instanceRoute.POST(
    new Request(`https://app.test/api/forms/instances/${id}`, {
      method: "POST",
      body: JSON.stringify({ action: "confirm_warning_level", level }),
    }),
    { params: Promise.resolve({ id }) },
  );
  return { status: response.status, body: (await response.json()) as { error?: string } };
}

/** A draft as it sits in production today: the Type of Warning ticked by the assistant, not the manager. */
function makeLegacyLevel(id: string, level: string | null) {
  const rows = (store.form_instance_values ?? []) as Record<string, unknown>[];
  const at = rows.findIndex((row) => row.instance_id === id && row.field_key === "warning_type");
  if (level === null) {
    if (at >= 0) rows.splice(at, 1);
    return;
  }
  const row = { instance_id: id, field_key: "warning_type", value: null, checked: [level], filled_by: "ai", provenance: {} };
  if (at >= 0) rows[at] = { ...rows[at], ...row };
  else rows.push({ id: `legacy-${id}`, ...row });
}

/** A citation stored before `ownerConfirmed` was written. */
function makeLegacyCitation(id: string) {
  for (const row of (store.form_instance_values ?? []) as Record<string, unknown>[]) {
    if (row.instance_id !== id) continue;
    const provenance = row.provenance as Record<string, unknown> | undefined;
    if (provenance?.source === "official_policy_manual") delete provenance.ownerConfirmed;
  }
}

async function legacyDraft(level: string | null) {
  state.manual = FULL_MANUAL;
  const chat = new Chat();
  await chat.say("create a CA for tess varga for not attending the monthly meeting on 10-20-26. no payroll deduct");
  state.draft = MODEL("Tess Varga did not attend the monthly meeting on October 20, 2026.");
  const id = await chat.create();
  makeLegacyLevel(id, level);
  makeLegacyCitation(id);
  return { chat, id };
}

describe("Q18 drafts already open at rollout: reviewed, decided and filed without recreating them", () => {
  it("an assistant-ticked level stays a suggestion on every reopening until the manager confirms it on the form", async () => {
    const { id } = await legacyDraft("written");
    const before = await saved(id);
    for (let opened = 0; opened < 3; opened += 1) {
      const view = await reopened(id);
      expect(view.level).toMatch(new RegExp(`Type of Warning: Written Warning is ${APP}'s suggestion\\. Confirm it or choose another`));
      expect((await valueRow(id, "warning_type"))?.filledBy).toBe("ai");
    }
    expect(rowOf(id).status).toBe("draft");

    expect((await confirmOnForm(id, "written")).status).toBe(200);
    expect(await valueRow(id, "warning_type")).toMatchObject({
      checked: ["written"],
      filledBy: "manager",
      provenance: { source: "manager_confirmation", suggested: ["written"] },
    });
    const recorded = eventsOf(id).filter((event) => event.detail.via === "form_confirmation");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.actor).toBe(ACTOR);
    expect((await reopened(id)).level).toBeNull();
    const after = await saved(id);
    for (const key of Object.keys(before)) if (key !== "warning_type") expect(after[key], key).toEqual(before[key]);
    expect((await finalize(id)).status).toBe(200);
    expect(store.form_instances).toHaveLength(1);
  });

  it("the manager chooses the other level instead: ticked on the form, it is theirs and files", async () => {
    const { id } = await legacyDraft("written");
    await managerSaves(id, { checked: { warning_type: ["verbal"] } });
    expect(await valueRow(id, "warning_type")).toMatchObject({ checked: ["verbal"], filledBy: "manager" });
    expect((await reopened(id)).level).toBeNull();
    expect((await finalize(id)).status).toBe(200);
  });

  it("the manager confirms in the chat instead, after a refresh", async () => {
    const { chat, id } = await legacyDraft("written");
    chat.reload();
    expect(await chat.say("yes, confirm the written warning")).toMatch(/Confirmed \*\*Written Warning\*\* as your decision/);
    expect((await finalize(id)).status).toBe(200);
  });

  it("a blank level asks for a decision; a level the form does not offer is refused and nothing is written", async () => {
    const { id } = await legacyDraft(null);
    // A blank level is the manager's to fill in, as before: no notice, and nothing blocks Finalize.
    expect((await reopened(id)).level).toBeNull();
    const before = await saved(id);
    expect((await confirmOnForm(id, "termination")).status).toBe(400);
    expect((await confirmOnForm(id, 7)).status).toBe(400);
    expect(await saved(id)).toEqual(before);
    expect((await confirmOnForm(id, "verbal")).status).toBe(200);
    expect((await finalize(id)).status).toBe(200);
  });

  it("confirming the level keeps anything else ticked on Type of Warning, and never confirms Termination or Demotion", async () => {
    const { id } = await legacyDraft("written");
    const row = ((store.form_instance_values ?? []) as Record<string, unknown>[]).find(
      (entry) => entry.instance_id === id && entry.field_key === "warning_type",
    )!;
    row.checked = ["written", "demotion"];
    expect((await confirmOnForm(id, "demotion")).status).toBe(400);
    expect((await confirmOnForm(id, "written")).status).toBe(200);
    expect(await valueRow(id, "warning_type")).toMatchObject({ checked: ["demotion", "written"], filledBy: "manager" });
  });

  it("a form already finalized stays as it was: no notice, no confirmation, values unchanged; its new draft asks", async () => {
    const { id } = await legacyDraft("written");
    const row = rowOf(id);
    row.status = "finalized";
    row.finalized_at = "2026-10-21T15:00:00Z";
    const before = await saved(id);
    expect((await reopened(id)).level).toBeNull();
    expect((await confirmOnForm(id, "written")).status).toBe(409);
    expect(await saved(id)).toEqual(before);
    expect(await valueRow(id, "warning_type")).toMatchObject({ filledBy: "ai" });

    joinOverview();
    const revised = await instanceRoute.POST(
      new Request(`https://app.test/api/forms/instances/${id}`, { method: "POST", body: JSON.stringify({ action: "revise" }) }),
      { params: Promise.resolve({ id }) },
    );
    expect(revised.status).toBe(200);
    const draftId = String(((await revised.json()) as { instance: { id: string } }).instance.id);
    joinOverview();
    expect((await reopened(draftId)).level).toMatch(/suggestion\. Confirm it or choose another/);
    expect(rowOf(id).status).toBe("finalized");
  });

  it("the manual's standing is said again on every reopening, from what was stored", async () => {
    const { id } = await legacyDraft("written");
    const view = await reopened(id);
    if (LEGACY_CITATION_UNCONFIRMED) {
      expect(view.manual).toMatch(new RegExp(`requires owner confirmation as ${APP}'s approved policy manual`));
    } else {
      expect(view.manual).toBeNull();
    }
    // Written today, the citation says whether an owner confirmed the manual.
    state.manual = FULL_MANUAL;
    await call(`/api/forms/instances/${id}/draft`, { method: "POST", body: JSON.stringify({ notes: OCT21, keepManagerValues: true }) });
    const stored = (await valueRow(id, "policy_language"))?.provenance as Record<string, unknown>;
    expect(typeof stored.ownerConfirmed).toBe("boolean");
    expect(Boolean((await reopened(id)).manual)).toBe(stored.ownerConfirmed === false);
  });
});

describe("Q19 changes of mind, interruptions and what was never said", () => {
  it("Written → Verbal → Written before the draft: the card and the saved form carry the last decision", async () => {
    const chat = new Chat();
    await chat.say(OCT21);
    expect(chat.card?.warningLevel).toBe("written");
    await chat.say("actually make it a verbal");
    expect(chat.card?.warningLevel).toBe("verbal");
    await chat.say("no, written after all");
    expect(chat.card?.warningLevel).toBe("written");
    state.draft = MODEL("Tess Varga did not attend the monthly meeting on October 20, 2026.");
    const id = await chat.create();
    expect(await valueRow(id, "warning_type")).toMatchObject({ checked: ["written"] });
    expect((await finalize(id)).status).toBe(200);
  });

  it("Written → Verbal → Written after the draft: the level is the manager's each time and nothing else moves", async () => {
    const chat = new Chat();
    await chat.say(OCT21);
    state.draft = MODEL("Tess Varga did not attend the monthly meeting on October 20, 2026.");
    const id = await chat.create();
    const before = await saved(id);
    await chat.say("make it a verbal instead");
    expect(await valueRow(id, "warning_type")).toMatchObject({ checked: ["verbal"], filledBy: "manager" });
    chat.reload();
    await chat.say("change it back to written");
    expect(await valueRow(id, "warning_type")).toMatchObject({ checked: ["written"], filledBy: "manager" });
    const after = await saved(id);
    for (const key of Object.keys(before)) if (key !== "warning_type") expect(after[key], key).toEqual(before[key]);
    expect(store.form_instances).toHaveLength(1);
  });

  it("the account given in a later turn, then a refresh: the same request continues for the same person", async () => {
    const chat = new Chat();
    await chat.say("create a written CA for tess varga");
    await chat.say("she did not attend the monthly meeting on 10-20-26. no payroll deduct");
    // Each turn re-issues the card (a superseded one is refused at Create); it is the same form for the same person.
    expect(chat.card).toMatchObject({ templateKey: "dpoa", employeeName: "Tess Varga" });
    chat.reload();
    state.draft = MODEL("Tess Varga did not attend the monthly meeting on October 20, 2026.");
    const id = await chat.create();
    expect(await saved(id)).toMatchObject({ warning_type: ["written"], payroll_deduct: ["no"], form_date: "2026-10-20" });
  });

  it("what the manager never said stays blank: no payroll answer, no prior actions, no level, no no-call/no-show", async () => {
    const chat = new Chat();
    const reply = await chat.say("create a CA for tess varga for not attending the monthly meeting on 10-20-26");
    expect(reply).toMatch(/payroll deduct/i);
    state.draft = MODEL("Tess Varga did not attend the monthly meeting on October 20, 2026.");
    const id = await chat.create();
    const form = await saved(id);
    expect(form.payroll_deduct).toBeUndefined();
    expect(form.prior_actions).toBeUndefined();
    expect(form.warning_type).toBeUndefined();
    expect(String(form.observation ?? "")).not.toMatch(/no[- ]call|ncns|did not notify|without notifying/i);
    // Nothing invented on the way through Finalize either.
    expect((await finalize(id)).status).toBe(200);
    expect((await saved(id)).warning_type).toBeUndefined();
  });
});

describe("Q20 an existing draft through rollout: nothing about it changes except the decision the manager makes", () => {
  it("reopened and confirmed: still a draft until Finalize; employee, dates, prior actions and every earlier event kept", async () => {
    const { chat, id } = await legacyDraft("written");
    await chat.say("prior coaching: jba policy manual 1-1-26, verbal ca 9-1-26");
    const before = await saved(id);
    const eventsBefore = eventsOf(id).map((event) => JSON.stringify(event));
    const rowBefore = { ...rowOf(id) };

    for (let opened = 0; opened < 2; opened += 1) await reopened(id);
    expect(rowOf(id).status).toBe("draft");
    expect(eventsOf(id).map((event) => JSON.stringify(event))).toEqual(eventsBefore);

    expect((await confirmOnForm(id, "verbal")).status).toBe(200);
    expect(rowOf(id).status).toBe("draft");
    const after = await saved(id);
    for (const key of ["employee_name", "form_date", "prior_actions", "observation", "payroll_deduct", "offense_type", "policy_language"]) {
      expect(after[key], key).toEqual(before[key]);
    }
    expect(after.warning_type).toEqual(["verbal"]);
    for (const column of ["employee_name", "location_id", "form_date", "created_by", "template_version_id"]) {
      expect(rowOf(id)[column], column).toEqual(rowBefore[column]);
    }
    const eventsAfter = eventsOf(id).map((event) => JSON.stringify(event));
    expect(eventsAfter.slice(0, eventsBefore.length)).toEqual(eventsBefore);
    expect(eventsAfter).toHaveLength(eventsBefore.length + 1);
    expect(store.form_instances).toHaveLength(1);
  });
});

describe("Q21 a corrected incident date is the answer, not a second incident (release merge, 22 Oct 2026)", () => {
  it("\"the meeting was actually on 10-19-26\" dates the form 10/19 and never asks which date", async () => {
    const chat = new Chat();
    await chat.say(OCT21);
    const reply = await chat.say("the meeting was actually on 10-19-26");
    expect(reply).not.toMatch(/Which date goes on the form/);
    expect(chat.card?.formDate).toBe("2026-10-19");
    expect(await chat.say("no payroll deduct")).not.toMatch(/Which date goes on the form/);
    expect(chat.card?.formDate).toBe("2026-10-19");
    state.draft = MODEL("Tess Varga did not attend the monthly meeting on October 19, 2026.");
    expect((await saved(await chat.create())).form_date).toBe("2026-10-19");
  });

  it("two different incidents are still a question", async () => {
    const chat = new Chat();
    const reply = await chat.say(
      "create a written CA for tess varga, she missed the monthly meeting on 10-13-26 and the training on 10-20-26. no payroll deduct",
    );
    expect(reply).toMatch(/Which date goes on the form/);
  });
});
