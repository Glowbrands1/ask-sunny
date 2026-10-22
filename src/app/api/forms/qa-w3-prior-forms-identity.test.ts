import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * QA F-11, 22 OCT 2026 — A NAME IS NOT AN IDENTITY
 * ============================================================================
 *
 * A Corrective Action's "previously received coaching and/or corrective
 * action" list was filled from every finalized form, at every salon the
 * manager can see, whose employee NAME matched — forms carry no person id. So
 * another "Dana Moss" at a second salon could have her Verbal CA written onto
 * this Dana Moss's form. A record on file is now attached only when the name
 * can mean one person: a full name, on file only at the form's own salon, read
 * completely, dated on or before the form. Anything else is a possible match
 * for the manager to confirm and is never written. Nothing on file changes.
 *
 * Conversation -> proposal -> `createInlineForm` -> POST /api/forms/instances
 * -> POST .../draft -> GET .../[id]. Identity, the model and the database are
 * stand-ins; visibility (`instance-scope.ts`) is the real rule.
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

const state = vi.hoisted(() => ({ role: "salon_director", scope: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));

vi.mock("@/lib/api/respond", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/respond")>();
  return { ...actual, assertLiveMode: () => {}, assertNoConfigurationProblems: () => {}, assertWithinRateLimit: () => {} };
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
        identity: { subject: "manager-1", email: "m@example.com", displayName: "Manager", role: state.role, scope: state.scope, verified: true },
        permission,
        provider: "supabase",
      };
    },
  };
});

vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async () => ({
        content: [
          {
            type: "tool_use",
            name: "write_form_fields",
            input: { values: { observation: "Observed: Dana Moss arrived 30 minutes late today." }, checked: { warning_type: ["verbal"] } },
          },
        ],
      }),
    },
  }),
}));

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    async search() {
      return [];
    }
    async fetchRoleGrounding() {
      const row = (index: number, locator: string) => ({
        chunk_id: `pmf-${index}`,
        document_id: "doc-progression",
        document_title: "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
        category: "leadership_coaching",
        locator,
        page: null,
        section: null,
        content: `Framework text: ${locator}.`,
        similarity: 0,
      });
      return {
        ok: true,
        grounding: {
          role: { id: "performance_management_framework" },
          documentId: "doc-progression",
          documentTitle: "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
          matchedBy: "tag",
          rows: [row(0, "SECTION 2 – PERFORMANCE MANAGEMENT LADDER"), row(1, "10.7 Final operating rule for Ask Sunny")],
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
  getKnowledgeProvider: () => {
    throw new Error("browser knowledge client");
  },
}));

process.env.NEXT_PUBLIC_DEMO_MODE = "false";

const { ensureTemplateLibrary, listTemplateSummaries } = await import("@/lib/forms/repository");
const { proposeFormForTurn } = await import("@/lib/ai/form-proposal");
const { createInlineForm } = await import("@/features/chat/create-inline-form");
const { priorFormsForChat, priorFormsReadingForChat, readPriorFormsOnFile } = await import("@/lib/forms/prior-forms");
const instancesRoute = await import("./instances/route");
const instanceRoute = await import("./instances/[id]/route");
const draftRoute = await import("./instances/[id]/draft/route");

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

async function priorActionsOn(id: string): Promise<string | null> {
  joinOverview();
  const response = await instanceRoute.GET(new Request(`https://app.test/api/forms/instances/${id}`), { params: Promise.resolve({ id }) });
  expect(response.status).toBe(200);
  const { values } = (await response.json()) as { values: { fieldKey: string; value: string | null }[] };
  return values.find((row) => row.fieldKey === "prior_actions")?.value ?? null;
}

/** A finalized form on file, filed by somebody else (another manager's record). */
async function onFile(templateKey: string, formDate: string, employeeName: string, locationId: string, level = "verbal") {
  const { createInstance, finalizeInstance, saveInstanceValues } = await import("@/lib/forms/instances");
  const instance = await createInstance({ templateKey, variantKey: null, employeeName, locationId, createdBy: "manager-2", source: "ask_sunny", formDate });
  if (templateKey === "dpoa") await saveInstanceValues(instance.id, { checked: { warning_type: [level] } }, "manager-2");
  await finalizeInstance(instance.id, "manager-2", null, { acknowledgeUnverifiedPolicy: true });
  joinOverview();
  return instance;
}

const actor = () => ({ role: state.role as never, scope: state.scope as AccessScope, subject: "manager-1", verified: true });

let sequence = 0;
const said = (content: string): ChatMessage => ({ id: `m${(sequence += 1)}`, role: "user", content, createdAt: "2026-09-29T15:00:00Z" });

/** Two manager turns through the real proposal, as the browser sends them, then Create draft. */
async function caFor(name: string, second = "verbal, payroll deduct no.", where = "") {
  const messages: ChatMessage[] = [];
  let proposal: NonNullable<Awaited<ReturnType<typeof proposeFormForTurn>>>["formProposal"];
  let content = "";
  for (const text of [`I need a CA for ${name}${where}. She was 30 minutes late today.`, second]) {
    const message = said(text);
    const response = await proposeFormForTurn({
      history: messages,
      question: message.content,
      questionMessageId: message.id,
      actor: actor(),
      summaries: await listTemplateSummaries(),
      today: "2026-09-29",
      priorFormsOnFile: (employeeName) => priorFormsForChat(actor(), employeeName),
      ...(proposal ? { continueTemplateKey: proposal.templateKey } : {}),
    });
    expect(response?.formProposal, text).toBeDefined();
    proposal = response!.formProposal!;
    content = response!.content;
    messages.push(message, { id: `a${sequence}`, role: "assistant", content, createdAt: "2026-09-29T15:00:01Z", formProposal: proposal } as ChatMessage);
  }
  const result = await createInlineForm({ proposal: proposal!, messages: messages.filter((m) => m.role === "user"), call, onCreated: () => {} });
  return { content, proposal: proposal!, id: result.reference.instanceId };
}

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  state.role = "salon_director";
  state.scope = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: [] };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-29T15:00:00Z"));
  await ensureTemplateLibrary("system");
});

describe("positive: one Dana Moss, on file only at this salon", () => {
  it("reads her history back in chat and writes it onto the drafted form", async () => {
    await onFile("coaching", "2026-09-02", "Dana Moss", "loc-0310");
    await onFile("dpoa", "2026-09-21", "Dana Moss", "loc-0310");
    const { content, id } = await caFor("Dana Moss");
    expect(content).toContain("**On file in Form Monitoring for Dana Moss:** Coaching — signed 09/02/2026; Verbal corrective action — signed 09/21/2026.");
    expect(await priorActionsOn(id)).toBe("Coaching — signed 09/02/2026\nVerbal corrective action — signed 09/21/2026");
  });

  it("lists a Coaching Form and a Verbal CA signed the SAME day as two steps", async () => {
    await onFile("coaching", "2026-09-21", "Dana Moss", "loc-0310");
    await onFile("dpoa", "2026-09-21", "Dana Moss", "loc-0310");
    const { id } = await caFor("Dana Moss");
    expect(await priorActionsOn(id)).toBe("Coaching — signed 09/21/2026\nVerbal corrective action — signed 09/21/2026");
  });
});

describe("negative: a same-name record the manager cannot see", () => {
  it("is never read, read back or written — at any step", async () => {
    await onFile("dpoa", "2026-09-21", "Dana Moss", "loc-0309"); // NE Kearney: not this Salon Director's
    const reading = await readPriorFormsOnFile({ actor: { id: "manager-1", role: "salon_director", verified: true, scope: state.scope as AccessScope, visibility: state.scope as AccessScope } as never, employeeName: "Dana Moss", locationId: "loc-0310" });
    expect(reading).toEqual({ attach: [], possible: [], identity: "none" });
    const { content, id } = await caFor("Dana Moss");
    expect(content).not.toContain("On file");
    expect(await priorActionsOn(id)).toBeNull();
  });
});

describe("ambiguous: the same name at another salon the manager CAN see", () => {
  beforeEach(() => {
    state.scope = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: ["loc-0311"] };
  });

  it("writes neither record, says neither will be listed, and changes nothing on file", async () => {
    const here = await onFile("coaching", "2026-09-02", "Dana Moss", "loc-0310");
    const there = await onFile("dpoa", "2026-09-21", "Dana Moss", "loc-0311");
    const before = JSON.stringify(store.form_instance_values);
    // The manager names the salon, so the form is filed at Lincoln 27th Street (loc-0310).
    const { content, id, proposal } = await caFor("Dana Moss", "verbal, payroll deduct no.", " at lincoln 27th street");
    expect(proposal).toMatchObject({ employeeName: "Dana Moss", locationId: "loc-0310", status: "ready" });
    expect(content).not.toContain("On file in Form Monitoring");
    // The manager is asked for the history instead of being handed someone else's.
    expect(content).toMatch(/any prior coaching or corrective action/);
    expect(await priorActionsOn(id)).toBeNull();
    // Historical records are untouched.
    const unchanged = (instance: { id: string }) => (store.form_instances ?? []).find((row) => row.id === instance.id);
    expect(unchanged(here)).toMatchObject({ status: "finalized" });
    expect(unchanged(there)).toMatchObject({ status: "finalized" });
    expect(JSON.stringify(store.form_instance_values.filter((row) => row.instance_id !== id))).toBe(
      JSON.stringify(JSON.parse(before)),
    );
  });

  it("offers the records as possible matches, each with its salon", async () => {
    await onFile("coaching", "2026-09-02", "Dana Moss", "loc-0310");
    await onFile("dpoa", "2026-09-21", "Dana Moss", "loc-0311");
    const reading = await priorFormsReadingForChat(actor(), "Dana Moss", "loc-0310");
    expect(reading.identity).toBe("other_locations");
    expect(reading.attach).toEqual([]);
    expect(reading.possible.map((form) => [form.line, form.locationId])).toEqual([
      ["Coaching — signed 09/02/2026", "loc-0310"],
      ["Verbal corrective action — signed 09/21/2026", "loc-0311"],
    ]);
  });

  it("a draft-only same-name form elsewhere still makes the name ambiguous", async () => {
    const { createInstance } = await import("@/lib/forms/instances");
    await onFile("coaching", "2026-09-02", "Dana Moss", "loc-0310");
    await createInstance({ templateKey: "coaching", variantKey: null, employeeName: "Dana Moss", locationId: "loc-0311", createdBy: "manager-2", source: "ask_sunny", formDate: "2026-09-10" });
    joinOverview();
    const reading = await priorFormsReadingForChat(actor(), "Dana Moss", "loc-0310");
    expect(reading.identity).toBe("other_locations");
    expect(reading.attach).toEqual([]);
  });
});

describe("ambiguous: a first name alone", () => {
  it("is never attached, even at the form's own salon", async () => {
    await onFile("coaching", "2026-09-02", "Dana", "loc-0310");
    const reading = await priorFormsReadingForChat(actor(), "Dana", "loc-0310");
    expect(reading).toMatchObject({ identity: "single_word_name", attach: [] });
    expect(reading.possible).toHaveLength(1);
    expect(await priorFormsForChat(actor(), "Dana")).toEqual([]);
  });
});

describe("who may read the record at all", () => {
  it("an unverified identity reads nothing", async () => {
    await onFile("coaching", "2026-09-02", "Dana Moss", "loc-0310");
    expect(await priorFormsReadingForChat({ ...actor(), verified: false }, "Dana Moss", "loc-0310")).toEqual({ attach: [], possible: [], identity: "none" });
  });

  it("a role without Form Monitoring reads nothing", async () => {
    await onFile("coaching", "2026-09-02", "Dana Moss", "loc-0310");
    expect(await priorFormsReadingForChat({ ...actor(), role: "employee" as never }, "Dana Moss", "loc-0310")).toEqual({ attach: [], possible: [], identity: "none" });
  });
});

describe("dates: only what was received BEFORE this form", () => {
  it("leaves off a form dated after the form being drafted", async () => {
    await onFile("coaching", "2026-09-02", "Dana Moss", "loc-0310");
    await onFile("dpoa", "2026-10-05", "Dana Moss", "loc-0310"); // after today's form (2026-09-29)
    const { id } = await caFor("Dana Moss");
    expect(await priorActionsOn(id)).toBe("Coaching — signed 09/02/2026");
  });
});
