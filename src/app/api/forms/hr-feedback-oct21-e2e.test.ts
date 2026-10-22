import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * HR FEEDBACK, 21 OCT 2026 — THE CORRECTIVE ACTIONS HR TYPED, END TO END
 * ============================================================================
 *
 * The same day's HR conversations Ask Bubbles was fixed against (Ask Bubbles
 * `hr-feedback-oct21-e2e.test.ts` and `…-followups-e2e.test.ts`), replayed
 * here through Ask Sunny's real proposal flow, `createInlineForm` and the real
 * create / draft / review routes, so the two apps cannot drift apart on them:
 *
 *   "create a written CA for … previous coaching: …", then "written"
 *                                  the draft was written from "written" alone
 *   "create verbal CA for …", then "no payroll deduct"
 *                                  the level was lost
 *   "…opened the salon 30 minutes late"      the minutes read as a salon
 *   "…$25 will be payroll deducted"          no Yes, no amount
 *   "…let her friend Sam Jones behind…"      asked who the form is for
 *   "make it a written warning", late        the level change was not taken
 *   "previous coaching was 9/15 for cell phone use"
 *                                  what the coaching was for was dropped
 *   "Verbal warning, payroll deduct no."     neither answer was read
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

/** What the last draft was written from: the notes the card sent. */
const described = () => String(requests.filter((entry) => entry.url.endsWith("/draft")).at(-1)?.body.notes ?? "");

let sequence = 0;
const said = (content: string): ChatMessage => ({
  id: `m${(sequence += 1)}`,
  role: "user",
  content,
  createdAt: "2026-10-21T18:00:00Z",
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
    responses.push(response!);
    if (response!.formProposal) open = response!.formProposal.templateKey;
    messages.push(message, {
      id: `a${sequence}`,
      role: "assistant",
      content: response!.content,
      createdAt: "2026-10-21T18:00:01Z",
      ...(response!.formProposal ? { formProposal: response!.formProposal } : {}),
    } as ChatMessage);
  }
  const last = responses[responses.length - 1]!;
  return {
    responses,
    last,
    proposal: last.formProposal!,
    create: async () => createInlineForm({ proposal: last.formProposal!, messages, call, onCreated: () => {} }),
  };
}

/* Synthetic people only. */
const DIRECTORY = [
  { id: "e-1", firstName: "Pat", lastName: "Rivera", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0310"] },
];

/* THE MANUAL AS THE KNOWLEDGE BASE HOLDS IT: real headings, and the page the manual prints. */
const chunk = (index: number, heading: string, printedPage: number, body: string, sections = [{ heading, page: printedPage }]) => ({
  chunkIndex: index,
  page: printedPage + 1,
  printedPage,
  sections,
  section: heading,
  content: `${printedPage} | P a g e\n${heading}\n${body}`,
});

const MANUAL = {
  chunks: [
    chunk(30, "Standards of Conduct", 12, "The following are examples (non-inclusive list) of infractions that may result in disciplinary\naction:\no Insubordination -the refusal to follow the directions of the manager.\no Register / Bank shortages"),
    chunk(33, "Attendance", 14, "It is the responsibility of each employee to know his or her work schedule and to always be on\ntime."),
    chunk(34, "Late Opening", 15, "When an employee assigned to open a location is unable to open the location at the proper\ntime, the employee must notify the manager as soon as possible. The employee will reimburse The\nCompany $25.00 via payroll deduction."),
    chunk(43, "Cell Phone/Smart Watch Policy", 19, "Personal Employee cell phones are permitted in the workplace but must be kept out of sight."),
    chunk(64, "Visitors in the Workplace", 30, "For personal visitors, Employees must obtain approval from direct Supervisors each time they\ninvite a visitor into the workplace."),
    // Real headings an account's ordinary words also say ("payroll deduct", "time records"): never cited unasked.
    chunk(100, "Payroll Deductions", 39, "Deductions from an employee's pay are made only as required by law."),
    chunk(98, "Time Records", 36, "Employees must record their own time worked accurately."),
  ],
};

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
  vi.setSystemTime(new Date("2026-10-21T18:00:00Z"));
  await ensureTemplateLibrary("system");
});

async function filed(turns: string[], observation: string, checked: Record<string, string[]> = {}) {
  const played = await conversation(turns);
  state.draft = { values: { observation: `Observed:\n${observation}` }, checked };
  const { reference } = await played.create();
  return { ...played, form: await review(reference.instanceId) };
}

/* ========================================================================= */
/* A ONE-WORD ANSWER AFTER THE WHOLE REQUEST                                  */
/* ========================================================================= */

const REQUEST =
  "create a written CA for pat rivera for not attending the monthly meeting on 10-20-26. previous coaching: jba policy manual 1-1-26, verbal ca 9-1-26. payroll deduct not applicable";

describe("a CA request answered with one word keeps the whole account", () => {
  it('drafts from the original request after the manager answers "written"', async () => {
    const { responses, proposal, create } = await conversation([REQUEST, "written"]);

    expect(proposal.sourceMessageIds).toEqual(["m1", "m2"]);
    expect(proposal).toMatchObject({
      templateKey: "dpoa",
      status: "ready",
      employeeName: "Pat Rivera",
      warningLevel: "written",
      payrollDeduct: "no",
      locationId: "loc-0310",
    });
    // "written CA" already said the level on turn 1.
    expect(responses[0]!.formProposal!.warningLevel).toBe("written");
    expect(proposal.formDate).toBe("2026-10-20");

    state.draft = {
      values: { observation: "Observed:\nPat Rivera did not attend the monthly meeting on 10/20/2026." },
      checked: {},
    };
    const { reference } = await create();

    // What the draft is written from: the account, not the one-word answer.
    expect(described()).toContain("not attending the monthly meeting on 10-20-26");
    expect(described()).toContain("verbal ca 9-1-26");

    const form = await review(reference.instanceId);
    expect(form.instance.formDate).toBe("2026-10-20");
    expect(field(form, "warning_type")!.checked).toEqual(["written"]);
    expect(field(form, "payroll_deduct")!.checked).toEqual(["no"]);
  });

  it('"written" after a request that left the level open is the level, and the draft is written from the request', async () => {
    const { proposal, create } = await conversation([REQUEST.replace("a written CA", "a CA"), "written"]);

    expect(proposal.sourceMessageIds).toEqual(["m1", "m2"]);
    expect(proposal.warningLevel).toBe("written");
    expect(proposal.payrollDeduct).toBe("no");

    await create();
    expect(described()).toContain("not attending the monthly meeting on 10-20-26");
  });

  it("keeps a level stated in the request when the next turn answers something else", async () => {
    const { proposal } = await conversation([
      "create verbal CA for pat rivera for violating visitors at work policy on 10-10-26. she spent 40 minutes talking with a friend and ignoring clients.",
      "no payroll deduct",
    ]);
    expect(proposal.sourceMessageIds).toEqual(["m1", "m2"]);
    expect(proposal.warningLevel).toBe("verbal");
    expect(proposal.payrollDeduct).toBe("no");
  });

  it("still leaves out a CA request for somebody else", async () => {
    const { proposal } = await conversation([
      "create a written CA for robin kessler for a missed shift on 10-19-26",
      "create a verbal CA for pat rivera for not attending the monthly meeting on 10-20-26",
    ]);
    expect(proposal.templateKey).toBe("dpoa");
    expect(proposal.sourceMessageIds).toEqual(["m2"]);
    expect(proposal.warningLevel).toBe("verbal");
  });
});

/* ========================================================================= */
/* A LATE OPENING, AND THE PAYROLL DEDUCTION, AS HR TYPED THEM                */
/* ========================================================================= */

describe("a late opening, as HR typed it", () => {
  const TYPED =
    "create verbal ca for pat rivera for opening salon late on 10-1-26. previous coaching is jba policy manual 1-1-26. payroll deduct DOES apply and state $25 will be payroll deducted";

  it("reads the level, the date, the deduction and its amount, and cites Late Opening", async () => {
    const { proposal, form } = await filed([TYPED], "Pat Rivera opened the salon late on 10/1/2026.", {
      offense_type: ["tardiness"],
    });
    expect(proposal).toMatchObject({ templateKey: "dpoa", status: "ready", warningLevel: "verbal", payrollDeduct: "yes" });
    expect(form.instance.formDate).toBe("2026-10-01");
    expect(field(form, "payroll_deduct")!.checked).toEqual(["yes"]);
    expect(field(form, "action_plan")!.value).toContain("$25 will be deducted from Pat's pay.");
    expect(field(form, "policy_language")!.value).toContain("Source: JBA Policy Manual — Late Opening, p. 15");
    expect(field(form, "policy_language")!.value).not.toContain("Payroll Deductions");
  });

  it.each([
    "create verbal ca for pat rivera. on 10-1-26 she opened the salon 30 minutes late. no payroll deduct",
    "create verbal ca for pat rivera. she opened the location 45 min late on 10-1-26. no payroll deduct",
    "create verbal ca for pat rivera, she was late to salon 15 minutes on 10-1-26. no payroll deduct",
  ])("does not read the minutes as a salon number: %s", async (typed) => {
    const { proposal, last } = await conversation([typed]);
    expect(last.content).not.toMatch(/couldn't find a salon/i);
    expect(proposal).toMatchObject({ templateKey: "dpoa", status: "ready", locationId: "loc-0310" });
  });

  it('"Verbal warning, payroll deduct no." is the level and the payroll answer', async () => {
    const { proposal, last } = await conversation([
      "create ca for pat rivera for opening salon late on 10-1-26. Verbal warning, payroll deduct no.",
    ]);
    expect(proposal).toMatchObject({ templateKey: "dpoa", warningLevel: "verbal", payrollDeduct: "no" });
    expect(last.content).not.toMatch(/verbal\/written warning level/);
  });
});

describe("the payroll deduction, however HR words it", () => {
  it.each([
    ["$25 will be payroll deducted", "$25"],
    ["payroll deduct $25", "$25"],
    ["$25 payroll deduction applies", "$25"],
    ["deduct $3.25 from her pay", "$3.25"],
  ])("%s", async (typed, amount) => {
    const { proposal, form } = await filed(
      [`create verbal ca for pat rivera for a register shortage on 10-20-26. ${typed}`],
      "Pat Rivera's register was short on 10/20/2026.",
    );
    expect(proposal.payrollDeduct).toBe("yes");
    expect(field(form, "action_plan")!.value).toContain(`${amount} will be deducted from Pat's pay.`);
    // Saying "payroll deduct" names no policy: the manual's Payroll Deductions section is not cited.
    expect(field(form, "policy_language")?.value ?? "").not.toContain("Payroll Deductions");
  });

  it("keeps the answer when the manager asks for the form again", async () => {
    const { proposal } = await conversation([
      "create ca form for pat rivera for a register shortage on 10-20-26. payroll deduct applies and $3.25 will be deducted from check.",
      "verbal",
      "create ca form for pat rivera",
    ]);
    expect(proposal.payrollDeduct).toBe("yes");
  });
});

/* ========================================================================= */
/* THE POLICY, AND THE PEOPLE, IN THE ACCOUNT                                 */
/* ========================================================================= */

describe("the policy HR names is the one cited", () => {
  it.each([
    ["create a verbal corrective action form for pat rivera. on 10-20-26 pat was talking on her cell phone for over 30 minutes", "Cell Phone/Smart Watch Policy, p. 19"],
    ["create verbal ca for pat rivera for violating the cell phone policy on 10-20-26. she was texting at the register", "Cell Phone/Smart Watch Policy, p. 19"],
    ["create verbal ca for pat rivera for cell phone/smart watch policy on 10-20-26", "Cell Phone/Smart Watch Policy, p. 19"],
    ["create verbal ca for pat rivera on 10-20-26. she was texting at the register. Cell phone/smart watch policy.", "Cell Phone/Smart Watch Policy, p. 19"],
    ["create verbal ca for pat rivera for violating visitors at work policy on 10-10-26. pat spent 40 minutes talking with friend and ignoring clients", "Visitors in the Workplace, p. 30"],
  ])("%s", async (typed, source) => {
    const { form } = await filed([typed], "Pat Rivera, 10/20/2026.");
    expect(field(form, "policy_language")!.value ?? "").toContain(`Source: JBA Policy Manual — ${source}`);
  });

  it("a section the manual does not title a Policy is not cited from the account's ordinary words", async () => {
    const { form } = await filed(
      ["create verbal ca for pat rivera for not clocking in on 10-20-26. her time records were wrong all week. no payroll deduct"],
      "Pat Rivera did not clock in on 10/20/2026.",
      { offense_type: ["attendance"] },
    );
    expect(field(form, "policy_language")?.value ?? "").not.toContain("Time Records");
  });
});

describe("other people and policy titles in the account are not the employee", () => {
  it.each([
    "create verbal ca for pat rivera for violating visitors in the workplace policy on 10-10-26. she let her friend Sam Jones behind the counter for an hour",
    "create verbal ca for pat rivera on 10-20-26. she yelled at her coworker Avery Smith in front of clients",
    "create verbal ca for pat rivera for violating the Cell Phone Policy on 10-20-26",
    "create verbal ca for pat rivera for violating Visitors In The Workplace on 10-10-26",
  ])("%s", async (typed) => {
    const { proposal, last } = await conversation([typed]);
    expect(last.content).not.toMatch(/who is this .* for|which one|did you mean/i);
    expect(proposal).toMatchObject({ templateKey: "dpoa", employeeName: "Pat Rivera" });
  });

  it("a stray first name in the account does not change the employee", async () => {
    const { responses, proposal } = await conversation([
      "create verbal CA for pat rivera for violating visitors at work policy on 10-10-26. juno spent 40 minutes talking with friend and ignoring clients.",
      "no payroll deduct",
      "yes payroll deduct",
    ]);
    expect(responses.map((response) => response.formProposal!.employeeName)).toEqual(["Pat Rivera", "Pat Rivera", "Pat Rivera"]);
    expect(proposal.payrollDeduct).toBe("yes");
  });
});

describe("what happened is read from this form's turns", () => {
  it("says it has not been told what happened when only another person's account came before", async () => {
    state.directory = [
      ...DIRECTORY,
      { id: "e-2", firstName: "Avery", lastName: "Testperson", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0310"] },
    ];
    const { proposal } = await conversation([
      "create coaching for avery testperson. she has been late three times this month",
      "create ca for pat rivera",
    ]);
    expect(proposal).toMatchObject({ templateKey: "dpoa", employeeName: "Pat Rivera", awaitingIncident: true });
    expect(proposal.sourceMessageIds).toEqual(["m2"]);
  });

  it("a request for another employee keeps none of the earlier one's answers", async () => {
    state.directory = [
      ...DIRECTORY,
      { id: "e-2", firstName: "Avery", lastName: "Testperson", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0310"] },
    ];
    const { proposal } = await conversation([
      "create verbal CA for pat rivera for violating visitors at work policy on 10-10-26. she spent 40 minutes talking with a friend.",
      "no payroll deduct",
      "create a verbal corrective action form for avery testperson. on 10-20-26 avery was talking on her cell phone for over 30 minutes",
    ]);
    expect(proposal.employeeName).toBe("Avery Testperson");
    expect(proposal.sourceMessageIds).toEqual(["m3"]);
    expect(proposal.payrollDeduct).toBeNull();
  });
});

/* ========================================================================= */
/* THE WARNING LEVEL, AND THE HISTORY                                         */
/* ========================================================================= */

describe("a change of warning level, whenever the manager makes it", () => {
  it('takes "make it a written warning" after the intake has moved on', async () => {
    const { responses, proposal } = await conversation([
      "create verbal ca for pat rivera for violating the cell phone policy on 10-20-26. she was texting at the register",
      "no payroll deduct",
      "make it a written warning",
    ]);
    expect(responses[0]!.formProposal!.warningLevel).toBe("verbal");
    expect(proposal).toMatchObject({ templateKey: "dpoa", employeeName: "Pat Rivera", warningLevel: "written", payrollDeduct: "no" });
  });

  it("does not read a past warning as a change", async () => {
    const { proposal } = await conversation([
      "create verbal ca for pat rivera for violating the cell phone policy on 10-20-26. she was texting at the register",
      "no payroll deduct",
      "she had a written warning on 9/1",
    ]);
    expect(proposal.warningLevel).toBe("verbal");
  });
});

describe("what an earlier coaching was for stays on the history line", () => {
  it("previous coaching was 9/15 for cell phone use", async () => {
    const { form } = await filed(
      ["create verbal ca for pat rivera for violating the cell phone policy on 10-20-26. previous coaching was 9/15 for cell phone use and she was on her phone again. no payroll deduct"],
      "Pat Rivera was on her cell phone on 10/20/2026.",
    );
    expect(field(form, "prior_actions")!.value).toBe("Coaching for cell phone use — signed 09/15/2026");
  });
});

/* ========================================================================= */
/* ASK BUBBLES ADMIN FEEDBACK, 16 OCT 2026 — THE INTAKE STAYS OPEN            */
/* ========================================================================= */

describe("the intake stays open on a salon or \"I already told you\" (Ask Bubbles 8e3e81e)", () => {
  it('"my employee pat rivera …" reads the name typed in lower case', async () => {
    const { proposal } = await conversation(["my employee pat rivera was late again today, i need a coaching form"]);
    expect(proposal).toMatchObject({ templateKey: "coaching", employeeName: "Pat Rivera", status: "ready" });
  });

  it('"I already told you the employee name. She is at …" keeps the open form', async () => {
    state.scope = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: ["loc-0309"] };
    const { responses, proposal } = await conversation([
      "Please create a CA form for lateness on 10/5 and 10/15, I coached her verbally on the first.",
      "I already told you the employee name. She is at NE Kearney",
    ]);
    expect(responses[0]!.formProposal!.status).toBe("needs_employee");
    expect(proposal.templateKey).toBe("dpoa");
    expect(proposal.locationId).toBe("loc-0309");
  });

  it("a salon-only reply carries the name given earlier, without asking again", async () => {
    state.scope = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: ["loc-0309"] };
    const { responses, proposal } = await conversation([
      "My employee pat rivera was late on 10/5 and 10/15. Please create a CA form.",
      "She is at NE Kearney",
    ]);
    expect(proposal.employeeName).toBe("Pat Rivera");
    expect(proposal.locationId).toBe("loc-0309");
    expect(responses[1]!.content).not.toMatch(/who is this/i);
  });
});

/* ========================================================================= */
/* HR, 21 OCT 2026 — "SUNNY WOULD NOT CREATE THE FORM" (THE SAVE, THEN FINALIZE) */
/* ========================================================================= */

/*
 * "Today I asked Sunny to create a Verbal CA for <employee> for missing the
 * 10-15-26 woven deadline and Sunny would not create the form." Sunny drafted
 * the form and cited Standards of Conduct from the manual; the manager pressed
 * Save without touching the policy, and Finalize then said "Official policy
 * verification is incomplete". The card's Save sends every value, and the
 * server had re-written them all as the manager's, so Sunny's own citation
 * lost its verification (fixed in cf1480b). Played here from her words through
 * the chat, the Create button, the card's Save and Finalize.
 */
describe("a Verbal CA for a missed Woven deadline, saved and then finalized", () => {
  const ASKED = "create a Verbal CA for pat rivera for missing the 10-15-26 woven deadline";

  /* The manual's Standards of Conduct with the line a missed required task rests on. */
  const WITH_SOC = {
    chunks: [
      chunk(
        30,
        "Standards of Conduct",
        12,
        "The following are examples (non-inclusive list) of infractions that may result in disciplinary\naction:\no Failing to follow the policies and procedures of The Company\no Insubordination -the refusal to follow the directions of the manager.",
      ),
      ...MANUAL.chunks.slice(1),
    ],
  };

  async function patch(id: string, body: unknown) {
    return instanceRoute.PATCH(
      new Request(`https://app.test/api/forms/instances/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) },
    );
  }

  async function finalize(id: string) {
    joinOverview();
    return instanceRoute.POST(
      new Request(`https://app.test/api/forms/instances/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "finalize" }),
      }),
      { params: Promise.resolve({ id }) },
    );
  }

  /** The card's Save: every value and tick it holds, plus the manager's edits. */
  async function cardSave(id: string, edits: Record<string, string> = {}) {
    const opened = await review(id);
    const values = Object.fromEntries(
      opened.values.filter((entry) => entry.value !== null).map((entry) => [entry.fieldKey, entry.value!]),
    );
    const checked = Object.fromEntries(
      opened.values.filter((entry) => entry.checked.length > 0).map((entry) => [entry.fieldKey, entry.checked]),
    );
    const saved = await patch(id, { values: { ...values, ...edits }, checked });
    expect(saved.status).toBe(200);
  }

  async function drafted() {
    state.manual = WITH_SOC;
    const { proposal, form } = await filed([ASKED, "no payroll deduct"], "Pat Rivera did not meet the Woven deadline of 10/15/2026.", {
      offense_type: ["under_performance"],
      warning_type: ["verbal"],
    });
    expect(proposal).toMatchObject({ templateKey: "dpoa", warningLevel: "verbal", employeeName: "Pat Rivera" });
    expect(field(form, "policy_violated")!.value).toBe("Standards of Conduct");
    expect(field(form, "policy_language")!.provenance).toMatchObject({ verified: true });
    return String(form.instance.id);
  }

  it("keeps Sunny's cited policy verified through a Save, and finalizes without the warning", async () => {
    const id = await drafted();

    await cardSave(id, { prior_actions: "Coaching — JBA Policy Manual — signed 07/29/2026" });

    const saved = await review(id);
    expect(field(saved, "policy_language")!.filledBy).toBe("ai");
    expect(field(saved, "policy_language")!.provenance).toMatchObject({ verified: true });
    expect(field(saved, "prior_actions")!.filledBy).toBe("manager");

    const finalized = await finalize(id);
    expect(finalized.status, JSON.stringify(await finalized.clone().json())).toBe(200);
  });

  it("still asks when the manager rewrites the policy herself", async () => {
    const id = await drafted();
    const policy = field(await review(id), "policy_language")!.value!;
    await cardSave(id, { policy_language: ` ${policy.split("\n\nSource:")[0]}\nViolation of personnel policies` });

    const refused = await finalize(id);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "policy_verification_required" });
  });
});
