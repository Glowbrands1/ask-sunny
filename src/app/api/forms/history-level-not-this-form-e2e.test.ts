import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope } from "@/types";

/**
 * ============================================================================
 * AN EARLIER WARNING IS HISTORY, NOT THIS FORM'S LEVEL (HISTORY_LEVEL_NOT_THIS_FORM_ENABLED)
 * ============================================================================
 *
 * QA, 14 Nov 2026 (priority; found while porting LEVEL_LEADS_REQUEST): Ask Sunny read
 *   "verbal warning on 9/21. late again for 30 mins today"            as Verbal
 *   "written warning for the same thing, now late today"              as Written
 * for THIS form; Ask Bubbles' reader has read both as history since 9 Oct 2026. The audit's three "climbed a rung"
 * shapes (an earlier verbal, the model's Written) are covered here too. On: a level with its own date on another day,
 * or "for the same thing / that / it", is a step on file, unless a request verb in the sentence asks for it.
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
  await ensureTemplateLibrary("system");
});

afterEach(() => {
  delete process.env.HISTORY_LEVEL_NOT_THIS_FORM_ENABLED;
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

/** The card the form intake gives one manager turn, or null when the turn is not read as a form request at all. */
async function card(said: string, today = "2026-11-14") {
  return (await reply(said, today))?.formProposal ?? null;
}

const ON = () => {
  process.env.HISTORY_LEVEL_NOT_THIS_FORM_ENABLED = "true";
};

describe("QA, 14 Nov 2026: an earlier warning is not this form's level", () => {
  it('flag off: "verbal warning on 9/21. late again for 30 mins today" makes the card Verbal (the bug)', async () => {
    expect((await card("make a ca for pat rivera. verbal warning on 9/21. late again for 30 mins today"))?.warningLevel).toBe("verbal");
  });

  for (const said of [
    "make a ca for pat rivera. verbal warning on 9/21. late again for 30 mins today",
    "make a ca for pat rivera. written warning for the same thing, now late today",
    // The audit's "climbed a rung" shapes: an earlier verbal is history.
    "make a ca for pat rivera, late again 30 mins today. she got a verbal warning on 10/21",
    "pat rivera left the register unlocked again tonight, she already had a verbal last month. create a ca",
    "create a corrective action for pat rivera for no call no show on 11/12/26. previous verbal 9/30/26",
    // No other day in the turn, and the level does not open it: weighed against today (Ask Bubbles' review phrasing).
    "make a ca for pat rivera. she gets a written warning 10/1",
  ]) {
    it(`flag on: "${said}" states no level for this form`, async () => {
      ON();
      const proposal = await card(said);
      expect(proposal?.templateKey).toBe("dpoa");
      expect(proposal?.warningLevel ?? null).toBeNull();
    });
  }
});

describe("flag on: a level the manager asks for keeps its level, dated or not", () => {
  for (const [said, level] of [
    ["create a verbal ca on 11/12/26 for pat rivera, she was late", "verbal"],
    ["written ca for pat rivera for not doing the sanitation on 11/12/26", "written"],
    ["verbal warning for pat rivera, late today", "verbal"],
  ] as const) {
    it(`"${said}" is ${level}`, async () => {
      ON();
      expect((await card(said))?.warningLevel).toBe(level);
    });
  }
});

/*
 * QA's rulings on Gate-Sunny-3's findings on #970 (14 Nov 2026), in the gate's wordings, the person invented.
 */
describe("Gate-Sunny-3 on #970, flag on", () => {
  const ASKED = "You'll set the verbal/written warning level on the form";

  it('F1: "verbal warning on 11/12/26 for pat rivera, she was late that day", filed the next day, is this form\'s level', async () => {
    ON();
    vi.setSystemTime(new Date("2026-11-13T18:00:00Z"));
    try {
      expect((await card("verbal warning on 11/12/26 for pat rivera, she was late that day", "2026-11-13"))?.warningLevel).toBe("verbal");
    } finally {
      vi.useRealTimers();
    }
  });

  it('F2 and F3: "ca for pat rivera, verbal warning on 9/21. late again for 30 mins today" lists the verbal under Prior actions and leaves the level unset', async () => {
    ON();
    vi.setSystemTime(new Date("2026-11-13T18:00:00Z"));
    try {
      const answer = await reply("ca for pat rivera, verbal warning on 9/21. late again for 30 mins today", "2026-11-13");
      expect(answer?.formProposal?.warningLevel ?? null).toBeNull();
      expect(answer?.content).toMatch(/\*\*Prior actions:\*\* Verbal warning — (?:signed )?09\/21\/2026/);
      expect(answer?.content).toContain(ASKED);
    } finally {
      vi.useRealTimers();
    }
  });

  it('as "ca for pat rivera, she had a verbal on 10/30. late again for 30 mins today" already does', async () => {
    ON();
    const answer = await reply("ca for pat rivera, she had a verbal on 10/30. late again for 30 mins today", "2026-11-13");
    expect(answer?.formProposal?.warningLevel ?? null).toBeNull();
    expect(answer?.content).toMatch(/\*\*Prior actions:\*\* Verbal warning — (?:signed )?10\/30\/2026/);
    expect(answer?.content).toContain(ASKED);
  });
});
