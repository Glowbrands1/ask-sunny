import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { extractText, getDocumentProxy } from "unpdf";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * THE CORRECTIVE ACTION FORM, REVISION 5, THROUGH THE WHOLE WORKFLOW
 * ============================================================================
 *
 * HR feedback, 3 Oct 2026 — the prior coaching/corrective-action list, the
 * employee by first name rather than pronoun, and the Action Plan's required
 * closing — checked where a manager meets them: created from chat, drafted,
 * edited, redrafted, corrected in chat, revised, and downloaded.
 *
 * The harness is the one `corrective-action-payroll-e2e.test.ts` uses; only
 * the model's answer is set per test.
 *
 * Conversation -> proposal -> `createInlineForm` (the browser's orchestrator)
 * -> POST /api/forms/instances -> POST .../draft -> GET .../[id] (review) ->
 * GET .../pdf (download) -> a correction in chat -> GET .../pdf again.
 *
 * Everything is real except the identity provider, the model, the knowledge
 * base and the database (the in-memory Supabase fake the forms suite uses).
 * The library is installed by `ensureTemplateLibrary`, so the form is filled
 * against the Corrective Action Form revision that is actually seeded.
 *
 * Set CA_FORM_PDF_DIR to keep the PDFs for a visual check.
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
  modelCalls: 0,
  toolValues: {} as Record<string, string>,
  toolChecked: { warning_type: ["verbal"] } as Record<string, string[]>,
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
      create: async () => {
        state.modelCalls += 1;
        return {
          content: [
            {
              type: "tool_use",
              name: "write_form_fields",
              input: { values: state.toolValues, checked: state.toolChecked },
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
      return { ok: false, reason: "not needed" };
    }
  },
}));

vi.mock("@/lib/knowledge", () => ({
  /* Server code must search through SupabaseKnowledgeProvider; the browser client cannot run here. */
  getKnowledgeProvider: () => {
    throw new Error("getKnowledgeProvider() is the browser knowledge client and must not be used on the server");
  },
}));

process.env.NEXT_PUBLIC_DEMO_MODE = "false";

const { ensureTemplateLibrary, listTemplateSummaries } = await import("@/lib/forms/repository");
const { proposeFormForTurn } = await import("@/lib/ai/form-proposal");
const { createInlineForm } = await import("@/features/chat/create-inline-form");
const { correctActiveForm } = await import("@/lib/forms/chat-correction");
const { CA_ACTION_PLAN_CLOSING: CLOSING } = await import("@/lib/forms/required-closing");
const instancesRoute = await import("./instances/route");
const instanceRoute = await import("./instances/[id]/route");
const draftRoute = await import("./instances/[id]/draft/route");
const pdfRoute = await import("./instances/[id]/pdf/route");

/** The view's join, which the fake does not model — see `exit-form-e2e.test.ts`. */
function joinOverview() {
  for (const row of store.form_instances ?? []) {
    const template = store.form_templates!.find((entry) => entry.id === row.template_id);
    const version = store.form_template_versions.find((entry) => entry.id === row.template_version_id);
    Object.assign(row, {
      form_date: row.form_date ?? "2026-09-29",
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
    values: { fieldKey: string; value: string | null; checked: string[]; filledBy: string }[];
  };
}

async function download(id: string, name: string) {
  joinOverview();
  const response = await pdfRoute.GET(new Request(`https://app.test/api/forms/instances/${id}/pdf`), {
    params: Promise.resolve({ id }),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/pdf");
  const bytes = new Uint8Array(await response.arrayBuffer());
  const dir = process.env.CA_FORM_PDF_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.pdf`), bytes);
  }
  // A copy: pdf.js takes ownership of (and empties) the buffer it is given.
  const { text } = await extractText(await getDocumentProxy(bytes.slice()), { mergePages: true });
  return { bytes, text };
}

let sequence = 0;
const said = (content: string): ChatMessage => ({
  id: `m${(sequence += 1)}`,
  role: "user",
  content,
  createdAt: "2026-09-29T15:00:00Z",
});

/**
 * Plays the manager's turns through the real proposal flow, feeding Ask
 * Sunny's real answers forward as history, then creates the form from the
 * last proposal exactly as the chat's Create draft button does.
 */
async function conversation(turns: string[]) {
  const messages: ChatMessage[] = [];
  let proposal = null as Awaited<ReturnType<typeof proposeFormForTurn>> extends infer R
    ? R extends { formProposal?: infer P } ? P | null : null
    : null;
  let content = "";
  for (const turn of turns) {
    const message = said(turn);
    const response = await proposeFormForTurn({
      history: messages,
      question: message.content,
      questionMessageId: message.id,
      actor: { role: state.role as never, scope: state.scope as AccessScope },
      summaries: await listTemplateSummaries(),
      today: "2026-09-29",
      ...(proposal ? { continueTemplateKey: proposal.templateKey } : {}),
    });
    expect(response?.formProposal, turn).toBeDefined();
    proposal = response!.formProposal!;
    content = response!.content;
    messages.push(message, {
      id: `a${sequence}`,
      role: "assistant",
      content,
      createdAt: "2026-09-29T15:00:01Z",
      formProposal: proposal,
    } as ChatMessage);
  }
  expect(proposal!.templateKey).toBe("dpoa");
  expect(proposal!.supportsInlineDraft).toBe(true);
  const result = await createInlineForm({
    proposal: proposal!,
    messages: messages.filter((message) => message.role === "user"),
    call,
    onCreated: () => {},
  });
  return { proposal: proposal!, content, result };
}

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  requests.length = 0;
  state.role = "salon_director";
  state.scope = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: [] };
  state.modelCalls = 0;
  state.toolValues = {};
  state.toolChecked = { warning_type: ["verbal"] };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-29T15:00:00Z"));
  await ensureTemplateLibrary("system");
});


/** PATCH /api/forms/instances/[id] — the editor's save, as a person. */
async function edit(id: string, values: Record<string, string>) {
  joinOverview();
  const response = await instanceRoute.PATCH(
    new Request(`https://app.test/api/forms/instances/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ values }),
    }),
    { params: Promise.resolve({ id }) },
  );
  expect(response.status).toBe(200);
}

/** POST .../draft again — Ask Sunny redrafting the open form from new notes. */
async function redraft(id: string, notes: string) {
  joinOverview();
  const response = await draftRoute.POST(
    new Request(`https://app.test/api/forms/instances/${id}/draft`, {
      method: "POST",
      body: JSON.stringify({ notes }),
    }),
    { params: Promise.resolve({ id }) },
  );
  expect(response.status).toBe(200);
  joinOverview();
  return (await response.json()) as Record<string, unknown>;
}

const valueOf = async (id: string, key: string) =>
  (await review(id)).values.find((row) => row.fieldKey === key)?.value ?? null;
const count = (text: string, needle: string) => text.replace(/\s+/g, " ").split(needle).length - 1;

/** What the plan-of-action prompt asks for — with the pronoun a model still writes. */
const PLAN_WITH_PRONOUN =
  "Jessica is expected to adhere to the Sun Tan City attendance policy by arriving on time for every scheduled shift. Moving forward, she should arrive ready to work at the start of her shift. Management will monitor compliance and provide coaching as needed.";
const PLAN_NAMED =
  "Jessica is expected to adhere to the Sun Tan City attendance policy by arriving on time for every scheduled shift. Moving forward, Jessica should arrive ready to work at the start of the shift. Management will monitor compliance and provide coaching as needed.";

const OPENING =
  "Create a CA for Jessica Moss. She was 30 minutes late today, verbal warning. She was coached on 9/2 and got a verbal warning on 9/21. No payroll deduct.";

describe("creating a Corrective Action from chat", () => {
  it("drafts the new history list, names the employee, ends the plan with the closing, and prints all three", async () => {
    state.toolValues = {
      observation:
        "Observed:\nShe arrived 30 minutes late for her scheduled shift today.\n\nExpectation:\nEmployees are expected to arrive on time for every scheduled shift.\n\nGoing Forward:\nShe should plan to arrive early.",
      action_plan: PLAN_WITH_PRONOUN,
      prior_actions: "Coaching — signed 09/02/2026\nVerbal warning — signed 09/21/2026",
      // A careless model writing to the revision-4 lines: refused, they are not on this version.
      previous_action: "Verbal warning",
      previous_action_date: "2026-09-21",
    };
    const { proposal, result } = await conversation([OPENING]);
    expect(proposal.employeeName).toBe("Jessica Moss");
    expect(result.draftWarning).toBeNull();
    const id = result.reference.instanceId;

    const { values } = await review(id);
    const byKey = Object.fromEntries(values.map((row) => [row.fieldKey, row.value]));

    // 1. The new list, two entries, each with its signed date.
    expect(byKey.prior_actions).toBe("Coaching — signed 09/02/2026\nVerbal warning — signed 09/21/2026");
    expect(byKey).not.toHaveProperty("previous_action");
    expect(byKey).not.toHaveProperty("previous_action_date");

    // 2. The first name, never the pronoun, in the generated narrative.
    // Named once, and the possessive restructured rather than repeated.
    expect(byKey.observation).toContain("Jessica arrived 30 minutes late for the scheduled shift today.");
    expect(byKey.observation).not.toMatch(/Jessica\b[^.]*\bJessica's/);
    expect(byKey.observation).toContain("Jessica should plan to arrive early.");
    expect(byKey.observation).not.toMatch(/\b(?:she|her)\b/i);

    // 3. The plan, named, and ending with the closing — exactly once.
    expect(byKey.action_plan).toBe(`${PLAN_NAMED} ${CLOSING}`);

    const { text } = await download(id, "ca-rev5-created");
    expect(text).toContain("List previously received coaching and/or corrective action with date signed");
    expect(text).toContain("Coaching - signed 09/02/2026");
    expect(text).toContain("Verbal warning - signed 09/21/2026");
    expect(text).not.toContain("Previous corrective action for this policy or issue");
    expect(text).not.toContain("Date of previous corrective action");
    expect(count(text, CLOSING)).toBe(1);
    expect(text.replace(/\s+/g, " ")).toContain(`the start of the shift. Management will monitor compliance and provide coaching as needed. ${CLOSING}`);
  });

  it("asks the intake question the new field answers", async () => {
    const response = await proposeFormForTurn({
      history: [],
      question: "I need to create a corrective action form",
      questionMessageId: "m-intake",
      actor: { role: state.role as never, scope: state.scope as AccessScope },
      summaries: await listTemplateSummaries(),
      today: "2026-09-29",
    });
    expect(response?.content).toMatch(/previously received coaching and\/or corrective action, and if yes, what and the date each was signed/);
  });

  it("does not duplicate a closing the model wrote anyway, nor keep its paraphrase's twin", async () => {
    state.toolValues = { action_plan: `${PLAN_NAMED} ${CLOSING}` };
    const { result } = await conversation([OPENING]);
    const plan = (await valueOf(result.reference.instanceId, "action_plan"))!;
    expect(count(plan, CLOSING)).toBe(1);
    expect(plan.endsWith(CLOSING)).toBe(true);
  });

  it("puts the closing on even when the model wrote no plan sentence the guards kept", async () => {
    state.toolValues = { action_plan: "Jessica will arrive on time" };
    const { result } = await conversation([OPENING]);
    expect(await valueOf(result.reference.instanceId, "action_plan")).toBe(`Jessica will arrive on time. ${CLOSING}`);
  });
});

describe("changing the Action Plan after the form exists", () => {
  it("keeps the closing through a manager's edit, a redraft and a chat correction", async () => {
    state.toolValues = { action_plan: PLAN_NAMED };
    const { result } = await conversation([OPENING]);
    const id = result.reference.instanceId;
    expect(await valueOf(id, "action_plan")).toBe(`${PLAN_NAMED} ${CLOSING}`);

    // A manager rewrites the plan and deletes the closing in the editor.
    await edit(id, { action_plan: "Jessica will set an earlier alarm and arrive ten minutes early." });
    expect(await valueOf(id, "action_plan")).toBe(
      `Jessica will set an earlier alarm and arrive ten minutes early. ${CLOSING}`,
    );

    // …and types after it.
    await edit(id, { action_plan: `Jessica will arrive early. ${CLOSING} Jessica agreed to this plan.` });
    expect(await valueOf(id, "action_plan")).toBe(`Jessica will arrive early. Jessica agreed to this plan. ${CLOSING}`);

    // Ask Sunny redrafts the plan — the model leaves the closing out.
    state.toolValues = { action_plan: "Moving forward, she should arrive ready to work at the start of each shift." };
    await redraft(id, "Redo the action plan: Jessica was 30 minutes late today, verbal warning.");
    const redrafted = (await valueOf(id, "action_plan"))!;
    expect(redrafted).toBe(`Moving forward, Jessica should arrive ready to work at the start of each shift. ${CLOSING}`);
    expect(count(redrafted, CLOSING)).toBe(1);

    // A correction in chat to another line leaves the plan, and its closing, alone.
    const correction = await correctActiveForm({
      request: new Request("https://app.test/api/chat"),
      instanceId: id,
      question: "change payroll deduct to yes",
      today: "2026-09-29",
    });
    expect(correction?.formUpdate).toEqual({ instanceId: id, updated: ["payroll_deduct"] });
    expect(await valueOf(id, "action_plan")).toBe(redrafted);

    const { text } = await download(id, "ca-rev5-after-corrections");
    expect(count(text, CLOSING)).toBe(1);
  });

  it("lets a manager list several prior actions by hand, and prints them all", async () => {
    const { result } = await conversation([OPENING]);
    const id = result.reference.instanceId;
    const history = [
      "Coaching (attendance) — signed 08/12/2026",
      "Coaching (attendance) — signed 09/02/2026",
      "Verbal warning — signed 09/21/2026",
      "Written warning — signed 09/28/2026",
    ].join("\n");
    await edit(id, { prior_actions: history });
    expect(await valueOf(id, "prior_actions")).toBe(history);

    const { text } = await download(id, "ca-rev5-history");
    for (const line of history.split("\n")) expect(text).toContain(line.replace("—", "-"));
  });
});

describe("a Corrective Action filed on revision 4, revised", () => {
  it("keeps the original exactly, and carries its two old lines into the new list on the revision", async () => {
    const { result } = await conversation([OPENING]);
    const id = result.reference.instanceId;

    // Re-point this record at a revision-4 version, filed, with the old lines filled.
    const current = store.form_template_versions.find((row) => {
      const instance = store.form_instances.find((entry) => entry.id === id)!;
      return row.id === instance.template_version_id;
    })!;
    const document = current.document as { blocks: Record<string, unknown>[] };
    const revision4 = {
      ...current,
      id: "dpoa-revision-4",
      version: 0,
      status: "archived",
      seed_revision: 4,
      document: {
        ...document,
        blocks: document.blocks.flatMap((block) => {
          const field = block.field as Record<string, unknown> | undefined;
          if (field?.key === "prior_actions") {
            return [
              { kind: "field", field: { key: "previous_action", label: "Previous corrective action for this policy or issue", input: "text", responsibility: "ai" } },
              { kind: "field", field: { key: "previous_action_date", label: "Date of previous corrective action", input: "date", responsibility: "ai" } },
            ];
          }
          if (field?.key === "action_plan") {
            const rest = { ...field };
            delete rest.requiredClosing;
            return [{ ...block, field: rest }];
          }
          return [block];
        }),
      },
    };
    store.form_template_versions.push(revision4);
    const instance = store.form_instances.find((entry) => entry.id === id)!;
    instance.template_version_id = revision4.id;
    instance.status = "finalized";
    store.form_instance_values = store.form_instance_values.filter(
      (row) => row.instance_id !== id || !["prior_actions", "action_plan"].includes(String(row.field_key)),
    );
    for (const [field_key, value] of [
      ["previous_action", "Verbal warning for tardiness"],
      ["previous_action_date", "2026-09-21"],
      ["action_plan", "Jessica will arrive on time."],
    ]) {
      store.form_instance_values.push({ instance_id: id, field_key, value, checked: [], filled_by: "ai", provenance: {} });
    }

    // The filed record prints as signed.
    const filed = await download(id, "ca-rev4-filed");
    expect(filed.text).toContain("Previous corrective action for this policy or issue");
    expect(filed.text).toContain("Date of previous corrective action");
    expect(filed.text).not.toContain("List previously received coaching");
    expect(filed.text).not.toContain("Future policy violations");

    // A revision opens on the current version, with the history carried over.
    joinOverview();
    const response = await instanceRoute.POST(
      new Request(`https://app.test/api/forms/instances/${id}`, { method: "POST", body: JSON.stringify({ action: "revise" }) }),
      { params: Promise.resolve({ id }) },
    );
    expect(response.status).toBe(200);
    const revision = ((await response.json()) as { instance: { id: string } }).instance.id;
    expect(await valueOf(revision, "prior_actions")).toBe("Verbal warning for tardiness — signed 09/21/2026");
    expect(await valueOf(revision, "action_plan")).toBe(`Jessica will arrive on time. ${CLOSING}`);

    // And the original's values are untouched.
    const original = (await review(id)).values;
    expect(original.find((row) => row.fieldKey === "action_plan")?.value).toBe("Jessica will arrive on time.");
    expect(original.find((row) => row.fieldKey === "prior_actions")).toBeUndefined();

    const revised = await download(revision, "ca-rev5-revision");
    expect(revised.text).toContain("Verbal warning for tardiness - signed 09/21/2026");
    expect(count(revised.text, CLOSING)).toBe(1);
  });
});
