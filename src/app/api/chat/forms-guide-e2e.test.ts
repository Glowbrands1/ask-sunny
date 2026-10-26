import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";
import type { AccessScope, ChatFormProposal } from "@/types";

/**
 * ============================================================================
 * THE FORMS GUIDE THROUGH POST /api/chat (FORMS_GUIDE_ENABLED)
 * ============================================================================
 *
 * The owner: "Read the forms and that should be the answer." With the flag
 * on, "what is a ca?" is the Corrective Action Form as the published template
 * describes it — never a knowledge-base miss, never the model — and "which
 * forms can i create here?" is the role's exact list. Edit the template row
 * and the answer changes. "ca for <name>" still starts the form. With the
 * flag off the same turns are answered exactly as before.
 *
 * Faked: identity (role per test), the database (in memory, seeded by
 * `ensureTemplateLibrary`), the models, analytics. Synthetic names.
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
  slotReading: "none" as "none" | "ca",
  draft: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown> },
  revision: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown>; clear?: string[] },
  revisionCalls: 0,
  chatModelCalls: 0,
  directory: [] as unknown[],
  role: "salon_director" as string,
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

vi.mock("@/lib/config/server-env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config/server-env")>();
  return { ...actual, liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }) };
});

vi.mock("@/lib/auth/server", async () => {
  const { DEFAULT_PERMISSION_MATRIX, hasPermission } = await import("@/lib/permissions");
  const { AuthError } = await import("@/lib/auth/types");
  return {
    authorizeRequest: async (_request: Request, permission: string) => {
      if (!hasPermission(DEFAULT_PERMISSION_MATRIX, state.role as never, permission as never)) {
        throw new AuthError("forbidden", "Your role does not have permission to do that.");
      }
      return {
        identity: {
          subject: "qa-manager",
          email: "qa-manager@example.test",
          displayName: "QA Manager",
          role: state.role,
          scope: { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] },
          verified: true,
        },
        permission,
        provider: "supabase",
      };
    },
  };
});

vi.mock("@/lib/analytics/record", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics/record")>()),
  openTurn: async () => "turn-qa",
  closeTurn: async () => {},
  recordActivity: async () => {},
  recordActivityAsync: () => {},
}));

const ANSWER = "A grounded answer from the policy manual.";

vi.mock("@/lib/ai/call-claude", () => ({
  callClaude: async () => {
    state.chatModelCalls += 1;
    return ANSWER;
  },
  callClaudeTool: async (input: { tool?: { name?: string } }) => {
    if (input.tool?.name !== "record_intent_slots") return null;
    return {
      employee: null,
      salon: null,
      title: null,
      incidentType: null,
      incidentDate: null,
      payrollAmount: null,
      warningLevel: null,
      formType: state.slotReading === "ca" ? "Corrective Action Form" : null,
      formTurn: state.slotReading === "ca",
      policyHeading: null,
    };
  },
}));

vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (request: { tool_choice?: { name?: string } }) => {
        const revising = request.tool_choice?.name === "revise_form_fields";
        if (revising) state.revisionCalls += 1;
        return {
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              name: revising ? "revise_form_fields" : "write_form_fields",
              input: revising ? state.revision : state.draft,
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
    async match() {
      return [];
    }
    async fetchRoleGrounding(role: { id: string }) {
      return {
        ok: true,
        grounding: {
          role: { id: role.id },
          documentId: "doc-progression",
          documentTitle: "PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
          matchedBy: "tag",
          rows: [
            {
              chunk_id: "pmf-0",
              document_id: "doc-progression",
              document_title: "PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
              category: "leadership_coaching",
              locator: "SECTION 2",
              page: null,
              section: null,
              content: "Solve the issue at the lowest appropriate level.",
              similarity: 0,
            },
          ],
          presentGroups: ["escalation_ladder"],
        },
      };
    }
    async fetchOfficialPolicyManual() {
      return {
        ok: true,
        documentId: "doc-manual",
        documentTitle: "2025 JBA Policy Manual - Edited 5-2025",
        documentCategory: "policies_compliance",
        matchedBy: "tag",
        chunks: JBA_MANUAL_CA_CHUNKS,
      };
    }
  },
}));

vi.mock("@/lib/knowledge", () => ({
  getKnowledgeProvider: () => {
    throw new Error("getKnowledgeProvider() is the browser knowledge client and must not be used on the server");
  },
}));

vi.mock("@/lib/reporting/read/report-briefing", () => ({ loadReportBriefing: async () => null }));
vi.mock("@/lib/reporting/read/employee-facts", () => ({
  loadEmployeeFacts: async () => null,
  NO_EMPLOYEE_DATA_REASON: "no dataset",
  NO_EMPLOYEE_DATASET_REASON: "no dataset",
  EMPLOYEE_DATA_HEADING: "CURRENT EMPLOYEE PERFORMANCE DATA",
}));

vi.mock("@/lib/forms/employee-roster", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/forms/employee-roster")>();
  return {
    ...actual,
    readDirectoryFacts: async () => [],
    loadScopedRoster: async (scope: AccessScope | null) => actual.scopeRoster(state.directory as never, scope),
  };
});

vi.mock("@/lib/forms/prior-forms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/forms/prior-forms")>()),
  priorFormsReadingForChat: async () => ({ attach: [], possible: [], identity: "none" }),
}));

process.env.NEXT_PUBLIC_DEMO_MODE = "false";

vi.setConfig({ hookTimeout: 30_000, testTimeout: 30_000 });

const { ensureTemplateLibrary } = await import("@/lib/forms/repository");
const chatRoute = await import("./route");

type Answer = { content: string; formProposal?: ChatFormProposal; formSelection?: unknown; citations: unknown[] };

async function say(question: string): Promise<Answer> {
  const response = await chatRoute.POST(
    new Request("https://app.test/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question,
        mode: "standard",
        history: [],
        questionMessageId: "m1",
        conversationId: "conv-forms-guide",
      }),
    }),
  );
  const payload = (await response.json()) as Answer & { error?: string };
  expect(response.status, JSON.stringify(payload)).toBe(200);
  return payload;
}

const FLAG = "FORMS_GUIDE_ENABLED";
let saved: string | undefined;

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  state.role = "salon_director";
  state.chatModelCalls = 0;
  state.slotReading = "none";
  state.directory = [
    { id: "e-1", firstName: "Avery", lastName: "Holt", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0468"] },
  ];
  saved = process.env[FLAG];
  process.env[FLAG] = "true";
  await ensureTemplateLibrary("system");
});

afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
});

function templateRow(key: string) {
  return (store.form_templates ?? []).find((row) => row.key === key)!;
}

describe("flag on: the answer is the published template", () => {
  it.each(["what is a ca?", "What is a ca?"])("%s explains the Corrective Action Form, not the model", async (wording) => {
    const reply = await say(wording);
    expect(reply.content).toContain("**Corrective Action Form** — ");
    expect(reply.content).toContain(String(templateRow("dpoa").description));
    expect(reply.content).not.toContain(ANSWER);
    expect(state.chatModelCalls).toBe(0);
    expect(reply.formProposal).toBeUndefined();
    expect(reply.formSelection).toBeUndefined();
  });

  it("editing the template row's description changes the answer", async () => {
    templateRow("dpoa").description = "Fixture wording from the database row.";
    const reply = await say("what is a ca?");
    expect(reply.content).toContain("**Corrective Action Form** — Fixture wording from the database row.");
  });

  it.each(["difference between coaching and ca", "Difference between coaching and ca"])(
    "%s explains both side by side",
    async (wording) => {
      const reply = await say(wording);
      expect(reply.content).toContain("**Coaching Form** — ");
      expect(reply.content).toContain("**Corrective Action Form** — ");
      expect(reply.formProposal).toBeUndefined();
    },
  );

  it.each(["which forms can i create here?", "Which forms can i create here?"])(
    "%s is the role's exact list",
    async (wording) => {
      const reply = await say(wording);
      expect(reply.content).toContain("As a Salon Director you can create these 11 forms in Ask Sunny:");
      expect(reply.content).toContain("- Corrective Action Form");
      expect(reply.content).not.toContain("- SDIT EPP");
    },
  );

  it("an Employee is told what a CA is and that they cannot create one", async () => {
    state.role = "employee";
    const reply = await say("what is a ca?");
    expect(reply.content).toContain("**Corrective Action Form** — ");
    expect(reply.content).toContain("Your role (Employee) can't create this one; your Salon Director can.");
  });

  it("an Assistant Salon Director can create no forms", async () => {
    state.role = "assistant_salon_director";
    const reply = await say("which forms can i create here?");
    expect(reply.content).toContain("Your role (Assistant Salon Director) can't create forms in Ask Sunny.");
  });

  it("Could this break: \"ca for Avery Holt\" still starts the form, not the guide", async () => {
    const reply = await say("ca for Avery Holt");
    expect(reply.content).not.toContain("Who can create it:");
    expect(reply.formProposal?.templateKey ?? reply.content).toMatch(/dpoa|Corrective Action/);
  });

  it("Could this break: \"what is the ca for california sales tax\" goes to the knowledge answer", async () => {
    const reply = await say("what is the ca for california sales tax");
    expect(reply.content).not.toContain("Who can create it:");
  });
});

describe("flag off: answered exactly as before", () => {
  it("what is a ca? does not use the guide", async () => {
    delete process.env[FLAG];
    const reply = await say("what is a ca?");
    expect(reply.content).not.toContain("Who can create it:");
  });
});

/* NEVER-BREAK (owner's order via QA, 26 Oct 2026), with the flag on. */
describe("NEVER-BREAK with the flag on", () => {
  it.each(["what is the exit process?", "What is the exit process?"])("%s is the knowledge answer", async (wording) => {
    const reply = await say(wording);
    expect(reply.content).toContain(ANSWER);
    expect(reply.content).not.toContain("Who can create it:");
  });

  it.each(["ca Avery Holt late today", "Ca Avery Holt late today", "coach Avery Holt", "Coach Avery Holt", "exit Avery Holt", "Exit Avery Holt"])(
    "%s is a form command, never the guide",
    async (wording) => {
      const reply = await say(wording);
      expect(reply.content).not.toContain("Who can create it:");
      expect(reply.content).not.toContain("isn't a form available in");
      expect(reply.content).not.toMatch(/you can create these \d+ forms/);
    },
  );
});
