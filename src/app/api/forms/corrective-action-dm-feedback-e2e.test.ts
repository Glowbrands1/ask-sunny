import { beforeEach, describe, expect, it, vi } from "vitest";

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
    create: async () => {
      expect(last.formProposal!.supportsInlineDraft).toBe(true);
      return createInlineForm({ proposal: last.formProposal!, messages, call, onCreated: () => {} });
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
 * reworded.
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

const MANUAL = { chunks: [STANDARDS_OF_CONDUCT_CHUNK, ATTENDANCE_CHUNK, VISITORS_CHUNK] };

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

/* No offense box is ticked and no manual section cited for a register shortage here, so the plan names the applicable company policy. */
const REVIEW_APPLICABLE = "Management will review the applicable company policy with Tess.";

describe("a payroll deduction with an amount", () => {
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
