import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * PRODUCTION QA OF PR #81 — THE FAILING PHRASES, END TO END
 * ============================================================================
 *
 * Conversation -> proposal -> `createInlineForm` -> POST /api/forms/instances
 * -> POST .../draft -> `reviseActiveForm` (the chat
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
const instancesRoute = await import("./instances/route");
const instanceRoute = await import("./instances/[id]/route");
const draftRoute = await import("./instances/[id]/draft/route");

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

async function revise(id: string, history: ChatMessage[], question: string, today = "2026-10-01") {
  return reviseActiveForm({
    request: new Request("https://app.test/api/chat", { method: "POST" }),
    instanceId: id,
    question,
    history,
    today,
  });
}


const SALON_SCOPE = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: ["loc-0311"] };
const GLOBAL_SCOPE = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

const DIRECTORY = [
  { id: "e-1", firstName: "Kaitlyn", lastName: "Marsh", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0310"] },
  { id: "e-2", firstName: "Avery", lastName: "Stone", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0310", "loc-0311"] },
  // Shared and service accounts, exactly as the live Woven directory carries them.
  { id: "e-3", firstName: "Risk", lastName: "Management", preferredFirstName: "Risk", employmentStatus: "active", salonIds: ["loc-0310"] },
  { id: "e-4", firstName: "No", lastName: "Manager", preferredFirstName: "No", employmentStatus: "active", salonIds: ["loc-0310"] },
  { id: "e-5", firstName: "GlowBrands", lastName: "IT Support", preferredFirstName: "GlowBrands", employmentStatus: "active", salonIds: ["loc-0310"] },
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

const modelCalls = (tool: string) => state.calls.filter((entry) => entry.tool === tool).length;
const ref = (id: string, proposal: { proposalId: string; templateName: string }) =>
  answered("Here is the form.", { formInstanceRef: { instanceId: id, proposalId: proposal.proposalId, templateName: proposal.templateName } });

/* ============================================================ P1: team-wide == */

describe("P1 — team-wide coaching", () => {
  it.each([
    "Create a coaching form for general training for staff on bed sanitizing.",
    "Create a coaching form for group training on bed sanitizing.",
    "Create a coaching form for team-wide coaching on bed sanitizing.",
    "I need team-wide coaching about bed sanitizing.",
    "Coaching for everyone at the salon about bed sanitizing.",
    "General training for staff about bed sanitizing — can you write up a coaching form?",
  ])("%j is the Coaching Form, for All team members", async (text) => {
    const response = await propose([said(text)]);
    expect(response?.formProposal, response?.content).toMatchObject({
      templateKey: "coaching",
      subject: "team",
      employeeName: "All team members",
    });
    expect(response!.content).not.toMatch(/Did you mean|I didn't find/);
  });

  it("creates the record as team-wide, with no individual attached", async () => {
    state.scope = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: [] };
    state.draft = { values: { coaching_details: "Observed:\nThe team reviewed the bed sanitizing steps.\n\nExpectation:\nEvery bed is sanitized after each client." }, checked: { coaching_type: ["training_plan_of_action"] } };
    const { id } = await createFrom([said("Create a coaching form for general training for staff on bed sanitizing.")]);
    const read = await review(id);
    expect(read.instance.employeeName).toBe("All team members");
    expect(state.calls.find((entry) => entry.tool === "write_form_fields")!.prompt).toContain("SUBJECT: the whole team");
  });

  it("a real named employee still takes precedence", async () => {
    const response = await propose([said("Create a coaching form for Kaitlyn Marsh about how the whole team should sanitize beds.")]);
    expect(response!.formProposal).toMatchObject({ templateKey: "coaching", employeeName: "Kaitlyn Marsh" });
    expect(response!.formProposal!.subject).toBeUndefined();
  });
});

/* ===================================== P2, P3, P6: the open Follow-Up form == */

const ORIGINAL = "Create a follow-up coaching form for Kaitlyn Marsh on bed sanitizing. We'll check again in 2 weeks.";

/** A Follow-Up Coaching Form with no follow-up result yet — the findings blank. */
async function openFollowUpForm() {
  // The model fills the findings anyway; the guard must leave them blank.
  state.draft = {
    values: {
      original_topic: "Bed sanitizing",
      original_expectation: "Every bed is sanitized after each client.",
      follow_up_observation: "She has improved.",
      specific_evidence: "Seen on three shifts.",
      next_follow_up: "in 2 weeks",
    },
    checked: { progress_level: ["improved"], next_step: ["continue"] },
  };
  const messages = [said(ORIGINAL)];
  const created = await createFrom(messages);
  expect(created.proposal.templateKey).toBe("follow-up-coaching");
  return { id: created.id, history: [...messages, ref(created.id, created.proposal)] };
}

/** One that already carries findings, one of them the manager's own text. */
async function filledFollowUpForm() {
  const notes =
    "Create a follow-up coaching form for Kaitlyn Marsh. I followed up today: since our coaching on bed sanitizing she has improved — I watched her sanitize every bed on three shifts. We reviewed the checklist together. Next follow-up within 2 weeks.";
  state.draft = {
    values: {
      original_topic: "Bed sanitizing",
      original_expectation: "Every bed is sanitized after each client.",
      follow_up_observation: "Kaitlyn has sanitized every bed after each client since the coaching.",
      specific_evidence: "Observed on three shifts.",
      additional_coaching: "Reviewed the sanitizing checklist together.",
      next_follow_up: "within 2 weeks",
    },
    checked: { progress_level: ["improved"], next_step: ["continue"] },
  };
  const messages = [said(notes)];
  const created = await createFrom(messages);
  const { saveInstanceValues } = await import("@/lib/forms/instances");
  await saveInstanceValues(created.id, { values: { specific_evidence: "Manager's own words: watched 3 shifts." } }, "manager-1");
  return { id: created.id, history: [...messages, ref(created.id, created.proposal)] };
}

const snapshot = async (id: string) =>
  Object.fromEntries((await review(id)).values.map((row) => [row.fieldKey, { value: row.value, checked: row.checked, by: row.filledBy }]));
function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>) {
  return Object.keys({ ...before, ...after }).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).sort();
}

describe("P2 — a follow-up result in the manager's own words fills the findings", () => {
  it("leaves the findings blank when no follow-up result has been given", async () => {
    const { id } = await openFollowUpForm();
    const read = await snapshot(id);
    for (const key of ["follow_up_observation", "specific_evidence", "additional_coaching"]) expect(read[key]?.value ?? "", key).toBe("");
    for (const key of ["progress_level", "next_step"]) expect(read[key]?.checked ?? [], key).toEqual([]);
  });

  it.each([
    ["Kaitlyn improved and followed the sanitizing procedure correctly during today’s observation.", ["follow_up_observation", "progress_level", "specific_evidence"]],
    ["Add this to the form: Kaitlyn improved and followed the sanitizing procedure correctly during today’s observation.", ["follow_up_observation", "progress_level", "specific_evidence"]],
    ["She has improved since our last conversation.", ["follow_up_observation", "progress_level", "specific_evidence"]],
    ["During today’s follow-up she followed all the sanitizing steps.", ["follow_up_observation", "specific_evidence"]],
    ["No improvement yet. She skipped two steps again.", ["follow_up_observation", "progress_level", "specific_evidence"]],
    ["She is making progress but still needs reminders.", ["follow_up_observation", "progress_level", "specific_evidence"]],
  ])("%j", async (report, expected) => {
    const { id, history } = await openFollowUpForm();
    const before = await snapshot(id);
    // The model offers everything, including a next step and coaching nobody reported.
    state.revise = {
      values: {
        follow_up_observation: "Observation drawn from the manager's report.",
        specific_evidence: "Evidence drawn from the manager's report.",
        additional_coaching: "Invented additional coaching.",
        original_topic: "REWRITTEN",
        next_follow_up: "REWRITTEN",
      },
      checked: { progress_level: ["improved"], next_step: ["continue"] },
    };
    const response = await revise(id, history, report);
    expect(response, "falls through to the knowledge base").not.toBeNull();
    const after = await snapshot(id);
    expect(changedKeys(before, after)).toEqual(expected);
    expect(after.original_topic!.value).toBe("Bed sanitizing");
    expect(after.next_follow_up!.value).toBe("in 2 weeks");
    expect(after.next_step?.checked ?? []).toEqual([]);
    expect(after.additional_coaching?.value ?? "").toBe("");
    expect(response!.formUpdate!.instanceId).toBe(id);
    expect(store.form_instances).toHaveLength(1);
  });

  it("an explicit field instruction still limits the change to that field", async () => {
    const { id, history } = await filledFollowUpForm();
    const before = await snapshot(id);
    state.revise = { values: { follow_up_observation: "REWRITTEN" }, checked: { progress_level: ["partially_improved"], next_step: ["role_play"] } };
    await revise(id, history, "Change only Progress Level to Partially Improved.");
    const after = await snapshot(id);
    expect(changedKeys(before, after)).toEqual(["progress_level"]);
    expect(after.progress_level!.checked).toEqual(["partially_improved"]);
  });

  it("a question while the form is open is still a question", async () => {
    const { id, history } = await openFollowUpForm();
    for (const question of ["What does the progress level mean?", "Did she improve?", "What's our policy on bed sanitizing?", "Can you mention our attendance policy?"]) {
      expect(await revise(id, history, question), question).toBeNull();
    }
  });

  it("a finalized form is refused, with the model never asked", async () => {
    const { id, history } = await filledFollowUpForm();
    store.form_instances[0]!.status = "finalized";
    for (const turnText of ["Kaitlyn improved during today’s observation.", "Make the follow up 10 days instead.", "Change the follow-up date to 10/15"]) {
      const response = await revise(id, history, turnText);
      expect(response?.content, turnText).toMatch(/finalized/);
    }
    expect(modelCalls("revise_form_fields")).toBe(0);
    expect(store.form_instances[0]!.follow_up_date ?? null).toBeNull();
  });
});

describe("P3 — a badly behaved model cannot rewrite what the request did not ask about", () => {
  const adversarial = {
    values: {
      next_follow_up: "within 10 days",
      follow_up_observation: "REWRITTEN",
      specific_evidence: "REWRITTEN",
      original_topic: "REWRITTEN",
      additional_coaching: "",
    },
    checked: { progress_level: ["partially_improved"], next_step: ["role_play"] },
    clear: ["additional_coaching", "specific_evidence"],
  };

  it.each([
    "Make the follow up 10 days instead.",
    "Can you re-draft a cleaner version with the next follow-up as within 10 days?",
    "Please open the form and change the timeframe to within 10 days.",
    "Can you redraft the coaching form and change the next follow-up to within 10 days?",
  ])("%j changes only the timeframe, on the same form", async (question) => {
    const { id, history } = await filledFollowUpForm();
    const before = await snapshot(id);
    state.revise = JSON.parse(JSON.stringify(adversarial));
    const response = await revise(id, history, question);
    const after = await snapshot(id);
    expect(changedKeys(before, after)).toEqual(["next_follow_up"]);
    expect(after.next_follow_up!.value).toBe("within 10 days");
    expect(response!.content).toContain("Updated the **Follow-Up Coaching Form** for **Kaitlyn Marsh**: Next Follow-Up.");
    expect(store.form_instances).toHaveLength(1);
    expect((await review(id)).instance.templateKey).toBe("follow-up-coaching");
  });

  it.each(["Redraft it with these changes.", "Redraft this cleaner but keep everything else.", "Clean this up.", "redraft it with changes"])(
    "%j cannot replace, drop or re-tick anything",
    async (question) => {
      const { id, history } = await filledFollowUpForm();
      const before = await snapshot(id);
      state.revise = JSON.parse(JSON.stringify(adversarial));
      await revise(id, history, question);
      expect(changedKeys(before, await snapshot(id))).toEqual([]);
    },
  );

  it("a genuine rewording of Sunny's text is kept, and nothing else moves", async () => {
    const { id, history } = await filledFollowUpForm();
    const before = await snapshot(id);
    state.revise = {
      values: { follow_up_observation: "Since the coaching, Kaitlyn has sanitized every bed after each client.", specific_evidence: "Reworded." },
      checked: { progress_level: ["partially_improved"] },
    };
    await revise(id, history, "Redraft this cleaner but keep everything else.");
    const after = await snapshot(id);
    expect(changedKeys(before, after)).toEqual(["follow_up_observation"]);
    expect(after.specific_evidence!.value).toBe("Manager's own words: watched 3 shifts.");
  });
});

/* =============================================== P4: the date vs the timeframe == */

describe("P4 — the follow-up date and the agreed timeframe", () => {
  it("'Change the follow-up date to 10/15' sets the calendar date, never Next Follow-Up", async () => {
    const { id, history } = await filledFollowUpForm();
    const before = await snapshot(id);
    state.revise = { values: { next_follow_up: "10/15" } };
    const response = await revise(id, history, "Change the follow-up date to 10/15");
    const read = await review(id);
    expect(read.instance.followUpDate).toBe("2026-10-15");
    expect(changedKeys(before, await snapshot(id))).toEqual([]);
    expect(modelCalls("revise_form_fields")).toBe(0);
    expect(response!.content).toContain("Set the follow-up date to **Thursday, October 15, 2026**.");
    expect(response!.content).toContain("Next Follow-Up — the timeframe you agreed — is as it was.");
    // The inline form re-reads, so the date control shows it at once.
    expect(response!.formUpdate).toEqual({ instanceId: id, updated: ["follow_up_date"] });
  });

  it.each(["schedule the follow-up for October 15", "set the follow-up date to 10/15"])("%j", async (text) => {
    const { id, history } = await filledFollowUpForm();
    await revise(id, history, text);
    expect((await review(id)).instance.followUpDate).toBe("2026-10-15");
    expect((await snapshot(id)).next_follow_up!.value).toBe("within 2 weeks");
  });

  it.each([
    ["Change the follow-up date to next Friday", "I couldn't tell which day you meant."],
    ["Change the follow-up date to 9/1", "has already passed"],
    ["Set the follow-up date to 10/15 or 10/16", "more than one date"],
  ])("%j is not guessed: the manager is told to use the control", async (text, why) => {
    const { id, history } = await filledFollowUpForm();
    const response = await revise(id, history, text);
    expect(response!.content).toContain("I didn't change the follow-up date. Use the Follow-up date control on the form.");
    expect(response!.content).toContain(why);
    expect((await review(id)).instance.followUpDate).toBeNull();
    expect((await snapshot(id)).next_follow_up!.value).toBe("within 2 weeks");
  });

  it.each([
    ["follow up again in 10 days", "within 10 days"],
    ["check back within two weeks", "within two weeks"],
    ["next follow-up should be in one month", "in one month"],
  ])("%j updates the timeframe and never the date", async (text, value) => {
    const { id, history } = await filledFollowUpForm();
    const before = await snapshot(id);
    state.revise = { values: { next_follow_up: value, original_topic: "REWRITTEN" } };
    await revise(id, history, text);
    expect(changedKeys(before, await snapshot(id))).toEqual(["next_follow_up"]);
    expect((await review(id)).instance.followUpDate).toBeNull();
  });

  it("a follow-up reported in the same breath as the date is still recorded", async () => {
    const { id, history } = await openFollowUpForm();
    state.revise = {
      values: { follow_up_observation: "Kaitlyn followed every sanitizing step.", next_follow_up: "10/15" },
      checked: { progress_level: ["improved"] },
    };
    await revise(id, history, "Kaitlyn has improved and followed every sanitizing step. Schedule the follow-up for 10/15.");
    const after = await snapshot(id);
    expect((await review(id)).instance.followUpDate).toBe("2026-10-15");
    expect(after.follow_up_observation!.value).toBe("Kaitlyn followed every sanitizing step.");
    expect(after.progress_level!.checked).toEqual(["improved"]);
    expect(after.next_follow_up!.value).toBe("in 2 weeks");
  });

  it("a date the model works out from a timeframe never lands in Next Follow-Up", async () => {
    const { id, history } = await filledFollowUpForm();
    state.revise = { values: { next_follow_up: "10/11" } };
    await revise(id, history, "follow up again in 10 days");
    expect((await snapshot(id)).next_follow_up!.value).toBe("within 2 weeks");
  });
});

/* ================================================ P5 & P6: proactive, small fixes == */

describe("P5 — proactive coaching stays proactive", () => {
  it("'again' in a refresher no longer lets Underperformance or a concern label through", async () => {
    state.draft = {
      values: { coaching_details: "Observed:\nKaitlyn reviewed the bed sanitizing steps. This is a performance concern.\n\nExpectation:\nEvery bed is sanitized after each client." },
      checked: { coaching_type: ["underperformance", "training_plan_of_action"] },
    };
    const { id } = await createFrom([
      said("Create a coaching form for Kaitlyn Marsh — quick reminder going over the bed sanitizing steps again before the new checklist starts."),
    ]);
    const read = await snapshot(id);
    expect(read.coaching_details!.value).not.toMatch(/concern/i);
    expect(read.coaching_type!.checked).toEqual(["training_plan_of_action"]);
  });

  it("a real shortfall is still recorded as one", async () => {
    state.draft = { values: { coaching_details: "Observed:\nKaitlyn skipped the sanitizing step again after being coached." }, checked: { coaching_type: ["underperformance"] } };
    const { id } = await createFrom([said("Create a coaching form for Kaitlyn Marsh — she skipped the sanitizing step again after being coached.")]);
    expect((await snapshot(id)).coaching_type!.checked).toEqual(["underperformance"]);
  });
});

describe("P6 — the smaller revision defects", () => {
  it("never prints an empty label in the confirmation", async () => {
    const { id, history } = await filledFollowUpForm();
    state.revise = { values: {}, checked: { next_step: ["role_play"], progress_level: ["partially_improved"] } };
    const response = await revise(id, history, "Change the progress level to partially improved and set the next step to role-play.");
    expect(response!.content).toMatch(/^Updated the \*\*Follow-Up Coaching Form\*\* for \*\*Kaitlyn Marsh\*\*: (?:Progress Level, Next Step|Next Step, Progress Level)\./);
    expect(response!.content).not.toMatch(/,\s*\./);
  });

  it("a removal is recorded as the app's write on request, not as the manager's text", async () => {
    const { id, history } = await filledFollowUpForm();
    state.revise = { values: {}, clear: ["additional_coaching"] };
    await revise(id, history, "Remove the additional coaching section.");
    const row = store.form_instance_values.find((entry) => entry.instance_id === id && entry.field_key === "additional_coaching")!;
    expect(row.value).toBe("");
    expect(row.filled_by).toBe("system");
    expect(row.provenance).toEqual({ source: "cleared_on_request", via: "chat_revision" });
  });
});

/* ========================================================= P7: the directory == */

describe("P7 — shared and service accounts are never a name suggestion", () => {
  it.each(["No Manger", "Risk Managment", "GlowBrand IT Support"])("%j is not matched to a service row", async (typed) => {
    const response = await propose([said(`Create a coaching form for ${typed}, she was late today.`)]);
    expect(response!.content).not.toMatch(/Did you mean \*\*(?:No Manager|Risk Management|GlowBrands IT Support)\*\*/);
  });

  it("real people are still matched", async () => {
    state.scope = GLOBAL_SCOPE;
    state.role = "admin";
    const response = await propose([said("Create a coaching form for Katlyn Marsh, she was late today.")]);
    expect(response!.content).toMatch(/^Did you mean \*\*Kaitlyn Marsh\*\*\?/);
  });
});
