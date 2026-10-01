import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * COACHING FEEDBACK, END TO END
 * ============================================================================
 *
 * Conversation -> proposal -> `createInlineForm` -> POST /api/forms/instances
 * -> POST .../draft -> PUT .../follow-up -> `reviseActiveForm` (the chat
 * route's revision step) -> GET .../[id] (the review read).
 *
 * Real except for the identity provider, the model, the employee directory
 * (its SCOPING is the real `scopeRoster`, over rows this file supplies) and the
 * database (the in-memory fake the rest of the forms suite uses). The library
 * is installed by `ensureTemplateLibrary`, so every form is drafted against the
 * version that is actually seeded.
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
  draft: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown> },
  revise: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown>; clear?: unknown },
  calls: [] as { tool: string; system: string; prompt: string }[],
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
      create: async (request: {
        system: string;
        messages: { content: string }[];
        tool_choice: { name: string };
      }) => {
        const tool = request.tool_choice.name;
        state.calls.push({ tool, system: request.system, prompt: request.messages[0]!.content });
        return {
          content: [
            {
              type: "tool_use",
              name: tool,
              input: tool === "revise_form_fields" ? state.revise : state.draft,
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
    async fetchRoleGrounding(role: { id: string }) {
      return {
        ok: true,
        grounding: {
          role: { id: role.id },
          documentId: "doc-progression",
          documentTitle: "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
          matchedBy: "tag",
          rows: [
            {
              chunk_id: "pmf-0",
              document_id: "doc-progression",
              document_title: "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
              category: "leadership_coaching",
              locator: "SECTION 2",
              page: null,
              section: null,
              content: "Solve the issue at the lowest appropriate level.",
              similarity: 0,
            },
          ],
        },
      };
    }
    async fetchOfficialPolicyManual() {
      return { ok: false, reason: "not needed" };
    }
  },
}));

/*
 * THE DIRECTORY READ IS FAKED; ITS SCOPING IS NOT. `loadScopedRoster` is the
 * real `scopeRoster` over the rows each test supplies, so what a manager can
 * be matched against is decided by the production rule.
 */
vi.mock("@/lib/forms/employee-roster", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/forms/employee-roster")>();
  return {
    ...actual,
    loadScopedRoster: async (scope: AccessScope | null) =>
      actual.scopeRoster(state.directory as never, scope),
  };
});

process.env.NEXT_PUBLIC_DEMO_MODE = "false";

const { ensureTemplateLibrary, listTemplateSummaries } = await import("@/lib/forms/repository");
const { proposeFormForTurn } = await import("@/lib/ai/form-proposal");
const { createInlineForm } = await import("@/features/chat/create-inline-form");
const { reviseActiveForm } = await import("@/lib/forms/chat-revision");
const { COACHING_CONTEXT_RULES, LANGUAGE_CLEANUP_RULES } = await import("@/lib/forms/coaching-framing");
const { MANAGER_FOLLOW_UP_RULES } = await import("@/lib/forms/follow-up-observation");
const instancesRoute = await import("./instances/route");
const instanceRoute = await import("./instances/[id]/route");
const draftRoute = await import("./instances/[id]/draft/route");
const followUpRoute = await import("./instances/[id]/follow-up/route");

function joinOverview() {
  for (const row of store.form_instances ?? []) {
    const template = store.form_templates!.find((entry) => entry.id === row.template_id);
    const version = store.form_template_versions.find((entry) => entry.id === row.template_version_id);
    Object.assign(row, {
      form_date: row.form_date ?? "2026-10-01",
      template_key: template?.key,
      template_name: template?.name,
      layout_family: template?.layout_family,
      template_version: version?.version,
    });
  }
}

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

async function review(id: string) {
  joinOverview();
  const response = await instanceRoute.GET(new Request(`https://app.test/api/forms/instances/${id}`), {
    params: Promise.resolve({ id }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    instance: Record<string, unknown>;
    values: { fieldKey: string; value: string | null; checked: string[]; filledBy: string }[];
  };
}

function valueOf(read: Awaited<ReturnType<typeof review>>, key: string) {
  return read.values.find((row) => row.fieldKey === key);
}

let turn = 0;
const said = (content: string): ChatMessage => ({
  id: `m-${(turn += 1)}`,
  role: "user",
  content,
  createdAt: "2026-10-01T15:00:00Z",
});
const answered = (content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `a-${(turn += 1)}`,
  role: "assistant",
  content,
  createdAt: "2026-10-01T15:00:00Z",
  ...extra,
});

async function propose(messages: ChatMessage[], continueTemplateKey?: string) {
  const current = messages[messages.length - 1]!;
  return proposeFormForTurn({
    history: messages.slice(0, -1),
    question: current.content,
    questionMessageId: current.id,
    actor: { role: state.role as never, scope: state.scope as AccessScope },
    summaries: await listTemplateSummaries(),
    today: "2026-10-01",
    ...(continueTemplateKey ? { continueTemplateKey } : {}),
  });
}

async function createFrom(messages: ChatMessage[], continueTemplateKey?: string) {
  const response = await propose(messages, continueTemplateKey);
  const proposal = response!.formProposal!;
  expect(proposal.supportsInlineDraft, response!.content).toBe(true);
  const result = await createInlineForm({ proposal, messages, call, onCreated: () => {} });
  return { response: response!, proposal, id: result.reference.instanceId, warning: result.draftWarning };
}

async function revise(id: string, history: ChatMessage[], question: string) {
  return reviseActiveForm({
    request: new Request("https://app.test/api/chat", { method: "POST" }),
    instanceId: id,
    question,
    history,
  });
}

const SALON_SCOPE = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: ["loc-0311"] };

const DIRECTORY = [
  { id: "e-1", firstName: "Kaitlyn", lastName: "Marsh", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0310"] },
  { id: "e-2", firstName: "Katelyn", lastName: "Marsh", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0311"] },
  { id: "e-3", firstName: "Avery", lastName: "Stone", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0310", "loc-0311"] },
  // At a salon none of these managers covers.
  { id: "e-4", firstName: "Kaitlynn", lastName: "Marshall", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0468"] },
];

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  state.role = "salon_director";
  state.scope = SALON_SCOPE;
  state.draft = { values: {}, checked: {} };
  state.revise = { values: {} };
  state.calls = [];
  state.directory = DIRECTORY;
  turn = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T15:00:00Z"));
  await ensureTemplateLibrary("system");
});

/* ======================================================= 1, 2, 8: redraft == */

describe("a redraft keeps the form it was asked to change", () => {
  const FOLLOW_UP_NOTES =
    "Create a follow-up coaching form for Kaitlyn Marsh. I followed up today: since our coaching on bed sanitizing she has improved — I watched her sanitize every bed on three shifts. Next follow-up within 2 weeks.";

  async function followUpForm() {
    state.draft = {
      values: {
        original_topic: "Bed sanitizing",
        original_expectation: "Every bed is sanitized after each client.",
        follow_up_observation: "Kaitlyn has sanitized every bed after each client since the coaching.",
        specific_evidence: "Observed on three shifts this week.",
        next_follow_up: "within 2 weeks",
      },
      checked: { progress_level: ["improved"], next_step: ["continue"] },
    };
    const messages = [said(FOLLOW_UP_NOTES)];
    const created = await createFrom(messages);
    expect(created.proposal.templateKey).toBe("follow-up-coaching");
    return { messages, ...created };
  }

  it("retains Follow-Up Observation, Progress Level and Specific Evidence through a small revision", async () => {
    const { id, messages, proposal } = await followUpForm();
    const before = await review(id);
    expect(valueOf(before, "follow_up_observation")?.value).toContain("sanitized every bed");
    expect(valueOf(before, "progress_level")?.checked).toEqual(["improved"]);
    expect(valueOf(before, "specific_evidence")?.value).toBe("Observed on three shifts this week.");

    // The model rewrites things nobody asked about. None of it may land.
    state.revise = {
      values: {
        next_follow_up: "within 10 days",
        follow_up_observation: "Rewritten by the model.",
        specific_evidence: "",
      },
      checked: { progress_level: ["partially_improved"] },
    };
    const history = [...messages, answered("Here is the form.", { formInstanceRef: { instanceId: id, proposalId: proposal.proposalId, templateName: proposal.templateName } })];
    // "coaching form" is named while the FOLLOW-UP form is open: still this record.
    const response = await revise(id, history, "Can you redraft the coaching form and change the timeframe to within 10 days?");
    expect(response?.formUpdate?.updated).toEqual(["next_follow_up"]);
    expect(response?.content).toContain("Everything else on the form is as it was");

    const after = await review(id);
    expect(valueOf(after, "next_follow_up")?.value).toBe("within 10 days");
    expect(valueOf(after, "follow_up_observation")?.value).toBe(valueOf(before, "follow_up_observation")?.value);
    expect(valueOf(after, "specific_evidence")?.value).toBe("Observed on three shifts this week.");
    expect(valueOf(after, "progress_level")?.checked).toEqual(["improved"]);
    expect(valueOf(after, "original_topic")?.value).toBe("Bed sanitizing");

    // Still ONE record — the redraft did not create a second form.
    expect(store.form_instances).toHaveLength(1);

    // The model was shown the form as it stands.
    const revision = state.calls.find((entry) => entry.tool === "revise_form_fields")!;
    expect(revision.prompt).toContain("THE FORM AS IT STANDS");
    expect(revision.prompt).toContain("Observed on three shifts this week.");
  });

  it("modifies one field without resetting the others, including the manager's own edits", async () => {
    state.draft = {
      values: {
        coaching_details:
          "Observed:\nKaitlyn left two beds unsanitized after clients today.\n\nExpectation:\nEvery bed is sanitized after each client.",
        other_topic: "Bed sanitizing",
      },
      checked: { coaching_type: ["retraining"], coaching_topics: ["cleaning_tasks", "other"] },
    };
    const messages = [said("Coaching form for Kaitlyn Marsh — she left two beds unsanitized after clients today.")];
    const { id, proposal } = await createFrom(messages);
    expect(proposal.employeeName).toBe("Kaitlyn Marsh");

    // The manager edits Details by hand.
    const { saveInstanceValues } = await import("@/lib/forms/instances");
    await saveInstanceValues(id, { values: { coaching_details: "Observed:\nManager's own wording.\n\nExpectation:\nEvery bed is sanitized after each client." } }, "manager-1");

    state.revise = {
      values: { other_topic: "Bed sanitation", coaching_details: "Model rewrote Details." },
      checked: { coaching_type: ["retraining"] },
    };
    await revise(id, messages, "change the other topic to Bed sanitation");

    const after = await review(id);
    expect(valueOf(after, "other_topic")?.value).toBe("Bed sanitation");
    expect(valueOf(after, "coaching_details")?.value).toContain("Manager's own wording.");
    expect(valueOf(after, "coaching_details")?.filledBy).toBe("manager");
    expect(valueOf(after, "coaching_topics")?.checked).toEqual(["cleaning_tasks", "other"]);
  });

  it("keeps the agreed timeframe and the scheduled date as two different things", async () => {
    const { id, messages } = await followUpForm();

    const put = await followUpRoute.PUT(
      new Request(`https://app.test/api/forms/instances/${id}/follow-up`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date: "2026-10-15" }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(put.status).toBe(200);

    state.revise = { values: { next_follow_up: "within 10 days" } };
    await revise(id, messages, "update the next follow-up to within 10 days");

    const after = await review(id);
    // The timeframe is a field on the form; the date is the instance's own.
    expect(valueOf(after, "next_follow_up")?.value).toBe("within 10 days");
    expect(after.instance.followUpDate).toBe("2026-10-15");
    // No field duplicates the date.
    expect(after.values.some((row) => row.value === "2026-10-15")).toBe(false);
  });

  it("writes manager follow-up findings only from the manager's own follow-up", async () => {
    // The original coaching only — no follow-up has happened yet.
    state.draft = {
      values: {
        original_topic: "Bed sanitizing",
        original_expectation: "Every bed is sanitized after each client.",
        follow_up_observation: "She has improved.",
        specific_evidence: "Seen on three shifts.",
        additional_coaching: "Role-played the checklist.",
        next_follow_up: "within 2 weeks",
      },
      checked: { progress_level: ["improved"], next_step: ["continue"] },
    };
    const messages = [said("Follow-up coaching form for Kaitlyn Marsh on bed sanitizing. We'll check again within 2 weeks.")];
    const { id } = await createFrom(messages);

    const drafted = await review(id);
    for (const key of ["follow_up_observation", "specific_evidence", "additional_coaching"]) {
      expect(valueOf(drafted, key)?.value ?? "", key).toBe("");
    }
    expect(valueOf(drafted, "progress_level")?.checked ?? []).toEqual([]);
    expect(valueOf(drafted, "next_step")?.checked ?? []).toEqual([]);
    expect(valueOf(drafted, "next_follow_up")?.value).toBe("within 2 weeks");
    expect(state.calls[0]!.system).toContain(MANAGER_FOLLOW_UP_RULES[0]);

    // A redraft does not invent them either.
    state.revise = { values: { follow_up_observation: "She improved." }, checked: { progress_level: ["improved"] } };
    const response = await revise(id, messages, "redraft it with cleaner wording");
    expect(response?.content).toMatch(/stay blank until you've done the follow-up/);
    const after = await review(id);
    expect(valueOf(after, "follow_up_observation")?.value ?? "").toBe("");
    expect(valueOf(after, "progress_level")?.checked ?? []).toEqual([]);

    // The manager's own decision, stated, is written.
    state.revise = { checked: { progress_level: ["improved"] }, values: {} };
    await revise(id, messages, "set the progress level to improved");
    expect(valueOf(await review(id), "progress_level")?.checked).toEqual(["improved"]);
  });

  it("does not revise a finalized form", async () => {
    const { id, messages } = await followUpForm();
    store.form_instances[0]!.status = "finalized";
    const response = await revise(id, messages, "change the timeframe to one week");
    expect(response?.content).toMatch(/finalized/);
    expect(state.calls.filter((entry) => entry.tool === "revise_form_fields")).toHaveLength(0);
  });

  it("is not a revision when the turn asks for a new form", async () => {
    const { id, messages } = await followUpForm();
    expect(await revise(id, messages, "Create a new coaching form for Avery Stone")).toBeNull();
  });
});

/* ===================================================== 3: team-wide coaching == */

describe("individual and team-wide coaching", () => {
  it("creates individual coaching for a valid employee", async () => {
    state.draft = { values: { coaching_details: "Observed:\nKaitlyn was 20 minutes late today." }, checked: {} };
    const { proposal, id } = await createFrom([said("Coaching form for Kaitlyn Marsh, she was 20 minutes late today.")]);
    expect(proposal.employeeName).toBe("Kaitlyn Marsh");
    expect(proposal.subject).toBeUndefined();
    expect((await review(id)).instance.employeeName).toBe("Kaitlyn Marsh");
  });

  it("creates team-wide coaching with no employee", async () => {
    state.scope = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: [] };
    state.draft = {
      values: { coaching_details: "Observed:\nThe team reviewed the bed sanitizing steps.\n\nExpectation:\nEvery bed is wiped after each client." },
      checked: { coaching_type: ["training_plan_of_action"], coaching_topics: ["cleaning_tasks"] },
    };
    const { proposal, id, response } = await createFrom([
      said("Create a coaching form for the whole team about bed sanitizing — every bed gets wiped down after each client."),
    ]);
    expect(proposal.subject).toBe("team");
    expect(proposal.employeeName).toBe("All team members");
    expect(response.content).toContain("This one is for the whole team");

    const read = await review(id);
    expect(read.instance.employeeName).toBe("All team members");
    expect(read.instance.employeeRole ?? null).toBeNull();
    const draft = state.calls.find((entry) => entry.tool === "write_form_fields")!;
    expect(draft.prompt).toContain("SUBJECT: the whole team");
    expect(draft.prompt).not.toContain("EMPLOYEE:");
  });

  it("refuses a team subject on a form that is about one person", async () => {
    const response = await instancesRoute.POST(
      new Request("https://app.test/api/forms/instances", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateKey: "follow-up-coaching", employeeName: "All team members", source: "manual" }),
      }),
    );
    expect(response.status).toBe(400);
  });
});

/* ============================================== 4 & 6: register and language == */

describe("the coaching register and the language cleanup", () => {
  it("does not turn proactive training into a concern", async () => {
    // What a careless model writes for a training session.
    state.draft = {
      values: {
        coaching_details:
          "Observed:\nKaitlyn was trained on the new client documents. This is a performance concern.\n\nExpectation:\nNew client documents are completed for every first visit.",
      },
      checked: { coaching_type: ["underperformance", "training_plan_of_action"], coaching_topics: ["new_client_documents"] },
    };
    const messages = [said("Coaching form for Kaitlyn Marsh — trained her on the new client documents today so she's ready for opening shifts.")];
    const { id, response } = await createFrom(messages);

    const read = await review(id);
    expect(valueOf(read, "coaching_details")?.value).not.toMatch(/concern/i);
    expect(valueOf(read, "coaching_details")?.value).toContain("trained on the new client documents");
    expect(valueOf(read, "coaching_type")?.checked).toEqual(["training_plan_of_action"]);
    expect(state.calls[0]!.system).toContain(COACHING_CONTEXT_RULES[0]);
    expect(response.content).not.toMatch(/concern/i);
  });

  it("asks what the coaching covers, not for 'the performance concern'", async () => {
    const response = await propose([said("Create a coaching form.")]);
    expect(response!.content).toContain("What the coaching covers");
    expect(response!.content).not.toMatch(/performance concern/i);
    expect(response!.content).toContain("or tell me it's for the whole team");
  });

  it("cleans up rough notes without changing the facts", async () => {
    const rough = "coaching form for Kaitlyn Marsh she didnt wipe 2 beds after clients today, was told to wipe evry bed";
    // The model cleans the grammar — and slips in a date and a count nobody gave.
    state.draft = {
      values: {
        coaching_details:
          "Observed:\nKaitlyn did not wipe two beds after clients today. This happened on September 3 as well.\n\nExpectation:\nEvery bed is wiped after each client.",
      },
      checked: { coaching_type: ["retraining"] },
    };
    const { id } = await createFrom([said(rough)]);

    const system = state.calls[0]!.system;
    for (const rule of LANGUAGE_CLEANUP_RULES) expect(system).toContain(rule);

    const details = valueOf(await review(id), "coaching_details")?.value ?? "";
    expect(details).toContain("Kaitlyn did not wipe two beds after clients today.");
    // A fact the manager never gave does not survive the cleanup.
    expect(details).not.toContain("September 3");
  });
});

/* ======================================================== 5: employee names == */

describe("checking the typed name against the manager's own team", () => {
  it("asks 'Did you mean …?' for a close misspelling and offers no form until answered", async () => {
    const messages = [said("Coaching form for Kaitlin Marsh, she was late today.")];
    const response = await propose(messages);
    expect(response!.content).toMatch(/^Did you mean \*\*Kaitlyn Marsh\*\*\?/);
    expect(response!.formProposal!.employeeName).toBeNull();
    expect(response!.formProposal!.supportsInlineDraft).toBe(false);

    // "yes" continues the open proposal, with the directory's spelling.
    const history = [...messages, answered(response!.content, { formProposal: response!.formProposal })];
    state.draft = { values: { coaching_details: "Observed:\nKaitlyn was late today." }, checked: {} };
    const created = await createFrom([...history, said("yes")], "coaching");
    expect(created.proposal.employeeName).toBe("Kaitlyn Marsh");
    // The employee's salon is filled from the directory.
    expect(created.proposal.locationId).toBe("loc-0310");
    expect((await review(created.id)).instance.employeeName).toBe("Kaitlyn Marsh");
  });

  it("keeps the typed name when the manager says no, and stops asking", async () => {
    const messages = [said("Coaching form for Katlin Marsh, she was late today.")];
    const first = await propose(messages);
    const history = [...messages, answered(first!.content, { formProposal: first!.formProposal }), said("no, keep it as typed")];
    const second = await propose(history, "coaching");
    expect(second!.formProposal!.employeeName).toBe("Katlin Marsh");
    expect(second!.content).not.toMatch(/^Did you mean/);
  });

  it("never auto-selects between two plausible matches", async () => {
    const response = await propose([said("Coaching form for Katlyn Marsh, she was late today.")]);
    expect(response!.content).toMatch(/^Did you mean \*\*(?:Kaitlyn|Katelyn) Marsh\*\* or \*\*(?:Kaitlyn|Katelyn) Marsh\*\*\?/);
    expect(response!.formProposal!.employeeName).toBeNull();

    const history = [said("Coaching form for Katlyn Marsh, she was late today."), answered(response!.content, { formProposal: response!.formProposal }), said("yes")];
    const again = await propose(history, "coaching");
    expect(again!.formProposal!.employeeName).toBeNull();
  });

  it("never matches or names an employee outside the manager's scope", async () => {
    // Kaitlynn Marshall works only at loc-0468, which this manager does not cover.
    const response = await propose([said("Coaching form for Kaitlynn Marshall, she was late today.")]);
    expect(response!.content).not.toContain("**Kaitlynn Marshall**?");
    const all = JSON.stringify(response);
    expect(all).not.toContain("loc-0468");
    // The directory id, quoted — a random proposal UUID can contain "e-4" by chance.
    expect(all).not.toContain('"e-4"');
    // Nobody close in scope: the name is used as typed, and the manager is told.
    expect(response!.formProposal!.employeeName).toBe("Kaitlynn Marshall");
    expect(response!.content).toContain("didn't find **Kaitlynn Marshall** in the employee list for your salons");
  });
});

/* =============================================================== 7: salons == */

describe("which salon the form is filed against", () => {
  it("fills the one authoritative salon — the employee's — for a multi-salon manager", async () => {
    const response = await propose([said("Coaching form for Kaitlyn Marsh, she was late today.")]);
    expect(response!.formProposal).toMatchObject({ locationResolution: "resolved", locationId: "loc-0310", status: "ready" });
  });

  it("asks when several valid salons remain", async () => {
    // Avery works at both of this manager's salons.
    const response = await propose([said("Coaching form for Avery Stone, she was late today.")]);
    expect(response!.formProposal).toMatchObject({
      locationResolution: "needs_selection",
      locationId: null,
      authorizedLocationIds: ["loc-0310", "loc-0311"],
      status: "needs_location",
    });
  });
});

/* =========================================================== across roles == */

describe("across the roles that can create coaching", () => {
  it.each([
    ["salon_director", { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: [] }, "loc-0310"],
    // Scope level is set per user, not by role: a DM assigned salon by salon.
    ["district_manager", { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: ["loc-0311", "loc-0312"] }, "loc-0310"],
    ["regional_manager", { level: "salon", primaryAreaId: "loc-0311", alsoCoversAreaIds: ["loc-0310"] }, "loc-0310"],
    ["admin", { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] }, "loc-0310"],
  ])("%s: the name is checked in scope and the employee's salon is filled", async (role, scope, salon) => {
    state.role = role;
    state.scope = scope;
    const typo = await propose([said("Coaching form for Katlin Marsh, she was late today.")]);
    expect(typo!.content, role).toMatch(/^Did you mean \*\*Kaitlyn Marsh\*\*/);

    const exact = await propose([said("Coaching form for Kaitlyn Marsh, she was late today.")]);
    expect(exact!.formProposal, role).toMatchObject({ employeeName: "Kaitlyn Marsh", locationId: salon, status: "ready" });
  });

  it("a district-scoped account still fails closed on the salon, and is told why", async () => {
    state.role = "district_manager";
    state.scope = { level: "district", primaryAreaId: "dist-patterson-madeline", alsoCoversAreaIds: [] };
    const response = await propose([said("Coaching form for Kaitlyn Marsh, she was late today.")]);
    expect(response!.formProposal).toMatchObject({ locationResolution: "unavailable", supportsInlineDraft: false });
    // No directory match is attempted for a scope the forms path cannot verify.
    expect(response!.content).not.toMatch(/Did you mean/);
  });

  it.each(["employee", "assistant_salon_director"])("%s cannot create a Coaching Form", async (role) => {
    state.role = role;
    const response = await propose([said("Coaching form for Kaitlyn Marsh, she was late today.")]);
    expect(response!.formProposal).toBeUndefined();
    expect(response!.content).toMatch(/cannot create/);
  });
});
