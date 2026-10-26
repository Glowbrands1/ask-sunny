import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import manual151 from "@/test/fixtures/jba-manual-production-151.json";
import { manualChunkFromRow, type ChunkRow as ManualChunkRow } from "@/lib/ai/full-manual-load";
import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * CORRECTIVE ACTION FEEDBACK FROM A DISTRICT MANAGER, 21 OCT 2026 — END TO END
 * ============================================================================
 *
 * The production requests a District Manager rated low, replayed through the
 * real proposal flow, `createInlineForm` (the browser's orchestrator), and the
 * real create / draft / review routes, with the Corrective Action Form the
 * library actually seeds:
 *
 *   "create verbal CA for … for violating visitors at work policy on 10-10-26
 *   … previous coaching was jba policy manual 1-1-26", "… on 10-20-26.
 *   verbal. no payroll deduct. jba manual 1-1-26 for previous coaching", a
 *   second request in the same chat, "payroll deduct of $3.25 is applicable",
 *   "by the 10-15-26 deadline", and "previous coaching: jba policy manual
 *   1-1-26, verbal ca 9-1-26".
 *
 * Only identity, the model, the knowledge provider and the database are
 * stand-ins. Every person is synthetic.
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
  /*
   * How the manual was found: "fallback" (by its title, as in production) or
   * "tag" (an administrator-approved manual). Either way Finalize works the
   * same (owner decision, 22 Oct 2026: warning only).
   */
  manualMatchedBy: "fallback" as "tag" | "fallback",
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

const field = (form: Awaited<ReturnType<typeof review>>, key: string) =>
  form.values.find((entry) => entry.fieldKey === key);

let sequence = 0;
const said = (content: string): ChatMessage => ({
  id: `m${(sequence += 1)}`,
  role: "user",
  content,
  createdAt: "2026-10-21T15:00:00Z",
});

/**
 * Plays the manager's turns through the real proposal flow — Ask Sunny's own
 * answers fed forward as history, and the open card's template sent as the
 * browser does — and returns every turn's response plus a `create` that files
 * the last card exactly as the chat's Create draft button does.
 */
async function conversation(turns: string[]) {
  const messages: ChatMessage[] = [];
  const responses: NonNullable<Awaited<ReturnType<typeof proposeFormForTurn>>>[] = [];
  let open: string | undefined;
  for (const text of turns) {
    const message = said(text);
    const response = await proposeFormForTurn({
      history: messages,
      question: message.content,
      questionMessageId: message.id,
      actor: { role: state.role as never, scope: state.scope as AccessScope },
      summaries: await listTemplateSummaries(),
      today: "2026-10-21",
      /* The pinned manual, as server-ask supplies it. */
      policyManual: async () => (state.manual?.chunks as never) ?? null,
      ...(open ? { continueTemplateKey: open } : {}),
    });
    expect(response, `turn left the form intake: ${JSON.stringify(text)}`).not.toBeNull();
    expect(response!.formProposal, text).toBeDefined();
    responses.push(response!);
    open = response!.formProposal!.templateKey;
    messages.push(message, {
      id: `a${sequence}`,
      role: "assistant",
      content: response!.content,
      createdAt: "2026-10-21T15:00:01Z",
      formProposal: response!.formProposal,
    } as ChatMessage);
  }
  const last = responses[responses.length - 1]!;
  expect(last.formProposal!.templateKey).toBe("dpoa");
  return {
    responses,
    last,
    proposal: last.formProposal!,
    /* `salon`: the card's salon picker, sent as the browser sends it. */
    create: async (salon?: string) => {
      if (!salon) expect(last.formProposal!.supportsInlineDraft).toBe(true);
      const proposal = salon ? { ...last.formProposal!, locationId: salon } : last.formProposal!;
      return createInlineForm({ proposal, messages, call, onCreated: () => {} });
    },
  };
}

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

/* The production turns, with synthetic people. */
const A1 =
  "create verbal CA for remy calder for violating visitors at work policy on 10-10-26. remy spent 40 minutes talking with a friend and ignoring clients. previous coaching was jba policy manual 1-1-26";
const B1 =
  "create ca form for tess varga for violating attendance policy on 10-20-26. verbal. no payroll deduct. jba manual 1-1-26 for previous coaching";
/* HR, 21 Oct 2026: the history as a list under one label. */
const E1 =
  "create a written CA for tess varga for not attending the monthly meeting on 10-20-26. previous coaching: jba policy manual 1-1-26, verbal ca 9-1-26. payroll deduct not applicable";

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  requests.length = 0;
  state.role = "salon_director";
  state.scope = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: [] };
  state.draft = { values: {}, checked: {} };
  state.manualMatchedBy = "fallback";
  state.modelNotes = [];
  state.manual = MANUAL;
  state.directory = DIRECTORY;
  sequence = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T15:00:00Z"));
  await ensureTemplateLibrary("system");
});

/* ========================================================================= */
/* "VERBAL CA" AND A BARE "VERBAL." ARE THE TYPE OF WARNING                  */
/* ========================================================================= */

const LEVEL_LEFT_OPEN = /verbal\/written warning level/;

describe("the warning level in the request is read, not left open", () => {
  it('"create verbal CA for …" reads back Verbal Warning, and the form is ticked Verbal', async () => {
    const { last, proposal, create } = await conversation([A1]);

    expect(proposal.warningLevel).toBe("verbal");
    expect(last.content).toMatch(/\*\*Type of Warning:\*\* Verbal Warning, as you said/);
    expect(last.content).not.toMatch(LEVEL_LEFT_OPEN);

    /* The model climbs a rung; the manager's level is the record. */
    state.draft = { values: {}, checked: { warning_type: ["written"] } };
    const { reference } = await create();
    const warning = field(await review(reference.instanceId), "warning_type")!;
    expect(warning.checked).toEqual(["verbal"]);
    expect(warning.provenance).toMatchObject({ source: "manager_statement" });
  });

  it('"… on 10-20-26. verbal. no payroll deduct." reads the bare "verbal." as the level', async () => {
    const { last, proposal } = await conversation([B1]);

    expect(proposal.warningLevel).toBe("verbal");
    expect(last.content).toMatch(/\*\*Type of Warning:\*\* Verbal Warning, as you said/);
    expect(last.content).not.toMatch(LEVEL_LEFT_OPEN);
  });

  it("a warning already given is history, not this form's level", async () => {
    const { last, proposal, create } = await conversation([
      "create ca for tess varga, she was 20 minutes late on 10-20-26. she had a written CA in august. no payroll deduct",
    ]);

    expect(proposal.warningLevel ?? null).toBeNull();
    expect(last.content).not.toMatch(/Type of Warning:\*\* Written/);

    state.draft = { values: {}, checked: { warning_type: ["verbal"] } };
    const { reference } = await create();
    expect(field(await review(reference.instanceId), "warning_type")!.filledBy).toBe("ai");
  });
});

/* ========================================================================= */
/* WHICH TURNS ARE THIS FORM'S                                               */
/* ========================================================================= */

const A2 = "no payroll deduct";
const B2 = "verbal";
const B3 =
  "create ca form for tess varga for a register shortage on 10-20-26. payroll deduct applies and $3.25 will be deducted from check. previous coaching - jba policy manual 1-20-26.";

/** The notes the draft was written from, as the browser sent them. */
const described = () => String(requests.filter((entry) => entry.url.endsWith("/draft")).at(-1)?.body.notes ?? "");

describe("the account survives the short answers after it", () => {
  it('"no payroll deduct" keeps the account, and the draft is written from it', async () => {
    const { proposal, create } = await conversation([A1, A2]);

    expect(proposal.employeeName).toBe("Remy Calder");
    expect(proposal.sourceMessageIds).toEqual(["m1", "m2"]);
    expect(proposal.payrollDeduct).toBe("no");

    await create();
    expect(described()).toContain("spent 40 minutes talking with a friend and ignoring clients");
    expect(described()).toMatch(/^create verbal CA for remy calder/);
  });
});

describe("a new request in the same chat is a new proposal", () => {
  it("keeps none of the earlier request's policy, warning level, account or payroll answer", async () => {
    const { responses, proposal, create } = await conversation([B1, B2, B3]);

    const reply = responses[2]!.content;
    expect(reply).not.toMatch(/attendance/i);
    expect(reply).not.toMatch(/Verbal Warning, as you said/);
    expect(proposal.sourceMessageIds).toEqual(["m3"]);
    expect(proposal.warningLevel ?? null).toBeNull();
    expect(proposal.payrollDeduct).toBe("yes");

    await create();
    expect(described()).not.toMatch(/attendance/i);
    expect(described()).toContain("register shortage");
  });

  it("does not carry the earlier request's payroll answer", async () => {
    const { proposal, last } = await conversation([
      B1,
      B2,
      "create ca form for tess varga for a register shortage on 10-20-26",
    ]);

    expect(proposal.payrollDeduct).toBeNull();
    expect(last.content).toMatch(/\*\*Is payroll deduct applicable\?\*\* Yes or No\?/);
  });

  it("a repeated request that adds nothing keeps the account already given", async () => {
    const { proposal } = await conversation([B1, "create ca form for tess varga"]);

    expect(proposal.sourceMessageIds).toEqual(["m1", "m2"]);
    expect(proposal.payrollDeduct).toBe("no");
  });
});

/* ========================================================================= */
/* THE PREVIOUS COACHING IS HISTORY, AND IT GOES ON THE FORM                 */
/* ========================================================================= */

describe("previous coaching stated in chat", () => {
  it("is not the form's date, is read back, and fills the prior-actions line", async () => {
    const { responses, proposal, create } = await conversation([A1, A2]);

    for (const response of responses) {
      expect(response.content).not.toMatch(/any prior coaching or corrective action/);
      expect(response.content).toMatch(
        /\*\*Prior actions:\*\* Coaching — JBA Policy Manual — signed 01\/01\/2026, as you said/,
      );
    }
    expect(proposal.formDate).toBe("2026-10-10");

    const { reference } = await create();
    const form = await review(reference.instanceId);
    expect(field(form, "form_date")!.value).toBe("2026-10-10");
    expect(field(form, "prior_actions")!.value).toBe("Coaching — JBA Policy Manual — signed 01/01/2026");
  });

  it('"jba manual 1-1-26 for previous coaching" — the date first, the label after', async () => {
    const { proposal, create } = await conversation([B1]);

    expect(proposal.formDate).toBe("2026-10-20");

    const { reference } = await create();
    expect(field(await review(reference.instanceId), "prior_actions")!.value).toBe(
      "Coaching — JBA Manual — signed 01/01/2026",
    );
  });

  it("a request whose only date is the coaching's is not dated by it", async () => {
    const { proposal } = await conversation([
      "create ca for tess varga, she was 20 minutes late for her shift. previous coaching was jba policy manual 1-1-26",
    ]);

    expect(proposal.formDate ?? null).toBeNull();
  });

  /*
   * HR, 21 Oct 2026: the history as a list under one label. The verbal CA was
   * dropped from the prior actions, its date handed to the drafting model as
   * one of the manager's dates for the form, and the "verbal ca" in the list
   * cancelled the Written the manager asked for.
   */
  it('"previous coaching: jba policy manual 1-1-26, verbal ca 9-1-26" — every item of the list is history', async () => {
    const { last, proposal, create } = await conversation([E1]);

    expect(proposal.formDate).toBe("2026-10-20");
    expect(proposal.warningLevel).toBe("written");
    expect(last.content).toMatch(/\*\*Type of Warning:\*\* Written Warning, as you said/);
    expect(last.content).not.toMatch(LEVEL_LEFT_OPEN);
    expect(last.content).toMatch(
      /\*\*Prior actions:\*\* Coaching — JBA Policy Manual — signed 01\/01\/2026; Verbal corrective action — signed 09\/01\/2026, as you said/,
    );

    const { reference } = await create();
    const form = await review(reference.instanceId);
    expect(field(form, "form_date")!.value).toBe("2026-10-20");
    expect(field(form, "prior_actions")!.value).toBe(
      "Coaching — JBA Policy Manual — signed 01/01/2026\nVerbal corrective action — signed 09/01/2026",
    );
    expect(field(form, "warning_type")!.checked).toEqual(["written"]);
    expect(field(form, "warning_type")!.provenance).toMatchObject({ source: "manager_statement" });
    expect(described()).toContain(E1);
    /* The verbal CA's date is history, not one of the dates to write on the form. */
    expect(state.modelNotes.at(-1)).toMatch(/This is the date of the incident and of this form/);
    expect(state.modelNotes.at(-1)).not.toContain("September 1, 2026");
  });
});

/* ========================================================================= */
/* A POLICY NAMED BY THE MANUAL'S OWN SECTION                                */
/* ========================================================================= */

/*
 * POLICY_SPECIFIC_TOPICS_ENABLED, ON THE DRAFT PATH (QA, 26 Oct 2026, "dog at
 * work" saved Standards of Conduct p.12): the manager's words choose the
 * manual's Animals in the Workplace section (and Visitors beside it) on the
 * saved draft, read from the production JBA manual rows. Off, the model's box
 * stands, as in the production draft.
 */
describe("a dog at work, on the saved draft, against the production manual rows", () => {
  afterEach(() => vi.unstubAllEnvs());
  const TURN = "create verbal CA for remy calder, brought her dog to work on 10-10-26. no payroll deduct";
  const modelDraft = () => {
    state.manual = { chunks: (manual151.chunks as ManualChunkRow[]).map(manualChunkFromRow) };
    state.draft = {
      values: { observation: "Observed:\nRemy Calder brought her dog to work.", other_offense: "Dog at work" },
      checked: { offense_type: ["standards_of_conduct"] },
    };
  };

  it("flag off: the model's Standards of Conduct stands (the production draft)", async () => {
    vi.stubEnv("POLICY_SPECIFIC_TOPICS_ENABLED", "");
    const { create } = await conversation([TURN]);
    modelDraft();
    const { reference } = await create();
    const form = await review(reference.instanceId);
    expect(field(form, "offense_type")!.checked).toEqual(["standards_of_conduct"]);
    expect(field(form, "policy_language")!.value ?? "").not.toMatch(/Animals in the Workplace/);
  });

  it("POLICY_SPECIFIC_TOPICS_ENABLED on: Animals in the Workplace p.30, with Visitors p.29 beside it", async () => {
    vi.stubEnv("POLICY_SPECIFIC_TOPICS_ENABLED", "true");
    const { create } = await conversation([TURN]);
    modelDraft();
    const { reference } = await create();
    const form = await review(reference.instanceId);
    const policy = field(form, "policy_language")!.value!;
    expect(field(form, "offense_type")!.checked).toEqual(["company_policies"]);
    expect(field(form, "other_offense")).toBeUndefined();
    expect(policy).toContain("Source: JBA Policy Manual — Animals in the Workplace, p. 30");
    expect(policy).toContain("Source: JBA Policy Manual — Visitors in the Workplace, p. 29");
    expect(policy).not.toMatch(/Standards of Conduct/);
  });
});

describe('"violating visitors at work policy" is the manual\'s Visitors in the Workplace', () => {
  it("is named in the reply, ticked, and quoted with its section and page", async () => {
    const { last, create } = await conversation([A1, A2]);

    expect(last.content).toMatch(
      /\*\*Policy:\*\* Visitors in the Workplace, as you said — the policy manual's section on page 30\. I'll quote it on the draft under \*\*Violation of Company Policies\*\*/,
    );

    /* The model would tick another box and write its own "Other". */
    state.draft = {
      values: {
        observation: "Observed:\nRemy Calder spent 40 minutes talking with a friend and did not attend to clients.",
        other_offense: "Socializing with visitors",
      },
      checked: { offense_type: ["standards_of_conduct"] },
    };
    const { reference } = await create();
    const form = await review(reference.instanceId);
    const policy = field(form, "policy_language")!.value!;

    expect(field(form, "offense_type")!.checked).toEqual(["company_policies"]);
    expect(field(form, "other_offense")).toBeUndefined();
    expect(field(form, "policy_violated")!.value).toBe("Violation of Company Policies — Visitors in the Workplace");
    expect(policy).toContain("only authorized visitors are");
    expect(policy).toContain("Source: JBA Policy Manual — Visitors in the Workplace, p. 30");
    expect(policy).not.toMatch(/Standards of Conduct/);
    expect(field(form, "policy_language")!.provenance).toMatchObject({ verified: true });
  });

  it("fails closed: a named policy no heading answers cites nothing, and the reply says so", async () => {
    const { last, create } = await conversation([
      "create verbal CA for remy calder for violating the unicorn parking policy on 10-10-26. no payroll deduct",
    ]);

    expect(last.content).toMatch(/Woven does not see a section of the current policy manual for "unicorn parking"/);

    state.draft = { values: { observation: "Observed:\nRemy parked in the wrong place." }, checked: {} };
    const { reference } = await create();
    const form = await review(reference.instanceId);
    expect(field(form, "offense_type")).toBeUndefined();
    expect(field(form, "policy_language")).toBeUndefined();
  });

  it("without the manual in front of it, the reply names the policy in the manager's words", async () => {
    state.manual = null;
    const { last } = await conversation([A1]);

    expect(last.content).toMatch(/\*\*Policy:\*\* "visitors at work", as you said\. I'll look for that section/);
  });
});

/* ========================================================================= */
/* THE DATES THE MANAGER GAVE STAY THEIRS ON THE DRAFT                       */
/* ========================================================================= */

const D1 =
  "create corrective action for tess varga for violating standards of conduct policy on 10-20-26. tess failed to acknowledge policies in woven by the 10-15-26 deadline.";

describe("the observation keeps the manager's dates", () => {
  it("dated by the incident, the observation states it as given", async () => {
    const { create } = await conversation([B1]);
    state.draft = {
      values: { observation: "Observed:\nOn October 20, 2026, Tess Varga did not follow the attendance policy." },
      checked: {},
    };

    const { reference } = await create();
    const form = await review(reference.instanceId);
    expect(field(form, "form_date")!.value).toBe("2026-10-20");
    expect(field(form, "observation")!.value).toBe(
      "Observed:\nOn October 20, 2026, Tess Varga did not follow the attendance policy.",
    );
  });

  it("the deadline the manager gave is not rewritten to the form's date", async () => {
    const { proposal, create } = await conversation([D1]);
    expect(proposal.formDate).toBe("2026-10-20");
    state.draft = {
      values: {
        observation:
          "Observed:\nOn October 20, 2026, Tess Varga had not acknowledged the policies in Woven by the October 15, 2026 deadline.",
      },
      checked: {},
    };

    const { reference } = await create();
    const form = await review(reference.instanceId);
    const observation = field(form, "observation")!.value!;

    expect(field(form, "form_date")!.value).toBe("2026-10-20");
    expect(observation).toContain("On October 20, 2026");
    expect(observation).toContain("by the October 15, 2026 deadline");
    expect(observation).not.toContain("by the October 20, 2026 deadline");
    /* And the model was told which dates are the manager's, not that the form's is the only one. */
    expect(state.modelNotes.at(-1)).toMatch(/not necessarily the date of the incident/);
    expect(state.modelNotes.at(-1)).toContain('\\"October 20, 2026\\", \\"October 15, 2026\\"');
  });
});

/* ========================================================================= */
/* "PAYROLL DEDUCT OF $3.25 IS APPLICABLE", AND THE ACTION PLAN SAYS SO      */
/* ========================================================================= */

const C1 =
  "create ca form for tess varga. tess had a register shortage of $3.25 on 10-20-26. payroll deduct of $3.25 is applicable";

const CLOSING =
  "Future policy violations may result in additional corrective action up to and including termination of employment.";

/*
 * What the model would have written. The Action Plan is built by code now
 * (District Manager feedback, 21 Oct 2026; `ca-action-plan.ts`), so none of
 * this reaches the form.
 */
const DRAWER_PLAN =
  "Tess Varga is expected to adhere to the Sun Tan City cash handling policy by keeping the register accurate. Moving forward, Tess should count the drawer at every shift change. Management will monitor compliance and provide coaching as needed.";

/* Flag off: no offense box is ticked and no manual section cited for a register shortage, so the plan names the applicable company policy. Flag on: a register shortage is the Standards of Conduct, so the plan names it (as the Standards of Conduct plans in qa-oct21-audit-e2e do). */
const REVIEW_OFF = "Management will review the applicable company policy with Tess.";
const REVIEW_ON = "Management will review the Standards of Conduct policy with Tess.";

describe.each([
  ["off", "", REVIEW_OFF],
  ["on", "true", REVIEW_ON],
])("a payroll deduction with an amount (POLICY_SPECIFIC_TOPICS_ENABLED %s)", (_flag, value, REVIEW_APPLICABLE) => {
  beforeEach(() => {
    vi.stubEnv("POLICY_SPECIFIC_TOPICS_ENABLED", value);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("is read as Yes, not asked, and the Action Plan states the amount before the closing", async () => {
    const { last, proposal, create } = await conversation([C1]);

    expect(proposal.payrollDeduct).toBe("yes");
    expect(last.content).toMatch(/Is payroll deduct applicable\? \*\*Yes\*\*/);
    expect(last.content).not.toMatch(/Yes or No\?/);

    state.draft = {
      values: {
        observation: "Observed:\nOn October 20, 2026, Tess Varga's register was short $3.25.",
        action_plan: DRAWER_PLAN,
      },
      checked: {},
    };
    const { reference } = await create();
    const form = await review(reference.instanceId);

    expect(field(form, "payroll_deduct")!.checked).toEqual(["yes"]);
    expect(field(form, "action_plan")!.value).toBe(`${REVIEW_APPLICABLE} $3.25 will be deducted from Tess's pay. ${CLOSING}`);
  });

  it('"payroll deduct applies and $3.25 will be deducted from check" says the same', async () => {
    const { create } = await conversation([B3]);
    state.draft = { values: { action_plan: DRAWER_PLAN }, checked: {} };

    const { reference } = await create();
    expect(field(await review(reference.instanceId), "action_plan")!.value).toBe(
      `${REVIEW_APPLICABLE} $3.25 will be deducted from Tess's pay. ${CLOSING}`,
    );
  });

  it("with no amount stated, says a deduction applies and invents no figure", async () => {
    const { create } = await conversation([
      "create ca form for tess varga, her register was short on 10-20-26. yes payroll deduct",
    ]);
    /*
     * With an observation drafted: the plan is built only on a form the draft
     * wrote something on — one created from a name alone stays blank.
     */
    state.draft = {
      values: { observation: "Observed:\nOn October 20, 2026, Tess Varga's register was short.", action_plan: DRAWER_PLAN },
      checked: {},
    };

    const { reference } = await create();
    const plan = field(await review(reference.instanceId), "action_plan")!.value!;
    expect(plan).toBe(`${REVIEW_APPLICABLE} A payroll deduction applies. ${CLOSING}`);
    expect(plan).not.toMatch(/\$/);
  });

  it("says nothing about pay when payroll deduct is No", async () => {
    const { create } = await conversation([B1]);
    state.draft = { values: { action_plan: DRAWER_PLAN }, checked: {} };

    const { reference } = await create();
    expect(field(await review(reference.instanceId), "action_plan")!.value).toBe(
      `Management will review the Attendance policy with Tess. ${CLOSING}`,
    );
  });
});

/* ========================================================================= */
/* "OTHER" BESIDE STANDARDS OF CONDUCT                                       */
/* ========================================================================= */

/*
 * The same review found a Corrective Action stored with "Other" reading
 * "Failure to complete required task — Woven deadline of September 30, 2026
 * not met" beside Standards of Conduct, written by the form card's save after
 * the draft rather than by the draft. This pins the draft's half: whatever the
 * model writes there, a stated Standards of Conduct leaves it blank.
 */
describe("the draft never writes Other beside a stated Standards of Conduct", () => {
  it("drops the model's write-in and its other box", async () => {
    const { create } = await conversation([D1]);
    state.draft = {
      values: {
        observation: "Observed:\nTess Varga had not acknowledged the policies in Woven by the October 15, 2026 deadline.",
        other_offense: "Failure to complete required task — Woven deadline of September 30, 2026 not met",
      },
      checked: { offense_type: ["under_performance"] },
    };

    const { reference } = await create();
    const form = await review(reference.instanceId);
    expect(field(form, "offense_type")!.checked).toEqual(["standards_of_conduct"]);
    expect(field(form, "other_offense")).toBeUndefined();
    expect(JSON.stringify(form.values)).not.toMatch(/September 30/);
  });
});

/* ========================================================================= */
/* A CELL PHONE ACCOUNT, WITH NO POLICY NAMED                                */
/* ========================================================================= */

/*
 * District Manager feedback, 21 Oct 2026: the account named no policy and was
 * cited under the Standards of Conduct, not the manual's Cell Phone/Smart
 * Watch Policy (printed page 19).
 */
const F1 =
  "create a verbal corrective action form for remy calder. on 10-20-26 remy was talking on her cell phone for over 30 minutes";

describe("an account of the conduct cites the manual section it describes", () => {
  it("reads Verbal, and the draft cites the Cell Phone/Smart Watch Policy under Violation of Company Policies", async () => {
    const { last, proposal, create } = await conversation([F1, A2]);

    expect(proposal.warningLevel).toBe("verbal");
    expect(last.content).toMatch(/\*\*Type of Warning:\*\* Verbal Warning, as you said/);
    expect(last.content).toMatch(
      /\*\*Policy:\*\* "cell phone" reads as the policy manual's \*\*Cell Phone\/Smart Watch Policy\*\* \(page 19\)\. I'll quote it on the draft under \*\*Violation of Company Policies\*\*/,
    );

    /* The model files it under the catch-all. */
    state.draft = {
      values: { observation: "Observed:\nOn October 20, 2026, Remy Calder was talking on her cell phone for over 30 minutes." },
      checked: { offense_type: ["standards_of_conduct"] },
    };
    const { reference } = await create();
    const form = await review(reference.instanceId);
    const policy = field(form, "policy_language")!.value!;

    expect(field(form, "warning_type")!.checked).toEqual(["verbal"]);
    expect(field(form, "offense_type")!.checked).toEqual(["company_policies"]);
    expect(field(form, "policy_violated")!.value).toBe("Violation of Company Policies — Cell Phone/Smart Watch Policy");
    expect(policy).toContain("Personal Employee cell phones are permitted in the workplace");
    expect(policy).toContain("Source: JBA Policy Manual — Cell Phone/Smart Watch Policy, p. 19");
    expect(policy).not.toMatch(/Standards of Conduct/);
    expect(field(form, "policy_language")!.provenance).toMatchObject({ verified: true });
    const plan = field(form, "action_plan")!.value!;
    expect(plan).toBe(`Management will review the Cell Phone/Smart Watch policy with Remy. ${CLOSING}`);
    expect(plan).not.toMatch(/Policy policy/i);
  });

  it("a phone in an account a box with its own section governs leaves that box: a late arrival is Attendance", async () => {
    const { last, create } = await conversation([
      "create a verbal corrective action form for remy calder. on 10-20-26 remy was 40 minutes late because she was on her phone in the parking lot. no payroll deduct",
    ]);
    expect(last.content).not.toMatch(/Cell Phone/);

    state.draft = {
      values: { observation: "Observed:\nOn October 20, 2026, Remy Calder arrived 40 minutes late." },
      checked: { offense_type: ["tardiness"] },
    };
    const { reference } = await create();
    const form = await review(reference.instanceId);
    expect(field(form, "offense_type")!.checked).toEqual(["tardiness"]);
    expect(field(form, "policy_violated")!.value).toBe("Tardiness/Leaving Early");
    expect(field(form, "policy_language")!.value).toContain("Source: JBA Policy Manual — Attendance, p. 14");
    expect(field(form, "policy_language")!.value).not.toMatch(/Cell Phone/);
  });

  it("never replaces a box the draft ticked whose own section is specific", async () => {
    const { create } = await conversation([
      "create a verbal corrective action form for remy calder. on 10-20-26 remy stayed on her cell phone in the back room after her shift began. no payroll deduct",
    ]);
    state.draft = {
      values: { observation: "Observed:\nOn October 20, 2026, Remy Calder did not start her shift on time." },
      checked: { offense_type: ["tardiness"] },
    };
    const { reference } = await create();
    const form = await review(reference.instanceId);
    expect(field(form, "offense_type")!.checked).toEqual(["tardiness"]);
    expect(field(form, "policy_language")!.value).not.toMatch(/Cell Phone/);
  });

  it("an incidental mention describes nothing: the draft's own box stands", async () => {
    const { last, create } = await conversation([
      "create a verbal corrective action form for remy calder. on 10-20-26 remy was rude to a client. she left her phone number on the schedule. no payroll deduct",
    ]);
    expect(last.content).not.toMatch(/Cell Phone/);

    state.draft = {
      values: { observation: "Observed:\nOn October 20, 2026, Remy Calder was rude to a client." },
      checked: { offense_type: ["standards_of_conduct"] },
    };
    const { reference } = await create();
    const form = await review(reference.instanceId);
    expect(field(form, "offense_type")!.checked).toEqual(["standards_of_conduct"]);
    expect(field(form, "policy_language")!.value).toContain("Source: JBA Policy Manual — Standards of Conduct, p. 12");
    expect(field(form, "policy_language")!.value).not.toMatch(/Cell Phone/);
  });

  it("a named policy is never overridden by a described one", async () => {
    const { create } = await conversation([
      "create verbal CA for remy calder for violating visitors at work policy on 10-10-26. remy was on her cell phone with a friend who visited. no payroll deduct",
    ]);
    state.draft = { values: { observation: "Observed:\nRemy Calder had a visitor." }, checked: {} };
    const { reference } = await create();
    const form = await review(reference.instanceId);
    expect(field(form, "policy_violated")!.value).toBe("Violation of Company Policies — Visitors in the Workplace");
    expect(field(form, "policy_language")!.value).not.toMatch(/Cell Phone/);
  });

  it('"payroll deduct applies" names no policy: the manual\'s Payroll Deductions section is not cited', async () => {
    const { create } = await conversation([
      "create a verbal corrective action form for remy calder. on 10-20-26 remy was rude to a client. payroll deduct applies",
    ]);
    state.draft = {
      values: { observation: "Observed:\nOn October 20, 2026, Remy Calder was rude to a client." },
      checked: { offense_type: ["standards_of_conduct"] },
    };
    const { reference } = await create();
    const form = await review(reference.instanceId);
    expect(field(form, "offense_type")!.checked).toEqual(["standards_of_conduct"]);
    expect(field(form, "policy_language")!.value).not.toContain("Payroll Deductions");
  });
});

/* ========================================================================= */
/* A LATE OPENING, WITH A PAYROLL DEDUCTION AND ITS AMOUNT                   */
/* ========================================================================= */

/*
 * District Manager feedback, 21 Oct 2026: "… payroll deduct DOES apply and
 * state $25 will be payroll deducted" — the form did not say $25 would be
 * deducted.
 */
const G1 =
  "create verbal ca for tess varga for opening the salon late on 10-1-26. previous coaching is jba policy manual 1-1-26. payroll deduct DOES apply and state $25 will be payroll deducted";

const LATE_OPENER_DRAFT = {
  values: { observation: "Observed:\nOn October 1, 2026, Tess Varga opened the salon late." },
  checked: { offense_type: ["tardiness"] },
};

describe("a late opening with a payroll deduction", () => {
  it("reads the date, Verbal, the history and the $25, and the Action Plan states the $25", async () => {
    const { last, proposal, create } = await conversation([G1]);

    expect(proposal.warningLevel).toBe("verbal");
    expect(last.content).toMatch(/\*\*Type of Warning:\*\* Verbal Warning, as you said/);
    expect(proposal.formDate).toBe("2026-10-01");
    expect(proposal.payrollDeduct).toBe("yes");
    expect(last.content).toMatch(/Is payroll deduct applicable\? \*\*Yes\*\*/);

    state.draft = LATE_OPENER_DRAFT;
    const { reference } = await create();
    const form = await review(reference.instanceId);
    const policy = field(form, "policy_language")!.value!;

    expect(field(form, "form_date")!.value).toBe("2026-10-01");
    expect(field(form, "prior_actions")!.value).toBe("Coaching — JBA Policy Manual — signed 01/01/2026");
    expect(field(form, "warning_type")!.checked).toEqual(["verbal"]);
    expect(field(form, "payroll_deduct")!.checked).toEqual(["yes"]);
    expect(field(form, "offense_type")!.checked).toEqual(["tardiness"]);
    expect(policy).toContain("Source: JBA Policy Manual — Late Opening, p. 15");
    expect(policy.indexOf("Late Opening, p. 15")).toBeLessThan(policy.indexOf("Attendance, p. 14"));
    /* The manager's amount, as they wrote it. */
    expect(field(form, "action_plan")!.value).toBe(
      `Management will review the Late Opening and Attendance policies with Tess. $25 will be deducted from Tess's pay. ${CLOSING}`,
    );
  });

  it.each([
    "payroll deduct applies. $25 will be payroll-deducted",
    "a $25 payroll deduction applies",
  ])('"%s" — the Action Plan states the amount', async (payroll) => {
    const { create } = await conversation([
      `create verbal ca for tess varga for opening the salon late on 10-1-26. ${payroll}`,
    ]);
    state.draft = LATE_OPENER_DRAFT;

    const { reference } = await create();
    expect(field(await review(reference.instanceId), "action_plan")!.value).toContain("$25 will be deducted from Tess's pay.");
  });
});

/*
 * QA, 24 Oct 2026 (conv_mvmyre8z2unys1a: the card cited Late Opening p.15 and
 * Attendance p.14), and the same complaint from HR on the sibling app ("noted
 * tardiness/leaving early vs late open policy pg.15"). With
 * LATE_OPEN_DATE_ENABLED a late opening cites Late Opening, p. 15 only.
 */
describe("LATE_OPEN_DATE_ENABLED: a late opening cites Late Opening only", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    [G1],
    ["create verbal ca for tess varga, she was late to open 10-1-26, no payroll"],
  ])("%s", async (account) => {
    vi.stubEnv("LATE_OPEN_DATE_ENABLED", "1");
    const { create } = await conversation([account]);
    state.draft = LATE_OPENER_DRAFT;

    const { reference } = await create();
    const form = await review(reference.instanceId);
    const policy = field(form, "policy_language")!.value!;

    expect(policy).toContain("Source: JBA Policy Manual — Late Opening, p. 15");
    expect(policy).not.toMatch(/Attendance/);
    expect(field(form, "action_plan")!.value).not.toMatch(/Attendance/);
  });
});

/* ========================================================================= */
/* POLICY VIOLATED NAMES THE SECTION DIRECT POLICY LEADS WITH BESIDE ITS BOX */
/* ========================================================================= */

/* District Manager feedback, 21 Oct 2026: "tardiness/leaving early vs late open policy pg.15". */
describe("Policy Violated names a cited section beside any box", () => {
  it("names Late Opening beside the Tardiness box, as Direct policy leads with it", async () => {
    const { create } = await conversation([G1]);
    state.draft = LATE_OPENER_DRAFT;

    const { reference } = await create();
    const form = await review(reference.instanceId);
    expect(field(form, "offense_type")!.checked).toEqual(["tardiness"]);
    expect(field(form, "policy_violated")!.value).toBe("Tardiness/Leaving Early — Late Opening");
  });

  it("a late arrival that is not an opening stays the Tardiness box alone", async () => {
    const { create } = await conversation([
      "create verbal ca for tess varga, she was 20 minutes late for her 2pm shift on 10-1-26. no payroll deduct",
    ]);
    state.draft = {
      values: { observation: "Observed:\nOn October 1, 2026, Tess Varga arrived 20 minutes late." },
      checked: { offense_type: ["tardiness"] },
    };

    const { reference } = await create();
    const form = await review(reference.instanceId);
    expect(field(form, "policy_violated")!.value).toBe("Tardiness/Leaving Early");
    expect(field(form, "action_plan")!.value).toBe(`Management will review the Attendance policy with Tess. ${CLOSING}`);
  });
});

/* ========================================================================= */
/* ON A YES WITH NO AMOUNT, THE ONE THE QUOTED SECTION STATES                */
/* ========================================================================= */

/*
 * District Manager feedback, 21 Oct 2026, the late-opening form: the manual's
 * Late Opening section states what a late opener reimburses ("$25.00 via
 * payroll deduction"), but with payroll deduct Yes and no amount stated the
 * plan said only "A payroll deduction applies."
 */
describe("the payroll amount the quoted section states", () => {
  it("with no amount stated, states the $25.00 the quoted Late Opening section gives", async () => {
    const { create } = await conversation([
      "create verbal ca for tess varga for opening the salon late on 10-1-26. payroll deduct applies",
    ]);
    state.draft = LATE_OPENER_DRAFT;

    const { reference } = await create();
    const form = await review(reference.instanceId);
    expect(field(form, "policy_language")!.value).toContain("$25.00 via payroll deduction");
    expect(field(form, "action_plan")!.value).toBe(
      `Management will review the Late Opening and Attendance policies with Tess. $25.00 will be deducted from Tess's pay. ${CLOSING}`,
    );
    expect(field(form, "action_plan")!.provenance).toMatchObject({ payroll: "$25.00", payrollAmountFrom: "manual" });
  });

  it("the manager's amount wins over the section's", async () => {
    const { create } = await conversation([G1]);
    state.draft = LATE_OPENER_DRAFT;

    const { reference } = await create();
    const plan = field(await review(reference.instanceId), "action_plan")!;
    expect(plan.value).toContain("$25 will be deducted from Tess's pay.");
    expect(plan.value).not.toContain("$25.00");
    expect(plan.provenance).not.toHaveProperty("payrollAmountFrom");
  });

  it("a late arrival cites Attendance alone, and the plan invents no figure", async () => {
    const { create } = await conversation([
      "create verbal ca for tess varga, she was 20 minutes late for her 2pm shift on 10-1-26. payroll deduct applies",
    ]);
    state.draft = {
      values: { observation: "Observed:\nOn October 1, 2026, Tess Varga arrived 20 minutes late." },
      checked: { offense_type: ["tardiness"] },
    };

    const { reference } = await create();
    expect(field(await review(reference.instanceId), "action_plan")!.value).toBe(
      `Management will review the Attendance policy with Tess. A payroll deduction applies. ${CLOSING}`,
    );
  });

  it("on No, the section's figure is not stated", async () => {
    const { create } = await conversation([
      "create verbal ca for tess varga for opening the salon late on 10-1-26. no payroll deduct",
    ]);
    state.draft = LATE_OPENER_DRAFT;

    const { reference } = await create();
    expect(field(await review(reference.instanceId), "action_plan")!.value).toBe(
      `Management will review the Late Opening and Attendance policies with Tess. ${CLOSING}`,
    );
  });
});

/* ========================================================================= */
/* G — A MEETING NOT ATTENDED IS ATTENDANCE, WHERE THE MANUAL SAYS SO         */
/* ========================================================================= */

/*
 * District Manager feedback, 21 Oct 2026: E1 ("for not attending the monthly
 * meeting") was drafted under the Standards of Conduct. The manual's
 * Attendance section counts meetings as scheduled shifts; where it does not
 * say so, the manager is asked, and their answer fills the form.
 */
const ATTENDANCE_WITH_MEETINGS_CHUNK = {
  ...ATTENDANCE_CHUNK,
  content: `${ATTENDANCE_CHUNK.content}\no Synthetic rule: Meetings, Seminars and Training sessions are treated as scheduled shifts. (See Seminar/Webinar\nAttendance section)`,
};
const SEMINAR_CHUNK = {
  chunkIndex: 123,
  page: 38,
  printedPage: 37,
  sections: [{ heading: "Seminar/Webinar Attendance", page: 37 }],
  section: "Seminar/Webinar Attendance",
  content:
    "Seminar/Webinar Attendance\nSynthetic rule: a seminar/webinar missed without notifying your\nSupervisor is treated as a no call no show to a scheduled shift.",
};

describe("G: a meeting not attended is cited where the manual puts it", () => {
  it("reads Attendance from the manual, says why, and the draft ticks Absenteeism over the model's Standards of Conduct", async () => {
    state.manual = {
      chunks: [STANDARDS_OF_CONDUCT_CHUNK, ATTENDANCE_WITH_MEETINGS_CHUNK, SEMINAR_CHUNK, CELL_PHONE_CHUNK],
    };
    const { last, create } = await conversation([E1]);

    expect(last.content).toMatch(
      /\*\*Policy:\*\* "missed the monthly meeting" reads as the policy manual's \*\*Attendance\*\* \(page 14\), which says "Synthetic rule: Meetings, Seminars and Training sessions are treated as scheduled shifts\." I'll quote it on the draft under \*\*Absenteeism\*\* — tell me if a different policy applies\./,
    );
    expect(last.content).not.toMatch(/Which policy applies/);

    state.draft = {
      values: { observation: "Observed:\nTess Varga did not attend the scheduled monthly meeting on October 20, 2026." },
      checked: { offense_type: ["standards_of_conduct"] },
    };
    const { reference } = await create();
    const form = await review(reference.instanceId);
    const policy = field(form, "policy_language")!.value!;

    expect(field(form, "offense_type")!.checked).toEqual(["absenteeism"]);
    expect(field(form, "policy_violated")!.value).toBe("Absenteeism");
    expect(policy).toContain("Synthetic rule: Meetings, Seminars and Training sessions are treated as scheduled shifts.");
    expect(policy).toContain("Source: JBA Policy Manual — Attendance, p. 14");
    expect(policy).not.toMatch(/Standards of Conduct/);
    expect(field(form, "warning_type")!.checked).toEqual(["written"]);
    expect(field(form, "prior_actions")!.value).toBe(
      "Coaching — JBA Policy Manual — signed 01/01/2026\nVerbal corrective action — signed 09/01/2026",
    );
  });

  it("a seminar not attended cites the Seminar/Webinar Attendance section under Absenteeism", async () => {
    state.manual = {
      chunks: [STANDARDS_OF_CONDUCT_CHUNK, ATTENDANCE_WITH_MEETINGS_CHUNK, SEMINAR_CHUNK],
    };
    const { last, create } = await conversation([
      "create a verbal CA for tess varga for skipping the webinar on 10-20-26. no payroll deduct",
    ]);
    expect(last.content).toMatch(/\*\*Policy:\*\* "missed the webinar" reads as the policy manual's \*\*Seminar\/Webinar Attendance\*\* \(page 37\)/);

    state.draft = { values: {}, checked: { offense_type: ["standards_of_conduct"] } };
    const { reference } = await create();
    const form = await review(reference.instanceId);
    expect(field(form, "offense_type")!.checked).toEqual(["absenteeism"]);
    expect(field(form, "policy_violated")!.value).toBe("Absenteeism — Seminar/Webinar Attendance");
    expect(field(form, "policy_language")!.value).toContain("is treated as a no call no show to a scheduled shift");
  });

  /* Owner decision, 22 Oct 2026: a missed meeting is Attendance, so this no longer asks "which policy?" first. */
  it("where the manual does not say, it is still Attendance — and the form says so", async () => {
    // The manual as the other tests hold it: its Attendance section says nothing about meetings.
    const { responses, create } = await conversation([E1]);

    expect(responses[0]!.content).not.toMatch(/Which policy applies/);
    expect(responses[0]!.content).toMatch(/\*\*Policy:\*\* Attendance — missing the monthly meeting is an absence from a scheduled shift\./);

    state.draft = { values: {}, checked: { offense_type: ["standards_of_conduct"] } };
    const { reference } = await create();
    const form = await review(reference.instanceId);
    expect(field(form, "offense_type")!.checked).toEqual(["absenteeism"]);
    expect(field(form, "policy_language")!.value).toContain("Source: JBA Policy Manual — Attendance, p. 14");
    expect(field(form, "warning_type")!.checked).toEqual(["written"]);
    expect(field(form, "prior_actions")!.value).toBe(
      "Coaching — JBA Policy Manual — signed 01/01/2026\nVerbal corrective action — signed 09/01/2026",
    );
  });

  it('answered "standards of conduct", the form is the Standards of Conduct', async () => {
    const { create } = await conversation([E1, "standards of conduct"]);
    state.draft = { values: {}, checked: { offense_type: ["absenteeism"] } };
    const { reference } = await create();
    const form = await review(reference.instanceId);
    expect(field(form, "offense_type")!.checked).toEqual(["standards_of_conduct"]);
    expect(field(form, "policy_language")!.value).toContain("Standards of Conduct");
  });
});

/* ========================================================================= */
/* QA, 22 Oct 2026 — HR's incidents, end to end (mocked)                      */
/* ========================================================================= */

/*
 * Synthetic people only. The routes, the proposal flow, the drafting guard
 * and the store are the real code; Supabase is the in-memory fake and the
 * model's tool call is `state.draft`. "Reopen" is a fresh GET of the stored
 * form, which is what the chat card and Form Monitoring both do.
 */
async function finalize(id: string, acknowledge = false) {
  joinOverview();
  const response = await instanceRoute.POST(
    new Request(`https://app.test/api/forms/instances/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "finalize", ...(acknowledge ? { acknowledgeUnverifiedPolicy: true } : {}) }),
    }),
    { params: Promise.resolve({ id }) },
  );
  return { status: response.status, body: (await response.json()) as { error?: string; code?: string } };
}

/** The card's Save: every value on the card, as the browser sends it. */
async function saveAll(id: string, changes: Record<string, string>) {
  const current = await review(id);
  const values = Object.fromEntries(current.values.map((entry) => [entry.fieldKey, entry.value ?? ""]));
  joinOverview();
  const response = await instanceRoute.PATCH(
    new Request(`https://app.test/api/forms/instances/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ values: { ...values, ...changes } }),
    }),
    { params: Promise.resolve({ id }) },
  );
  expect(response.status).toBe(200);
}

/**
 * The chat as it really runs: a turn the form intake does not take goes to an
 * ordinary answer (stood in for here), stays in the history, and the open card
 * is still the one continued. Returns which turns the intake took.
 */
async function chatTurns(turns: string[]) {
  const messages: ChatMessage[] = [];
  const taken: boolean[] = [];
  /* Whether the form intake answered the turn at all, rather than an ordinary answer. */
  const replied: boolean[] = [];
  let lastProposal: NonNullable<Awaited<ReturnType<typeof proposeFormForTurn>>> | null = null;
  let open: string | undefined;
  for (const text of turns) {
    const message = said(text);
    const response = await proposeFormForTurn({
      history: messages,
      question: message.content,
      questionMessageId: message.id,
      actor: { role: state.role as never, scope: state.scope as AccessScope },
      summaries: await listTemplateSummaries(),
      today: "2026-10-21",
      policyManual: async () => (state.manual?.chunks as never) ?? null,
      ...(open ? { continueTemplateKey: open } : {}),
    });
    taken.push(Boolean(response?.formProposal));
    replied.push(response !== null && response !== undefined);
    if (response?.formProposal) {
      lastProposal = response;
      open = response.formProposal.templateKey;
    }
    messages.push(message, {
      id: `a${sequence}`,
      role: "assistant",
      content: response?.content ?? "Noted.",
      createdAt: "2026-10-21T15:00:01Z",
      ...(response?.formProposal ? { formProposal: response.formProposal } : {}),
    } as ChatMessage);
  }
  return {
    taken,
    replied,
    get last() {
      return lastProposal!;
    },
    // Read only where a form was proposed; a turn that started none leaves it unread.
    get proposal() {
      return lastProposal!.formProposal!;
    },
    create: async () => createInlineForm({ proposal: lastProposal!.formProposal!, messages, call, onCreated: () => {} }),
  };
}

const WOVEN_OBSERVATION = {
  values: { observation: "Observed:\nTess Varga did not complete the assigned Woven items by the October 15, 2026 deadline." },
  checked: { offense_type: ["standards_of_conduct"] },
};

/* HR, 21 Oct 2026, four turns, the name replaced. */
const WOVEN_DEADLINE_TURNS = [
  "create a verbal corrective action for tess varga for missing the 10-15-26 woven deadline",
  "prior coaching JBA Policy Manual 7-29-26",
  "no payroll deduct",
  "Create a Corrective Action Form from this conversation.",
];

describe("QA 22 Oct: the 21 Oct Woven-deadline conversation, created, saved, reopened, finalized", () => {
  it("keeps every turn's answer on one draft, cites Sunny's own manual, and a Save does not un-verify it", async () => {
    const { proposal, last, create } = await chatTurns(WOVEN_DEADLINE_TURNS);
    expect(proposal.employeeName).toBe("Tess Varga");
    expect(proposal.warningLevel).toBe("verbal");
    expect(proposal.payrollDeduct).toBe("no");
    expect(last.content).toMatch(/Standards of Conduct/);

    state.draft = WOVEN_OBSERVATION;
    const { reference } = await create();
    const form = await review(reference.instanceId);
    expect(field(form, "warning_type")!.checked).toEqual(["verbal"]);
    expect(field(form, "payroll_deduct")!.checked).toEqual(["no"]);
    expect(field(form, "prior_actions")!.value).toContain("07/29/2026");
    expect(field(form, "offense_type")!.checked).toEqual(["standards_of_conduct"]);
    expect(field(form, "policy_language")!.value).toContain("Source: JBA Policy Manual — Standards of Conduct, p. 12");
    expect(field(form, "policy_language")!.provenance?.verified).toBe(true);
    // Sunny's tenant only: nothing from another company's sources.
    expect(JSON.stringify(form.values)).not.toMatch(/Buff City|Bubbles|BCS\b|Makery/i);
    expect(form.values.some((entry) => /signature/i.test(entry.fieldKey))).toBe(false);

    // 21 Oct: Save sent every value and the policy came back unverified.
    await saveAll(reference.instanceId, { observation: "Observed:\nTess Varga missed the 10/15/2026 Woven deadline." });
    const saved = await review(reference.instanceId);
    expect(field(saved, "policy_language")!.provenance?.verified).toBe(true);
    expect(field(saved, "observation")!.value).toContain("10/15/2026 Woven deadline");
    expect(field(saved, "prior_actions")!.value).toBe(field(form, "prior_actions")!.value);

    expect((await finalize(reference.instanceId)).status).toBe(200);
  });

  it("a rewritten quote asks before Finalize and says the wording was edited", async () => {
    const { create } = await chatTurns(WOVEN_DEADLINE_TURNS);
    state.draft = WOVEN_OBSERVATION;
    const { reference } = await create();

    await saveAll(reference.instanceId, { policy_language: " The Company expects Employees to follow rules of conduct." });
    const refused = await finalize(reference.instanceId);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("policy_verification_required");
    expect(refused.body.error).toMatch(/^You edited the policy wording on this form/);
    expect((await finalize(reference.instanceId, true)).status).toBe(200);
  });
});

describe("QA 22 Oct: the 22 Oct one-message request", () => {
  const MESSAGE =
    "make corrective action for tess varga. this is a verbal. previous coaching JBA Policy Manual 7-29-26. payroll deduct not applicable";

  it("reads the level, the history and the payroll answer, and invents no incident", async () => {
    const { proposal, last, create } = await conversation([MESSAGE]);
    expect(proposal.warningLevel).toBe("verbal");
    expect(proposal.payrollDeduct).toBe("no");
    expect(last.content).not.toMatch(/You'll set the verbal\/written warning level/);
    expect(last.content).toMatch(/\*\*Type of Warning:\*\* Verbal Warning, as you said|Verbal Warning, as you said/);

    // The model is given nothing to describe and writes nothing.
    state.draft = { values: {}, checked: {} };
    const { reference } = await create();
    const form = await review(reference.instanceId);
    expect(field(form, "warning_type")!.checked).toEqual(["verbal"]);
    expect(field(form, "payroll_deduct")!.checked).toEqual(["no"]);
    expect(field(form, "observation")?.value ?? "").toBe("");
    expect(field(form, "offense_type")?.checked ?? []).toEqual([]);
  });

  it("the account given in the next turn is drafted onto the same request", async () => {
    const { proposal, create } = await conversation([
      MESSAGE,
      "she missed the 10-15-26 woven deadline",
    ]);
    expect(proposal.warningLevel).toBe("verbal");
    expect(proposal.payrollDeduct).toBe("no");

    state.draft = WOVEN_OBSERVATION;
    const { reference } = await create();
    const form = await review(reference.instanceId);
    expect(field(form, "warning_type")!.checked).toEqual(["verbal"]);
    expect(field(form, "prior_actions")!.value).toContain("07/29/2026");
    expect(field(form, "offense_type")!.checked).toEqual(["standards_of_conduct"]);
    expect(described()).toContain("woven deadline");
  });
});

/*
 * QA, 22 Oct 2026: production, 21 Oct, answered "prior coaching JBA Policy
 * Manual 7-29-26" as a question while the card was open. Every turn of that
 * conversation now continues the card (`statesOpenCorrectiveActionFact`).
 */
describe("QA 22 Oct: answers while the card is open", () => {
  it("every turn of the 21 Oct conversation continues the card", async () => {
    const { taken } = await chatTurns(WOVEN_DEADLINE_TURNS);
    expect(taken).toEqual([true, true, true, true]);
  });
});

describe("QA 22 Oct: answers given one at a time while the card is open", () => {
  const TURNS = [
    "create a CA for tess varga for missing the 10-15-26 woven deadline",
    "verbal",
    "prior coaching JBA Policy Manual 1-1-26, verbal ca 9-1-26",
    "no payroll deduct",
  ];

  it("the final card holds every answer", async () => {
    const { taken, proposal, create } = await chatTurns(TURNS);
    expect(taken).toEqual([true, true, true, true]);
    expect(proposal.warningLevel).toBe("verbal");
    expect(proposal.payrollDeduct).toBe("no");

    state.draft = WOVEN_OBSERVATION;
    const { reference } = await create();
    const form = await review(reference.instanceId);
    expect(field(form, "warning_type")!.checked).toEqual(["verbal"]);
    expect(field(form, "payroll_deduct")!.checked).toEqual(["no"]);
    expect(field(form, "prior_actions")!.value).toBe(
      "Coaching — JBA Policy Manual — signed 01/01/2026\nVerbal corrective action — signed 09/01/2026",
    );
    expect(field(form, "offense_type")!.checked).toEqual(["standards_of_conduct"]);
  });
});

describe("QA 22 Oct: Woven-deadline wording not in any earlier example", () => {
  it.each([
    "need a verbal ca for tess varga, she blew the 10/15/26 woven deadline. payroll deduct no",
    "create a verbal corrective action for tess varga — her woven training was overdue on 10/15/26. payroll deduct n/a",
  ])("%s", async (text) => {
    const { proposal, last, create } = await chatTurns([text]);
    expect(proposal.employeeName).toBe("Tess Varga");
    expect(proposal.warningLevel).toBe("verbal");
    expect(proposal.payrollDeduct).toBe("no");
    expect(last.content).toMatch(/Standards of Conduct/);

    state.draft = { ...WOVEN_OBSERVATION, checked: { offense_type: ["under_performance"] } };
    const { reference } = await create();
    const form = await review(reference.instanceId);
    expect(field(form, "offense_type")!.checked).toEqual(["standards_of_conduct"]);
    expect(field(form, "prior_actions")?.value ?? "").toBe("");
  });
});

/*
 * QA, 22 Oct 2026, round 2: requests worded the way managers word them, none
 * of them an earlier example. Each is created and the stored form read back.
 * The first two were known gaps in round 1.
 */
describe("QA 22 Oct: requests in new wording, through to the saved form", () => {
  it.each([
    // [message, level, payroll, date]
    ["tess varga didn't finish her woven items by 10-15-26. create a verbal CA for her. no payroll deduct", "verbal", "no", "2026-10-15"],
    ["write up tess varga, verbal warning. she blew the 10/15/26 woven deadline. no payroll deduction", "verbal", "no", "2026-10-15"],
    ["please write tess varga up — verbal — she missed the woven deadline on 10/15/26", "verbal", null, "2026-10-15"],
    ["can you write up tess varga? she missed the 10/15/26 woven deadline. it's a verbal", "verbal", null, "2026-10-15"],
    ["Tess Varga needs a written CA for missing the woven deadline on 10-15-26", "written", null, "2026-10-15"],
    ["verbal CA for tess varga: woven items overdue since 10/15/26. payroll deduct not applicable", "verbal", "no", "2026-10-15"],
    // A date given only as the deadline never dates the form (release decision F-03).
    ["woven deadline 10/15/26 missed — tess varga. verbal ca please", "verbal", null, null],
    ["Tess Varga missed the woven deadline on 10/15/26. Create a verbal CA for her.", "verbal", null, "2026-10-15"],
  ])("%s", async (text, level, payroll, date) => {
    const { proposal, create } = await chatTurns([text]);
    expect(proposal.templateKey).toBe("dpoa");
    expect(proposal.employeeName).toBe("Tess Varga");
    expect(proposal.warningLevel ?? null).toBe(level);
    expect(proposal.payrollDeduct ?? null).toBe(payroll);
    expect(proposal.formDate ?? null).toBe(date);

    state.draft = WOVEN_OBSERVATION;
    const { reference } = await create();
    const form = await review(reference.instanceId);
    expect(field(form, "employee_name")!.value).toBe("Tess Varga");
    expect(field(form, "warning_type")!.checked).toEqual([level]);
    expect(field(form, "payroll_deduct")?.checked ?? []).toEqual(payroll ? [payroll] : []);
    expect(field(form, "offense_type")!.checked).toEqual(["standards_of_conduct"]);
    expect(field(form, "prior_actions")?.value ?? "").toBe("");
  });

  it("\"Write up Tess Varga for missing the meeting.\" opens her form and asks what it does not know", async () => {
    const { proposal, last } = await chatTurns(["Write up Tess Varga for missing the meeting."]);
    expect(proposal.employeeName).toBe("Tess Varga");
    expect(proposal.warningLevel ?? null).toBeNull();
    expect(last.content).toMatch(/payroll deduct applicable/i);
  });

  it("a level on file is never this form's", async () => {
    const { proposal } = await chatTurns([
      "tess varga had a written CA in august. she missed the 10/15/26 woven deadline. verbal ca please",
    ]);
    expect(proposal.warningLevel).toBe("verbal");
  });
});

describe("QA 22 Oct: corrections while the card is open, before Create", () => {
  it("every turn updates the same card, the latest answer wins, and nothing earlier is lost", async () => {
    const { taken, proposal, create } = await chatTurns([
      "create a CA for tess varga for missing the woven deadline",
      "it was on 10/15/26",
      "make it written",
      "actually verbal",
      "prior coaching jba policy manual 7-29-26",
      "no payroll deduct",
    ]);
    expect(taken).toEqual([true, true, true, true, true, true]);
    expect(proposal.warningLevel).toBe("verbal");
    expect(proposal.payrollDeduct).toBe("no");
    expect(proposal.formDate).toBe("2026-10-15");

    state.draft = WOVEN_OBSERVATION;
    const { reference } = await create();
    const form = await review(reference.instanceId);
    expect(field(form, "warning_type")!.checked).toEqual(["verbal"]);
    expect(field(form, "form_date")!.value).toBe("2026-10-15");
    expect(field(form, "payroll_deduct")!.checked).toEqual(["no"]);
    expect(field(form, "prior_actions")!.value).toBe("Coaching — JBA Policy Manual — signed 07/29/2026");
    expect(store.form_instances).toHaveLength(1);
  });
});

/*
 * A second Create for the same card — a lost response retried, a second tab,
 * the conversation reopened — returns the draft already filed (QA, 22 Oct
 * 2026; `cardInstanceId` in `instances.ts`).
 */
describe("QA 22 Oct: a repeated Create", () => {
  it("reuses the draft instead of filing a second", async () => {
    const { create } = await chatTurns(WOVEN_DEADLINE_TURNS);
    state.draft = WOVEN_OBSERVATION;
    const first = await create();
    const second = await create();
    expect(second.reference.instanceId).toBe(first.reference.instanceId);
    expect(store.form_instances).toHaveLength(1);
  });
});

/*
 * ============================================================================
 * ROUND 3 (QA, 22 Oct 2026): HOW MANAGERS ACTUALLY TYPE IT, THROUGH TO THE SAVED FORM
 * ============================================================================
 *
 * Two sets of phrasings: the ten the round-3 report found wanting, and sixteen
 * written afterwards, without looking at the readers, to test wording nobody
 * tuned for. Each conversation runs through the real proposal flow, is
 * created, and the SAVED form is read back — never only the card. Every turn
 * after the first request must stay with the form (no ordinary answer in the
 * middle of an account). `offense` null leaves the box unchecked here: lateness
 * and a short register are asked about rather than guessed.
 */
const NEUTRAL_DRAFT = { values: { observation: "Observed:\nAs the manager described." }, checked: {} };

type Round3Case = {
  turns: string[];
  employee: string;
  level: "verbal" | "written";
  payroll: "yes" | "no";
  /* null: a date given only as a deadline ("due 10/15/26") never dates the form (release decision F-03). */
  date: string | null;
  offense: string | null;
  /* POLICY_SPECIFIC_TOPICS_ENABLED: a register or drawer shortage is the Standards of Conduct (page 13), ticked where the model ticked nothing. */
  offenseOn?: string;
  prior: RegExp | "" | "none";
};

const ROUND3_CASES: Round3Case[] = [
  // The ten from the round-3 report.
  { turns: ["Hey, I need to document a written warning for Tess Varga — she didn't show for our 10/20/26 staff meeting. No deduction from her pay. She got coached on the handbook back on 1/1/26."], employee: "Tess Varga", level: "written", payroll: "no", date: "2026-10-20", offense: "absenteeism", prior: /^Coaching — signed 01\/01\/2026$/ },
  { turns: ["tess varga — no call to the 10/20/26 manager meeting, issue a verbal, previously verbally warned 9/1/26, payroll not applicable"], employee: "Tess Varga", level: "verbal", payroll: "no", date: "2026-10-20", offense: "absenteeism", prior: /^Verbal warning — signed 09\/01\/2026$/ },
  { turns: ["Doc a CA on Tess Varga. Missed mandatory meeting 10.20.26. Level: written. Payroll ded: N"], employee: "Tess Varga", level: "written", payroll: "no", date: "2026-10-20", offense: "absenteeism", prior: "" },
  { turns: ["Can we put Tess Varga on a written for skipping the 10/20/26 meeting? She's had a verbal before on 9/1/26. Don't deduct."], employee: "Tess Varga", level: "written", payroll: "no", date: "2026-10-20", offense: "absenteeism", prior: /^Verbal warning — signed 09\/01\/2026$/ },
  { turns: ["I'd like a verbal corrective for Remy Calder, register was $5 short on 10/19/26, $5 payroll deduction applies"], employee: "Remy Calder", level: "verbal", payroll: "yes", date: "2026-10-19", offense: null, offenseOn: "standards_of_conduct", prior: "" },
  { turns: ["remy calder came in 45 min late on 10/19/26 — write her up, verbal, payroll deduct none"], employee: "Remy Calder", level: "verbal", payroll: "no", date: "2026-10-19", offense: null, prior: "" },
  { turns: ["I have to write someone up", "Tess Varga", "she skipped the monthly meeting on 10/20/26", "written", "she had coaching on the jba manual 1/1/26 and a verbal ca 9/1/26", "no deduction"], employee: "Tess Varga", level: "written", payroll: "no", date: "2026-10-20", offense: "absenteeism", prior: /^Coaching — signed 01\/01\/2026\nVerbal corrective action — signed 09\/01\/2026$/ },
  { turns: ["need a CA for tess varga for missing the 10/20/26 meeting, verbal", "sorry, make that written", "wait, the meeting was 10/19/26", "she was coached 1-1-26 on the jba manual", "payroll deduct n/a"], employee: "Tess Varga", level: "written", payroll: "no", date: "2026-10-19", offense: "absenteeism", prior: /^Coaching — signed 01\/01\/2026$/ },
  { turns: ["tess varga blew off her woven training due 10/15/26", "can you start a verbal ca for that", "first offense", "no payroll"], employee: "Tess Varga", level: "verbal", payroll: "no", date: null, offense: "standards_of_conduct", prior: "none" },
  // Written afterwards, unseen by the readers.
  { turns: ["Tess Varga missed our team meeting yesterday 10/21/26 without telling anyone. I want to give her a written. No payroll deduction. She was coached on attendance 8/15/26."], employee: "Tess Varga", level: "written", payroll: "no", date: "2026-10-21", offense: "absenteeism", prior: /^Coaching.* — signed 08\/15\/2026$/ },
  { turns: ["Need to write up Remy Calder. He was 30 minutes late to his shift on 10/18/26. Verbal warning. Payroll deduct: no."], employee: "Remy Calder", level: "verbal", payroll: "no", date: "2026-10-18", offense: null, prior: "" },
  { turns: ["remy calder's drawer came up $20 short on 10/17/26. lets do a written ca, deduct the $20 from payroll"], employee: "Remy Calder", level: "written", payroll: "yes", date: "2026-10-17", offense: null, offenseOn: "standards_of_conduct", prior: "" },
  { turns: ["could you draft a verbal corrective action for Tess Varga? she skipped the 10/14/26 store meeting. not deducting pay"], employee: "Tess Varga", level: "verbal", payroll: "no", date: "2026-10-14", offense: "absenteeism", prior: "" },
  { turns: ["Tess Varga ditched the 10/20/26 all-hands meeting. Final step isn't needed yet, just a verbal. Payroll: N/A. No prior coaching."], employee: "Tess Varga", level: "verbal", payroll: "no", date: "2026-10-20", offense: "absenteeism", prior: "none" },
  { turns: ["Please document a written CA for Remy Calder — she didn't finish her Woven modules by the 10/12/26 deadline. She got a verbal for the same thing 9/10/26. No deduction."], employee: "Remy Calder", level: "written", payroll: "no", date: null, offense: "standards_of_conduct", prior: /^Verbal warning.* — signed 09\/10\/2026$/ },
  { turns: ["I need a corrective action", "it's for remy calder", "she ignored her woven training that was due 10/16/26", "verbal", "nothing prior", "no deduct"], employee: "Remy Calder", level: "verbal", payroll: "no", date: null, offense: "standards_of_conduct", prior: "none" },
  { turns: ["tess varga needs a write up", "she bailed on the 10/19/26 meeting", "make it a written warning", "oh and she had a verbal 9/2/26", "payroll no"], employee: "Tess Varga", level: "written", payroll: "no", date: "2026-10-19", offense: "absenteeism", prior: /^Verbal warning — signed 09\/02\/2026$/ },
  { turns: ["write up for tess varga, missed meeting 10/20/26, written", "actually make it verbal", "no payroll deduction"], employee: "Tess Varga", level: "verbal", payroll: "no", date: "2026-10-20", offense: "absenteeism", prior: "" },
  { turns: ["corrective action for remy calder for being late 10/15/26, verbal, no deduct", "correction: it was 10/16/26 not 10/15"], employee: "Remy Calder", level: "verbal", payroll: "no", date: "2026-10-16", offense: null, prior: "" },
  { turns: ["Remy Calder - CA - written - no call no show to manager meeting 10/13/26 - payroll deduction no - prior coaching 7/1/26"], employee: "Remy Calder", level: "written", payroll: "no", date: "2026-10-13", offense: "absenteeism", prior: /^Coaching — signed 07\/01\/2026$/ },
  { turns: ["Hi, can you help me start a written warning for Tess Varga? She never came to the 10/20/26 monthly meeting. We aren't docking her pay."], employee: "Tess Varga", level: "written", payroll: "no", date: "2026-10-20", offense: "absenteeism", prior: "" },
  { turns: ["I'd like to issue Remy Calder a verbal for showing up late on 10/18/26. No payroll deduction. First time."], employee: "Remy Calder", level: "verbal", payroll: "no", date: "2026-10-18", offense: null, prior: "none" },
];

describe("QA 22 Oct, round 3: everyday wording, single messages and multi-turn, through to the saved form", () => {
  /*
   * Each case runs with the flag OFF (the expectation main has always had) and,
   * where POLICY_SPECIFIC_TOPICS_ENABLED changes it on purpose, again with it ON:
   * a register or drawer shortage is the Standards of Conduct (page 13), ticked
   * where the model ticked nothing. The flag is set explicitly either way.
   */
  afterEach(() => vi.unstubAllEnvs());
  const round3 = async (c: Round3Case, on: boolean) => {
    vi.stubEnv("POLICY_SPECIFIC_TOPICS_ENABLED", on ? "true" : "");
    const { taken, replied, proposal, create } = await chatTurns(c.turns);
    // Once the form is asked for, every later turn stays with it.
    const first = taken.indexOf(true);
    expect(first, "no turn produced the form").toBeGreaterThanOrEqual(0);
    expect(replied.slice(first), "a turn after the request left the form").toEqual(replied.slice(first).map(() => true));
    expect(taken.slice(first)).toEqual(taken.slice(first).map(() => true));

    expect(proposal.templateKey).toBe("dpoa");
    expect(proposal.employeeName).toBe(c.employee);
    expect(proposal.warningLevel).toBe(c.level);
    expect(proposal.payrollDeduct).toBe(c.payroll);
    expect(proposal.formDate).toBe(c.date);

    state.draft = NEUTRAL_DRAFT;
    const { reference } = await create();
    const form = await review(reference.instanceId);
    expect(field(form, "employee_name")!.value).toBe(c.employee);
    expect(field(form, "warning_type")!.checked).toEqual([c.level]);
    expect(field(form, "payroll_deduct")!.checked).toEqual([c.payroll]);
    if (c.date) expect(field(form, "form_date")!.value).toBe(c.date);
    else expect(field(form, "form_date")?.value ?? "").not.toMatch(/^2026-10-1[256]$/);
    const offense = on && c.offenseOn ? c.offenseOn : c.offense;
    expect(field(form, "offense_type")?.checked ?? []).toEqual(offense ? [offense] : []);
    const prior = field(form, "prior_actions")?.value ?? "";
    if (c.prior === "none") expect(prior).toBe("None — first occurrence");
    else if (c.prior === "") expect(prior).toBe("");
    else expect(prior).toMatch(c.prior);
  };

  it.each(ROUND3_CASES.map((c) => [c.turns.join(" ⏎ "), c] as const))("%s", (_label, c) => round3(c, false));

  it.each(ROUND3_CASES.filter((c) => c.offenseOn).map((c) => [c.turns.join(" ⏎ "), c] as const))(
    "POLICY_SPECIFIC_TOPICS_ENABLED on: %s",
    (_label, c) => round3(c, true),
  );

  it.each([
    "What's our policy on missing meetings?",
    "how do I write up an employee?",
    "can you give me a written summary of the attendance policy",
    "I want everyone to get a written copy of the schedule",
  ])("a question or an unrelated request starts no form: %s", async (text) => {
    const { taken } = await chatTurns([text]);
    expect(taken).toEqual([false]);
  });
});

/* ========================================================================= */
/* "CREATE CA FOR <NAME>" IS THE RECIPIENT; THE INCIDENT'S OTHER NAMES ARE NOT */
/* ========================================================================= */

/*
 * The production request word for word, with only the two people's names
 * replaced by synthetic ones. Sunny asked "Which of them is this Corrective
 * Action Form for — <the recipient> or <the new hire>?", then which salon,
 * and no form was made.
 */
const RECIPIENT_REPORT =
  "create ca for Marisol Quade, Salon Director for violating standards of conduct. Marisol failed to have Jaya Penrose complete required policy acknowledgements in woven during Jaya's onboarding on 9-28-26 as reflected on the woven policy acknowledgement report run on 10-16-26.";

/* The manual's words under its own heading, as the draft must quote them. */
const STANDARDS_OF_CONDUCT_TEXT = STANDARDS_OF_CONDUCT_CHUNK.content.replace(/^12 \| P a g e\nStandards of Conduct\n/, "");

const ACKNOWLEDGEMENT_DRAFT = {
  values: {
    observation:
      "Observed:\nRemy Calder did not have Tess Varga complete the required policy acknowledgements in Woven during onboarding on September 28, 2026.",
  },
  checked: { offense_type: ["other"] },
};

async function finalizeRequest(id: string) {
  const response = await instanceRoute.POST(
    new Request(`https://app.test/api/forms/instances/${id}`, {
      method: "POST",
      body: JSON.stringify({ action: "finalize" }),
    }),
    { params: Promise.resolve({ id }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe("the production request names Marisol Quade as the recipient", () => {
  it("is not asked which of the two it is for, and reads Standards of Conduct", async () => {
    const { last, proposal } = await conversation([RECIPIENT_REPORT]);

    expect(last.content).not.toMatch(/Which of them/);
    expect(last.content).not.toMatch(/Who is this/);
    expect(proposal.employeeName).toBe("Marisol Quade");
    expect(proposal.status).toBe("ready");
    expect(proposal.employeeRole).toBe("Salon Director");
    expect(last.content).toMatch(/\*\*Policy:\*\* Standards of Conduct, as you said/);
    /* Not on this salon's roster: the typed name is kept, and the manager is told. */
    expect(last.content).toContain("I didn't find **Marisol Quade** in the employee list for your salons");
  });

  it("drafts for Marisol Quade, keeps Jaya Penrose in the account, and quotes the manual", async () => {
    const { create } = await conversation([RECIPIENT_REPORT]);
    state.draft = {
      values: { observation: "Observed:\nMarisol Quade did not have Jaya Penrose complete the required policy acknowledgements." },
      checked: { offense_type: ["other"] },
    };
    const { reference } = await create();
    const form = await review(reference.instanceId);

    expect(form.instance.status).toBe("draft");
    expect(field(form, "employee_name")!.value).toBe("Marisol Quade");
    expect(field(form, "job_title")!.value).toBe("Salon Director");
    expect(field(form, "offense_type")!.checked).toEqual(["standards_of_conduct"]);
    expect(field(form, "policy_violated")!.value).toBe("Standards of Conduct");
    expect(field(form, "policy_language")!.value).toContain(STANDARDS_OF_CONDUCT_TEXT);
    expect(field(form, "policy_language")!.value).toContain("Source: JBA Policy Manual — Standards of Conduct, p. 12");
    expect(field(form, "policy_language")!.provenance).toMatchObject({ verified: true });
    /* Jaya Penrose is the incident's, not the form's: the model is given the whole account. */
    expect(state.modelNotes.at(-1)).toContain("Jaya Penrose");
    expect(state.modelNotes.at(-1)).not.toMatch(/Which of them/);
  });

  /*
   * The reporting account is a District Manager with global scope, and the
   * directory places the recipient at two salons — so the salon is the one
   * question, and its choices are Marisol's salons, never Jaya's. Directory rows
   * here are synthetic.
   */
  it("as the reporting account's own scope (district manager, global): the salon is asked among Marisol's, never the employee", async () => {
    state.role = "district_manager";
    state.scope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
    state.directory = [
      ...DIRECTORY,
      { id: "e-10", firstName: "Marisol", lastName: "Quade", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0310", "loc-0311"] },
      { id: "e-11", firstName: "Jaya", lastName: "Penrose", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0312"] },
    ];
    const { last, proposal, create } = await conversation([RECIPIENT_REPORT]);

    expect(last.content).not.toMatch(/Which of them/);
    expect(last.content).toMatch(/Which salon is this about\?/);
    expect(proposal).toMatchObject({
      employeeName: "Marisol Quade",
      status: "needs_location",
      locationResolution: "needs_selection",
      locationId: null,
      authorizedLocationIds: ["loc-0310", "loc-0311"],
    });

    /* The card's salon picker, then Create draft. */
    state.draft = { values: { observation: "Observed:\nMarisol Quade did not complete onboarding acknowledgements." }, checked: {} };
    const { reference } = await create("loc-0311");
    const form = await review(reference.instanceId);
    expect(form.instance.status).toBe("draft");
    expect(form.instance.locationId).toBe("loc-0311");
    expect(field(form, "employee_name")!.value).toBe("Marisol Quade");
    expect(field(form, "policy_language")!.value).toContain(STANDARDS_OF_CONDUCT_TEXT);
  });

  it("global scope with no directory row for the recipient: no salon is invented", async () => {
    const previous = process.env.GLOBAL_SALON_ASK_ENABLED;
    process.env.GLOBAL_SALON_ASK_ENABLED = "1";
    try {
      state.role = "district_manager";
      state.scope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
      const { last, proposal } = await conversation([RECIPIENT_REPORT]);
      // The card is built and the salon is asked once. The draft is not blocked. No salon id is filled in.
      expect(proposal).toMatchObject({
        employeeName: "Marisol Quade",
        status: "ready",
        locationResolution: "needs_selection",
        locationId: null,
        supportsInlineDraft: true,
      });
      expect(last.content.match(/which salon is this about/gi)).toHaveLength(1);
      expect(proposal.authorizedLocationIds.length).toBeGreaterThan(1);
    } finally {
      if (previous === undefined) delete process.env.GLOBAL_SALON_ASK_ENABLED;
      else process.env.GLOBAL_SALON_ASK_ENABLED = previous;
    }
  });
});

describe("the recipient is whoever the CA is for, wherever the request says it", () => {
  it.each([
    [
      "first",
      "create ca for Remy Calder for violating standards of conduct. Remy failed to have Tess Varga complete policy acknowledgements in woven on 9-28-26.",
    ],
    [
      "middle",
      "Tess Varga started on 9-28-26. Please create a corrective action for Remy Calder, Salon Director, for violating standards of conduct; Remy never had Tess complete her woven acknowledgements.",
    ],
    [
      "last",
      "Tess Varga did not complete her policy acknowledgements in woven during onboarding on 9-28-26. create ca for Remy Calder for violating standards of conduct",
    ],
  ])("named %s in the message", async (_where, request) => {
    const { last, proposal } = await conversation([request]);
    expect(last.content).not.toMatch(/Which of them/);
    expect(proposal.employeeName).toBe("Remy Calder");
    expect(proposal.status).toBe("ready");
    /* The recipient's own salon, from the directory. */
    expect(proposal.locationId).toBe("loc-0310");
  });

  it("drafts and files for the recipient only, and nothing is finalized until the manager does it", async () => {
    const { create } = await conversation([
      "Tess Varga did not complete her policy acknowledgements in woven during onboarding on 9-28-26. create verbal ca for Remy Calder for violating standards of conduct. no payroll deduct",
    ]);
    state.draft = ACKNOWLEDGEMENT_DRAFT;
    const { reference } = await create();

    /* Create draft: one create, one draft. No finalize. */
    expect(requests.map((entry) => entry.url)).toEqual([
      "/api/forms/instances",
      `/api/forms/instances/${reference.instanceId}/draft`,
    ]);
    let form = await review(reference.instanceId);
    expect(form.instance.status).toBe("draft");
    expect(field(form, "employee_name")!.value).toBe("Remy Calder");
    expect(field(form, "offense_type")!.checked).toEqual(["standards_of_conduct"]);
    expect(field(form, "policy_language")!.value).toContain(STANDARDS_OF_CONDUCT_TEXT);
    expect(field(form, "observation")!.value).toContain("Tess Varga");

    /* The manager reviews and saves an edit … */
    const saved = await instanceRoute.PATCH(
      new Request(`https://app.test/api/forms/instances/${reference.instanceId}`, {
        method: "PATCH",
        body: JSON.stringify({
          values: { observation: `${ACKNOWLEDGEMENT_DRAFT.values.observation}\nReviewed with Remy.` },
        }),
      }),
      { params: Promise.resolve({ id: reference.instanceId }) },
    );
    expect(saved.status).toBe(200);
    form = await review(reference.instanceId);
    expect(form.instance.status).toBe("draft");

    /* … and finalizes it themselves. The verified citation needs no acknowledgement. */
    const finalized = await finalizeRequest(reference.instanceId);
    expect(finalized.status).toBe(200);
    form = await review(reference.instanceId);
    expect(form.instance.status).toBe("finalized");
    expect(field(form, "employee_name")!.value).toBe("Remy Calder");
    expect(field(form, "observation")!.value).toContain("Reviewed with Remy.");
    expect(field(form, "policy_language")!.value).toContain(STANDARDS_OF_CONDUCT_TEXT);
  });
});

describe("a recipient that is not settled is still asked", () => {
  it("two people the CA is for, joined: asked which", async () => {
    const { last, proposal } = await conversation([
      "create ca for Remy Calder and Tess Varga for violating standards of conduct on 10-20-26",
    ]);
    expect(proposal.status).toBe("needs_employee");
    expect(last.content).toMatch(/Which of them is this \*\*Corrective Action Form\*\* for — \*\*Remy Calder\*\* or \*\*Tess Varga\*\*\?/);
  });

  it("a second person named for a CA of their own: asked which", async () => {
    const { proposal } = await conversation([
      "create ca for Remy Calder for violating standards of conduct. Tess Varga needs a CA too.",
    ]);
    expect(proposal.status).toBe("needs_employee");
    expect(proposal.employeeName).toBeNull();
  });

  it("two names and no recipient: the first is not chosen", async () => {
    const { last, proposal } = await conversation([
      "Remy Calder and Tess Varga skipped their woven acknowledgements on 10-20-26. create a ca for violating standards of conduct",
    ]);
    expect(proposal.status).toBe("needs_employee");
    expect(proposal.employeeName).toBeNull();
    expect(last.content).toMatch(/Which of them/);
  });

  it("nobody named: asked who", async () => {
    const { last, proposal } = await conversation(["create a ca for violating standards of conduct on 10-20-26"]);
    expect(proposal.status).toBe("needs_employee");
    expect(last.content).toMatch(/Who is this \*\*Corrective Action Form\*\* for\?/);
  });

  it("a misspelled recipient is confirmed against the roster, not taken", async () => {
    const { last, proposal } = await conversation([
      "create ca for Remy Caldor for violating standards of conduct. Remy failed to have Tess Varga complete acknowledgements.",
    ]);
    expect(proposal.status).not.toBe("ready");
    expect(last.content).toMatch(/^Did you mean \*\*Remy Calder\*\*\?/);
  });

  it("a first name two people on the roster share is put to the manager", async () => {
    state.directory = [
      ...DIRECTORY,
      { id: "e-3", firstName: "Remy", lastName: "Dalton", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0310"] },
    ];
    const { last, proposal } = await conversation([
      "create ca for Remy for violating standards of conduct. Remy failed to have Tess Varga complete acknowledgements.",
    ]);
    expect(proposal.status).not.toBe("ready");
    expect(last.content).toContain("Remy Calder");
    expect(last.content).toContain("Remy Dalton");
  });
});

describe("salon access is unchanged by the recipient reading", () => {
  it("a district manager covering several salons gets the recipient's own salon", async () => {
    state.role = "district_manager";
    state.scope = { level: "salon", primaryAreaId: "loc-0311", alsoCoversAreaIds: ["loc-0310"] };
    const { proposal } = await conversation([
      "create ca for Remy Calder for violating standards of conduct. Remy failed to have Tess Varga complete acknowledgements.",
    ]);
    expect(proposal).toMatchObject({ employeeName: "Remy Calder", locationId: "loc-0310", status: "ready" });
  });

  it("an employee outside the manager's salons is never matched, and never moves the form to their salon", async () => {
    state.role = "district_manager";
    state.scope = { level: "salon", primaryAreaId: "loc-0311", alsoCoversAreaIds: [] };
    /* Somebody at the manager's own salon, so the roster is not empty. */
    state.directory = [
      ...DIRECTORY,
      { id: "e-4", firstName: "Jo", lastName: "Pell", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0311"] },
    ];
    const { last, proposal } = await conversation([
      "create ca for Remy Calder for violating standards of conduct. Remy failed to have Tess Varga complete acknowledgements.",
    ]);
    expect(last.content).toContain("I didn't find **Remy Calder** in the employee list for your salons");
    expect(proposal.locationId).toBe("loc-0311");
  });

  it("a district-scoped account still fails closed on the salon", async () => {
    state.role = "district_manager";
    state.scope = { level: "district", primaryAreaId: "dist-patterson-madeline", alsoCoversAreaIds: [] };
    const { last, proposal } = await conversation([RECIPIENT_REPORT]);
    expect(last.content).not.toMatch(/Which of them/);
    expect(proposal).toMatchObject({ employeeName: "Marisol Quade", locationResolution: "unavailable", supportsInlineDraft: false });
  });

  it("a salon picked outside the manager's own is refused at creation", async () => {
    state.role = "district_manager";
    state.scope = { level: "salon", primaryAreaId: "loc-0311", alsoCoversAreaIds: ["loc-0312"] };
    const { create } = await conversation([RECIPIENT_REPORT]);
    await expect(create("loc-0310")).rejects.toThrow();
    expect(store.form_instances).toHaveLength(0);
  });

  it("an employee account cannot create one at all", async () => {
    state.role = "employee";
    const response = await proposeFormForTurn({
      history: [],
      question: RECIPIENT_REPORT,
      questionMessageId: "m-employee",
      actor: { role: "employee" as never, scope: state.scope as AccessScope },
      summaries: await listTemplateSummaries(),
      today: "2026-10-21",
      policyManual: async () => null,
    });
    expect(response?.formProposal).toBeUndefined();
  });
});

/*
 * Owner decision, 22 Oct 2026: "Warning only, no block". A manual found only by
 * its title is not claimed as the approved source — the citation is stored
 * `matchedBy: "fallback"` and the form card shows a notice (see
 * policySourceNoticeFor in inline-form.tsx) — but saving and Finalize work
 * exactly as before, with no extra acknowledgement step.
 */
describe("owner decision, 22 Oct 2026: a manual found only by its title warns but does not block", () => {
  it("drafts, saves and finalizes without an acknowledgement, keeping the fallback provenance", async () => {
    state.manualMatchedBy = "fallback";
    const { create } = await chatTurns(WOVEN_DEADLINE_TURNS);
    state.draft = WOVEN_OBSERVATION;
    const { reference } = await create();
    const form = await review(reference.instanceId);
    expect(form.instance.status).toBe("draft");
    const policy = field(form, "policy_language")!;
    expect(policy.value).toContain("JBA Policy Manual");
    expect(policy.provenance?.matchedBy).toBe("fallback");

    expect((await finalize(reference.instanceId)).status).toBe(200);
    expect((await review(reference.instanceId)).instance.status).toBe("finalized");
  });
});
