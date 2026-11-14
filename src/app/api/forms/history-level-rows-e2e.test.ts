import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope } from "@/types";

/**
 * ============================================================================
 * THE PRIOR ACTIONS ROWS A MANAGER'S DATED HISTORY GIVES (HISTORY_LEVEL_ROWS_ENABLED)
 * ============================================================================
 *
 * QA's follow-ups to both gates on Ask Sunny #970 and Ask Bubbles #898 (14 Nov 2026): every dated earlier level is a
 * row, "her first verbal was 9/21" is one, an identical row is listed once, and a level dated on the incident's own day
 * is this form's level and not a row as well.
 * The harness is `hr-feedback-oct21-e2e.test.ts`'s (real proposal flow). Every person is invented.
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
  delete process.env.HISTORY_LEVEL_NOT_THIS_FORM_ENABLED;
  delete process.env.HISTORY_LEVEL_ROWS_ENABLED;
  await ensureTemplateLibrary("system");
});

afterEach(() => {
  delete process.env.HISTORY_LEVEL_NOT_THIS_FORM_ENABLED;
  delete process.env.HISTORY_LEVEL_ROWS_ENABLED;
});

/** The reply the form intake gives one manager turn, on the business day `today`. */
async function reply(said: string, today = "2026-11-14") {
  const message = { id: "m1", role: "user" as const, content: said, createdAt: `${today}T15:30:00Z` };
  return proposeFormForTurn({
    history: [],
    question: said,
    questionMessageId: message.id,
    actor: { role: state.role as never, scope: state.scope as AccessScope },
    summaries: await listTemplateSummaries(),
    today,
    policyManual: async () => (state.manual?.chunks as never) ?? null,
  });
}


const ON = () => {
  process.env.HISTORY_LEVEL_NOT_THIS_FORM_ENABLED = "true";
};

const ROWS = () => {
  process.env.HISTORY_LEVEL_ROWS_ENABLED = "true";
};

/** The rows the card reads back under Prior actions, in order. */
function priorRows(content: string | undefined): string[] {
  const line = /\*\*Prior actions:\*\* (.*?), as you said\./.exec(content ?? "")?.[1];
  return line ? line.split("; ") : [];
}

/*
 * QA's follow-ups to both gates on #970 / Ask Bubbles #898 (14 Nov 2026), in QA's wordings, the person invented.
 * HISTORY_LEVEL_NOT_THIS_FORM on throughout (these build on it).
 */
describe("QA's follow-ups: the Prior actions rows a manager's dated history gives", () => {
  it('(1) "verbal warning on 9/21, written warning on 10/15. late again today" lists both', async () => {
    ON();
    ROWS();
    const rows = priorRows((await reply("ca for pat rivera, verbal warning on 9/21, written warning on 10/15. late again today", "2026-11-13"))?.content);
    expect(rows).toEqual(["Verbal warning — signed 09/21/2026", "Written warning — signed 10/15/2026"]);
  });

  const FIRST = "ca for pat rivera, late again today. her first verbal was 9/21";
  it(`(2) flag off: "${FIRST}" lists no row (the bug)`, async () => {
    ON();
    expect(priorRows((await reply(FIRST, "2026-11-13"))?.content)).toEqual([]);
  });
  it(`(2) "${FIRST}" lists the verbal with its date`, async () => {
    ON();
    ROWS();
    expect(priorRows((await reply(FIRST, "2026-11-13"))?.content)).toEqual(["Verbal warning — signed 09/21/2026"]);
  });

  const TWICE = "ca for pat rivera, late again today. she had a verbal on 9/21, verbal warning on 9/21";
  it(`(3) flag off: "${TWICE}" lists the same row twice (the bug)`, async () => {
    ON();
    expect(priorRows((await reply(TWICE, "2026-11-13"))?.content)).toHaveLength(2);
  });
  it(`(3) "${TWICE}" lists it once`, async () => {
    ON();
    ROWS();
    expect(priorRows((await reply(TWICE, "2026-11-13"))?.content)).toEqual(["Verbal warning — signed 09/21/2026"]);
  });

  const SAME_DAY = "pat rivera was late on 11/12/26, verbal warning 11/12/26";
  it(`(4) flag off: "${SAME_DAY}" is Verbal and also a Prior row (the bug)`, async () => {
    ON();
    const answer = await reply(SAME_DAY, "2026-11-13");
    expect(answer?.formProposal?.warningLevel).toBe("verbal");
    expect(priorRows(answer?.content)).toEqual(["Verbal warning — signed 11/12/2026"]);
  });
  it(`(4) "${SAME_DAY}" is Verbal, and no Prior row`, async () => {
    ON();
    ROWS();
    const answer = await reply(SAME_DAY, "2026-11-13");
    expect(answer?.formProposal?.warningLevel).toBe("verbal");
    expect(priorRows(answer?.content)).toEqual([]);
  });
});
