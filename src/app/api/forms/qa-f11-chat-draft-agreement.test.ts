import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * QA F-11 FOLLOW-UP, 22 OCT 2026 — CHAT, DRAFT AND SAVED FORM AGREE
 * ============================================================================
 *
 * The chat now reads the record with the proposal's own salon, the input the
 * draft route classifies with. So the lines the chat calls "on file" are
 * exactly the lines the draft writes into prior_actions, and a possible match
 * (same name, identity not established) is shown — with its salon — and is
 * never written as a verified prior action. Synthetic people only.
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
const { priorFormsReadingForChat } = await import("@/lib/forms/prior-forms");
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
async function caFor(name: string, second = "verbal, payroll deduct no.", where = "", pickedSalon?: string) {
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
      priorFormsOnFile: (employeeName, locationId) => priorFormsReadingForChat(actor(), employeeName, locationId),
      ...(proposal ? { continueTemplateKey: proposal.templateKey } : {}),
    });
    expect(response?.formProposal, text).toBeDefined();
    proposal = response!.formProposal!;
    content = response!.content;
    messages.push(message, { id: `a${sequence}`, role: "assistant", content, createdAt: "2026-09-29T15:00:01Z", formProposal: proposal } as ChatMessage);
  }
  const result = await createInlineForm({ proposal: pickedSalon ? { ...proposal!, locationId: pickedSalon } : proposal!, messages: messages.filter((m) => m.role === "user"), call, onCreated: () => {} });
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


/** The lines the chat promised under "On file …", in order. */
const promised = (content: string) => /\*\*On file in Form Monitoring for [^:]+:\*\* (.+?)\. I'll list/.exec(content)?.[1].split("; ") ?? [];
/** The lines the chat showed as possible matches (with their salon). */
const possibleShown = (content: string) => /\*\*Possibly on file — not added:\*\* (.+?)\. (?:The same name|This form|Only a first|The record)/.exec(content)?.[1].split("; ") ?? [];
const saved = async (id: string) => (await priorActionsOn(id))?.split("\n") ?? [];

describe("verified: what the chat promises is exactly what is saved", () => {
  it("one Dana Moss, on file only at this salon", async () => {
    await onFile("coaching", "2026-09-02", "Dana Moss", "loc-0310");
    await onFile("dpoa", "2026-09-21", "Dana Moss", "loc-0310");
    const { content, id } = await caFor("Dana Moss");
    expect(promised(content)).toEqual(["Coaching — signed 09/02/2026", "Verbal corrective action — signed 09/21/2026"]);
    expect(possibleShown(content)).toEqual([]);
    expect(await saved(id)).toEqual(promised(content));
  });
});

describe("possible matches: shown with their salon, never saved as verified prior actions", () => {
  beforeEach(() => {
    state.scope = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: ["loc-0311"] };
  });

  it("the same name at another salon the manager can see", async () => {
    await onFile("coaching", "2026-09-02", "Dana Moss", "loc-0310");
    await onFile("dpoa", "2026-09-21", "Dana Moss", "loc-0311");
    const { content, id } = await caFor("Dana Moss", "verbal, payroll deduct no.", " at lincoln 27th street");
    expect(promised(content)).toEqual([]);
    expect(possibleShown(content)).toEqual([
      "Coaching — signed 09/02/2026 (NE Lincoln 27th Street)",
      "Verbal corrective action — signed 09/21/2026 (NE Lincoln O Street)",
    ]);
    expect(content).toMatch(/The same name is on file at more than one salon/);
    expect(content).toMatch(/so I won't put them on the form/);
    // The history question is still asked: nothing was verified.
    expect(content).toMatch(/any prior coaching or corrective action/);
    expect(await saved(id)).toEqual([]);
  });

  it("only a first name", async () => {
    await onFile("coaching", "2026-09-02", "Dana Moss", "loc-0310");
    const { content, id } = await caFor("Dana", "verbal, payroll deduct no.", " at lincoln 27th street");
    expect(promised(content)).toEqual([]);
    expect(await saved(id)).toEqual([]);
  });

  it("no salon on the form yet: nothing is promised; the rule is stated; the saved form follows it", async () => {
    await onFile("coaching", "2026-09-02", "Dana Moss", "loc-0310");
    const { content, proposal, id } = await caFor("Dana Moss", "verbal, payroll deduct no.", "", "loc-0310");
    expect(proposal.locationId).toBeNull();
    expect(promised(content)).toEqual([]);
    expect(possibleShown(content)).toEqual(["Coaching — signed 09/02/2026 (NE Lincoln 27th Street)"]);
    expect(content).toMatch(/added only when they're at the form's own salon/);
    // Filed at that salon, with no same name elsewhere: the record is unambiguous there.
    expect(await saved(id)).toEqual(["Coaching — signed 09/02/2026"]);
  });

  it("no salon on the form yet, filed at the OTHER salon: nothing is saved", async () => {
    await onFile("coaching", "2026-09-02", "Dana Moss", "loc-0310");
    const { content, id } = await caFor("Dana Moss", "verbal, payroll deduct no.", "", "loc-0311");
    expect(possibleShown(content)).toEqual(["Coaching — signed 09/02/2026 (NE Lincoln 27th Street)"]);
    expect(await saved(id)).toEqual([]);
  });
});
