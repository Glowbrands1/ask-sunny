import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope } from "@/types";

/**
 * ============================================================================
 * A LEVEL LEADING INTO "FOR <NAME>" IS THE REQUEST (LEVEL_LEADS_REQUEST_ENABLED)
 * ============================================================================
 *
 * Gate-Sunny-3's probe, via QA (14 Nov 2026), the wording as given (name invented):
 *   "second verbal for <A>, she was late on 11/12/26"
 * got no card at all: no form word ("CA", "warning") and no issuing verb, so it was not read as a request. QA also
 * asked for "another verbal for …" and "2nd written for …". On: each is a Corrective Action request, and the level it
 * opens with is the card's level ("second", "another", "2nd" count the steps). The word after "for" must be able to
 * be a name. The harness is `hr-feedback-oct21-e2e.test.ts`'s (real proposal flow).
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

const requests: { url: string; body: Record<string, unknown> }[] = [];

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
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-14T03:30:00Z"));
  delete process.env.LEVEL_LEADS_REQUEST_ENABLED;
  await ensureTemplateLibrary("system");
});

afterEach(() => {
  delete process.env.LEVEL_LEADS_REQUEST_ENABLED;
});

/** The card the form intake gives one manager turn, or null when the turn is not read as a form request at all. */
async function card(said: string) {
  const message = { id: "m1", role: "user" as const, content: said, createdAt: "2026-11-14T03:30:00Z" };
  const response = await proposeFormForTurn({
    history: [],
    question: said,
    questionMessageId: message.id,
    actor: { role: state.role as never, scope: state.scope as AccessScope },
    summaries: await listTemplateSummaries(),
    today: "2026-11-14",
    policyManual: async () => (state.manual?.chunks as never) ?? null,
  });
  return response?.formProposal ?? null;
}

const ASKED: [string, "verbal" | "written"][] = [
  ["second verbal for pat rivera, she was late on 11/12/26", "verbal"],
  ["another verbal for pat rivera, she was late on 11/12/26", "verbal"],
  ["2nd written for pat rivera, she was late on 11/12/26", "written"],
];

describe('"second verbal for <A>, she was late on 11/12/26" (Gate-Sunny-3 via QA, 14 Nov 2026)', () => {
  it("flag off: no card, as before (the bug)", async () => {
    expect(await card(ASKED[0]![0])).toBeNull();
  });

  for (const [said, level] of ASKED) {
    it(`flag on: "${said}" is a Corrective Action card for Pat Rivera, ${level}`, async () => {
      process.env.LEVEL_LEADS_REQUEST_ENABLED = "true";
      const proposal = await card(said);
      expect(proposal).toMatchObject({ templateKey: "dpoa", employeeName: "Pat Rivera", warningLevel: level, formDate: "2026-11-12" });
    });
  }

  it("flag on: a level leading into a topic, not a person, is still no request", async () => {
    process.env.LEVEL_LEADS_REQUEST_ENABLED = "true";
    expect(await card("verbal for the late opening")).toBeNull();
  });

  it("flag on: an earlier level in the middle of an account is history, not this form's level", async () => {
    process.env.LEVEL_LEADS_REQUEST_ENABLED = "true";
    const proposal = await card("create a ca for pat rivera, she had a verbal for being late last month and was late again on 11/12/26");
    expect(proposal?.templateKey).toBe("dpoa");
    expect(proposal?.warningLevel ?? null).toBeNull();
  });
});
