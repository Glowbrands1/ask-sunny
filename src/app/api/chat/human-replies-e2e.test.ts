import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * HUMAN REPLIES — A FORM CHAT SAYS ITS OPENER ONCE (OWNER, 26 OCT 2026)
 * ============================================================================
 *
 * The owner's rule: "humanize it". The Sunny tester's production chats (real
 * register, invented names) re-posted the same long opener after every
 * manager message of a form chat:
 *
 *   "I'll draft a Corrective Action Form for <name> from what you've
 *    described, and check the applicable company policy before anything
 *    policy-related goes on it."
 *   "Here is what I would put on a Coaching Form. Everything I need is here,
 *    drawn from your messages above. I have the employee and the salon."
 *
 * With HUMAN_REPLIES_ENABLED the first card turn is as built; every later
 * turn for the same form and employee says what changed in one line ("Got it
 * — the date's 10/14."), leaves out what the manager already read, keeps
 * every question, and says "Nothing's saved until you tap **Create draft**."
 * The card itself is the same with the flag on or off.
 *
 * Every turn goes through POST /api/chat, in all lowercase and in sentence
 * case, the way managers type. Faked: identity, the database (in memory), the
 * directory, the models, analytics. Synthetic names.
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
      if (!hasPermission(DEFAULT_PERMISSION_MATRIX, "district_manager" as never, permission as never)) {
        throw new AuthError("forbidden", "Your role does not have permission to do that.");
      }
      return {
        identity: {
          subject: "qa-manager",
          email: "qa-manager@example.test",
          displayName: "QA Manager",
          role: "district_manager",
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

const TODAY = "2026-10-25";

/** The production profile (20120d7): intent extraction on, the full remap off. */
const PRODUCTION = [
  "INTENT_EXTRACTION_ENABLED",
  "QUERY_REWRITE_ENABLED",
  "GROUNDED_ENTITIES_ENABLED",
  "TYPED_NAME_PROCEEDS_ENABLED",
  "FEWSHOT_EXAMPLES_ENABLED",
  "SLOT_RETENTION_ENABLED",
  "FIELD_ACCURACY_ENABLED",
  "LONG_CONTEXT_ENABLED",
  "POLICY_CITATION_ENABLED",
  "SECOND_FORM_ENABLED",
  "GLOBAL_SALON_ASK_ENABLED",
  "DRAFT_MERGE_ENABLED",
] as const;

/** The integration bundle's flags (b44c540), default off, turned on together. */
const BUNDLE = [
  "PLACE_SPAN_GUARD_ENABLED",
  "MANAGER_WORDS_ONLY_ENABLED",
  "CONVERSATION_DRAFT_REUSE_ENABLED",
  "DRAFT_ACTIONS_ENABLED",
  "LATE_OPEN_DATE_ENABLED",
  "CA_TEMPLATE_MAP_ENABLED",
  "FORM_CHOICE_STATED_ENABLED",
  "REMAP_INCIDENT_FIX_ENABLED",
  "PRIOR_ACTIONS_PARSE_ENABLED",
  "KEEP_FORM_EMPLOYEE_ENABLED",
  "TITLE_WHOLE_WORD_ENABLED",
  "NOT_A_NAME_GUARD_ENABLED",
  "WARNING_LEVEL_MANAGER_ONLY_ENABLED",
  "INTENT_PAYROLL_MANAGER_ONLY_ENABLED",
] as const;

const PROFILES: readonly (readonly [string, readonly string[]])[] = [
  ["production flags", PRODUCTION],
  ["production flags + the bundle's flags", [...PRODUCTION, ...BUNDLE]],
];

/** This change's flag, default off. */
const FLAG = "HUMAN_REPLIES_ENABLED";

const ALL_FLAGS = [...PRODUCTION, ...BUNDLE, FLAG];

type Answer = {
  content: string;
  formProposal?: ChatFormProposal;
  formSelection?: unknown;
  formOpened?: { instanceId: string };
  formUpdate?: { instanceId: string; updated: string[] };
};

/** The thread as the browser holds it: a card the answer carried stays open. */
class Thread {
  readonly messages: ChatMessage[] = [];
  proposal: ChatFormProposal | null = null;
  instanceId: string | null = null;
  private sequence = 0;
  private readonly conversationId = `conv-${randomUUID()}`;

  replay(question: string, answer: string) {
    const id = `m${(this.sequence += 1)}`;
    this.messages.push(
      { id, role: "user", content: question, createdAt: `${TODAY}T12:27:20Z` } as ChatMessage,
      { id: `a${this.sequence}`, role: "assistant", content: answer, createdAt: `${TODAY}T12:27:33Z` } as ChatMessage,
    );
  }

  async say(question: string): Promise<Answer> {
    const history = this.messages.map(({ id, role, content }) => ({ id, role, content }));
    const id = `m${(this.sequence += 1)}`;
    const response = await chatRoute.POST(
      new Request("https://app.test/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question,
          mode: "standard",
          history,
          questionMessageId: id,
          conversationId: this.conversationId,
          ...(this.proposal && !this.instanceId ? { continueProposalTemplateKey: this.proposal.templateKey } : {}),
          ...(this.instanceId ? { activeFormInstanceId: this.instanceId } : {}),
        }),
      }),
    );
    const payload = (await response.json()) as Answer & { error?: string };
    expect(response.status, JSON.stringify(payload)).toBe(200);
    this.messages.push(
      { id, role: "user", content: question, createdAt: `${TODAY}T12:28:00Z` } as ChatMessage,
      {
        id: `a${this.sequence}`,
        role: "assistant",
        content: payload.content,
        createdAt: `${TODAY}T12:28:01Z`,
        ...(payload.formProposal ? { formProposal: payload.formProposal } : {}),
      } as ChatMessage,
    );
    if (payload.formProposal) this.proposal = payload.formProposal;
    return payload;
  }
}

const saved = new Map<string, string | undefined>();

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  state.slotReading = "none";
  state.draft = { values: {} };
  state.revision = { values: {} };
  state.revisionCalls = 0;
  state.chatModelCalls = 0;
  state.directory = [
    { id: "e-1", firstName: "Avery", lastName: "Testperson", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0468"] },
  ];
  for (const name of ALL_FLAGS) saved.set(name, process.env[name]);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:30:00Z`));
  await ensureTemplateLibrary("system");
});

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.useRealTimers();
});

function useProfile(flags: readonly string[], fix = true) {
  for (const name of ALL_FLAGS) delete process.env[name];
  for (const name of flags) process.env[name] = "true";
  if (fix) process.env[FLAG] = "true";
}

const CA_OPENER =
  "I'll draft a **Corrective Action Form** for **Avery Testperson** from what you've described, and check the applicable company policy before anything policy-related goes on it.";
const COACHING_OPENER = "Here is what I would put on a **Coaching Form**.";
const LONG_NOTICE = "nothing is saved to anyone's file until you do.";
const SHORT_NOTICE = "Nothing's saved until you tap **Create draft**.";

/** The card without its random id: the same with the flag on or off. */
function card(proposal: ChatFormProposal | undefined) {
  return proposal ? { ...proposal, proposalId: "" } : proposal;
}

function count(text: string, part: string): number {
  return text.split(part).length - 1;
}

async function run(turns: readonly string[]): Promise<Answer[]> {
  const thread = new Thread();
  const answers: Answer[] = [];
  for (const turn of turns) answers.push(await thread.say(turn));
  return answers;
}

/** Each chat in all lowercase and in sentence case, the way managers type. */
function typed(turns: readonly string[]): [string, readonly string[]][] {
  const sentence = (turn: string) => turn.charAt(0).toUpperCase() + turn.slice(1);
  return [
    ["lowercase", turns.map((turn) => turn.toLowerCase())],
    ["sentence case", turns.map(sentence)],
  ];
}

const CA_CHAT = ["create verbal CA for Avery Testperson, late opening the salon today", "no deduct", "date is 10/14", "change it to written"];
const COACHING_CHAT = ["coaching form for Avery Testperson, skipped a tour today", "date 10/14"];

describe.each(PROFILES)("(1) the opener is said once (%s)", (_label, flags) => {
  describe.each(typed(CA_CHAT))("Corrective Action, %s", (_case, turns) => {
    it("turn 1 is as built; each later turn says what changed; the card is the same", async () => {
      useProfile(flags, false);
      const before = await run(turns);
      useProfile(flags, true);
      const after = await run(turns);

      // Before: the opener and the long notice on every turn.
      for (const reply of before) {
        expect(reply.content.startsWith(CA_OPENER), reply.content).toBe(true);
        expect(reply.content).toContain(LONG_NOTICE);
      }

      // After: turn 1 is unchanged, and the opener is said once in the chat.
      expect(after[0]!.content).toBe(before[0]!.content);
      const chat = after.map((reply) => reply.content).join("\n\n");
      expect(count(chat, CA_OPENER)).toBe(1);
      expect(count(chat, LONG_NOTICE)).toBe(1);
      expect(after[1]!.content.split("\n")[0]).toBe("Got it — no payroll deduct.");
      expect(after[2]!.content.split("\n")[0]).toBe("Got it — the date's 10/14.");
      expect(after[3]!.content.split("\n")[0]).toBe("Got it — it's a written warning.");
      for (const reply of after.slice(1)) {
        expect(reply.content).toContain(SHORT_NOTICE);
        // (2) Answered, so not asked again, and not read back again either.
        expect(reply.content).not.toContain("I won't answer it for you");
      }
      expect(after[2]!.content).not.toContain("Is payroll deduct applicable?");
      expect(after[3]!.content).not.toContain("Is payroll deduct applicable?");
      // The policy line is read once, on the first card.
      expect(count(chat, "**Policy:** Late Opening")).toBe(1);

      // The card itself does not change.
      after.forEach((reply, index) => expect(card(reply.formProposal)).toEqual(card(before[index]!.formProposal)));
    });
  });

  describe.each(typed(COACHING_CHAT))("Coaching, %s", (_case, turns) => {
    it("the coaching opener and \"Everything I need is here\" are said once", async () => {
      useProfile(flags, false);
      const before = await run(turns);
      useProfile(flags, true);
      const after = await run(turns);

      expect(before[1]!.content.startsWith(COACHING_OPENER)).toBe(true);
      expect(before[1]!.content).toContain("Everything I need is here, drawn from your messages above.");

      expect(after[0]!.content).toBe(before[0]!.content);
      expect(after[1]!.content.split("\n")[0]).toBe("Got it — the date's 10/14.");
      expect(after[1]!.content).not.toContain(COACHING_OPENER);
      expect(after[1]!.content).not.toContain("Everything I need is here");
      expect(after[1]!.content).toContain(SHORT_NOTICE);
      after.forEach((reply, index) => expect(card(reply.formProposal)).toEqual(card(before[index]!.formProposal)));
    });
  });
});
