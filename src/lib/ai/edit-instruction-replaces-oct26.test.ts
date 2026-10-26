import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { correctiveActionDocument } from "@/lib/forms/library";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * EDIT_INSTRUCTION_REPLACES_ENABLED (QA, 26 Oct 2026; production chats in
 * both apps): "change observation of offense to: <text>" was taken as
 * content. On the live intent path the Observation became the whole chat
 * with the instruction in it; on the remap path What happened became the
 * intent read's own state line. It must be exactly <text>, with the Employee
 * kept. Through `answerQuestion`, on both paths, with FORM_EDIT_DATE_RULES
 * off (the flag carries only its What happened half).
 *
 * The harness is remap-incident-oct24.test.ts's. The models are stand-ins
 * that copy the manager's words; the people are invented. Every wording runs
 * all lowercase and in sentence case.
 */

const TODAY = "2026-10-24";
const SCOPE: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

/** The replay's flags-on set for the intent path (priority-replay.test.ts). */
const INTENT_FLAGS = [
  "INTENT_EXTRACTION_ENABLED",
  "GROUNDED_ENTITIES_ENABLED",
  "DRAFT_MERGE_ENABLED",
  "ACTION_PLAN_SENTENCES_ENABLED",
  "TYPED_NAME_PROCEEDS_ENABLED",
  "ATTENDANCE_POLICY_CITATION_ENABLED",
  "POLICY_PAGE_REQUIRED_ENABLED",
  "MANAGER_PAYROLL_AMOUNT_ONLY_ENABLED",
  "POLICY_GATE_NONBLOCKING_ENABLED",
  "MANUAL_SECTION_DEDUPE_ENABLED",
  "PRINTED_PAGE_CITATION_ENABLED",
  "PAYROLL_AMOUNT_FIELD_ENABLED",
  "CODE_SLOTS_ENABLED",
  "GLOBAL_SALON_ASK_ENABLED",
  "INTENT_PAYROLL_MANAGER_ONLY_ENABLED",
] as const;
const REMAP_FLAGS = ["FORM_FULL_REMAP_ENABLED", "REMAP_INCIDENT_FIX_ENABLED"] as const;
const ALL_FLAGS = [...INTENT_FLAGS, ...REMAP_FLAGS, "FORM_EDIT_DATE_RULES_ENABLED", "EDIT_INSTRUCTION_REPLACES_ENABLED"] as const;

const model = vi.hoisted(() => ({
  intent: {} as Record<string, unknown>,
  remap: {} as Record<string, unknown>,
  prompts: [] as string[],
}));

const stateBag = vi.hoisted(() => ({ forms: new Map<string, unknown>() }));

function template(overrides: Record<string, unknown>) {
  return {
    id: "tpl",
    key: "coaching",
    name: "Coaching Form",
    shortName: "Coaching",
    description: "A coaching conversation.",
    category: "hr_performance",
    layoutFamily: "coaching",
    requiredPermission: "create_coaching_form",
    active: true,
    displayOrder: 1,
    currentVersion: { id: "v1", status: "published", variants: [] },
    draftVersion: null,
    versionCount: 1,
    activeAsset: null,
    assetCount: 0,
    ...overrides,
  };
}

const LIBRARY = [
  template({}),
  template({
    id: "tpl-dpoa",
    key: "dpoa",
    name: "Corrective Action Form",
    shortName: "CA",
    description: "A corrective action.",
    layoutFamily: "corrective",
    requiredPermission: "create_corrective_action",
    displayOrder: 2,
    currentVersion: { id: "v-dpoa", status: "published", document: correctiveActionDocument(), variants: [] },
  }),
  template({
    id: "tpl-policy-review",
    key: "policy-review",
    name: "Policy Review",
    shortName: "Policy Review",
    description: "A documented review of a policy with an employee, quoting the approved manual.",
    layoutFamily: "corrective",
    requiredPermission: "create_policy_review",
    displayOrder: 3,
  }),
];

vi.mock("@/lib/config/server-env", () => ({
  liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }),
  MissingConfigurationError: class MissingConfigurationError extends Error {
    missing: string[] = [];
  },
}));

vi.mock("@/lib/forms/employee-roster", () => ({
  readDirectoryFacts: async () => [],
  loadScopedRoster: async () => [],
  withRosterLimit: (_ids: readonly string[] | null, run: () => unknown) => run(),
}));

vi.mock("@/lib/forms/repository", () => ({ listTemplateSummaries: async () => LIBRARY }));

vi.mock("@/lib/forms/prior-forms", () => ({
  priorFormsReadingForChat: async () => ({ attach: [], possible: [], identity: "none" }),
}));

vi.mock("./form-state-store", () => ({
  loadFormState: async (userId: string, conversationId: string) => stateBag.forms.get(`${userId}:${conversationId}`) ?? null,
  saveFormState: async (userId: string, conversationId: string, state: unknown) => {
    stateBag.forms.set(`${userId}:${conversationId}`, state);
  },
}));

vi.mock("@/lib/knowledge/providers/supabase", async () => {
  const { manualChunkFromRow } = await import("@/lib/ai/full-manual-load");
  const rows = (await import("@/test/fixtures/jba-manual-production-151.json")).default;
  return {
    SupabaseKnowledgeProvider: class {
      readonly name = "replay";
      async match() {
        return [];
      }
      async fetchRoleGrounding() {
        return { ok: false, failure: { code: "missing", detail: "not used", missingGroups: [] } };
      }
      async fetchOfficialPolicyManual() {
        return {
          ok: true as const,
          documentId: "doc-jba",
          documentTitle: "2025 JBA Policy Manual - Edited 5-2025",
          documentCategory: "policies_compliance" as const,
          matchedBy: "fallback" as const,
          chunks: (rows.chunks as Parameters<typeof manualChunkFromRow>[0][]).map(manualChunkFromRow),
        };
      }
    },
  };
});

vi.mock("@/lib/reporting/read/report-briefing", () => ({ loadReportBriefing: async () => null }));

vi.mock("./call-claude", () => ({
  callClaude: async () => "An answer.",
  callClaudeTool: async (input: { tool?: { name?: string }; messages?: { content?: unknown }[] }) => {
    const tool = input.tool?.name ?? "";
    if (tool === "record_intent_slots") return model.intent;
    if (tool === "extract_form_fields") {
      model.prompts.push(JSON.stringify(input.messages ?? []));
      return model.remap;
    }
    return null;
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from() {
      const query = {
        select: () => query,
        insert: async () => ({ error: null }),
        eq: () => query,
        neq: () => query,
        is: () => query,
        in: () => query,
        gte: () => query,
        ilike: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve(resolve({ data: [], error: null })),
      };
      return query;
    },
  }),
}));

let answerQuestion: typeof import("./server-ask").answerQuestion;

beforeAll(async () => {
  ({ answerQuestion } = await import("./server-ask"));
  // The first import loads the whole answer path; a busy machine takes longer than the 10 s default.
}, 120_000);

beforeEach(() => {
  stateBag.forms.clear();
  model.prompts.length = 0;
});

afterEach(() => {
  for (const flag of ALL_FLAGS) delete process.env[flag];
});

function useFlags(flags: readonly string[]) {
  for (const flag of ALL_FLAGS) delete process.env[flag];
  for (const flag of flags) process.env[flag] = "true";
}

interface Turn {
  readonly say: string;
  /** What the intent model copies from the manager. */
  readonly intent?: Record<string, unknown>;
  /** What the remap model copies from the manager. */
  readonly remap?: Record<string, unknown>;
}

function intentRaw(over: Record<string, unknown> = {}) {
  return {
    employee: null,
    salon: null,
    title: null,
    incidentType: null,
    incidentDate: null,
    payrollAmount: null,
    warningLevel: null,
    formType: "corrective action",
    formTurn: true,
    policyHeading: null,
    ...over,
  };
}

function remapRaw(over: Record<string, unknown> = {}) {
  return { templateKey: "dpoa", employeeName: null, observation: null, actionPlan: null, ...over };
}

let chatCount = 0;

async function chat(turns: readonly Turn[]) {
  chatCount += 1;
  const conversationId = `conv-edit-replaces-${chatCount}`;
  const history: ChatMessage[] = [];
  let last: Awaited<ReturnType<typeof answerQuestion>> | null = null;
  for (const [index, turn] of turns.entries()) {
    model.intent = intentRaw(turn.intent);
    model.remap = remapRaw(turn.remap);
    last = await answerQuestion(
      {
        question: turn.say,
        mode: "standard",
        history,
        scopeId: "stc-core",
        questionMessageId: `msg-${conversationId}-${index}`,
        conversationId,
        continueProposalTemplateKey: last?.formProposal?.templateKey,
        context: { userName: "Pat Manager", locationName: "All salons", todayIso: TODAY },
      },
      { role: "admin", scope: SCOPE, subject: "manager-remap-incident", verified: true },
      { memoryOwnerId: "manager-remap-incident" },
    );
    history.push(
      { id: `u-${index}`, role: "user", content: turn.say, createdAt: TODAY } as ChatMessage,
      // The client sends the card back with its message, as priority-replay does.
      {
        id: `a-${index}`,
        role: "assistant",
        content: last.content,
        createdAt: TODAY,
        ...(last.formProposal ? { formProposal: last.formProposal } : {}),
      } as ChatMessage,
    );
  }
  return last!;
}

type Reply = Awaited<ReturnType<typeof chat>>;

/** What happened as the card carries it (remap path) or the reply's Observation of Offense (intent path). */
function happened(response: Reply): string {
  const issue = response.formProposal?.issue;
  if (issue) return issue;
  return /\*\*(?:What happened|Observation of Offense):\*\*\s*([^\n]+)/.exec(response.content)?.[1]?.trim() ?? "";
}


const FIRST = "create a ca for kira dunmore at kearney, she was 25 minutes late today and did not call the salon";
const NEW_TEXT = "kira clocked in 25 minutes late and did not call the salon before her shift";
const EDITS = [
  `change observation of offense to: ${NEW_TEXT}`,
  `Change observation of offense to: ${NEW_TEXT}`,
  `Change Observation of Offense to: ${NEW_TEXT}`,
  `change what happened to ${NEW_TEXT}`,
  `Change the issue to: ${NEW_TEXT}`,
];

const PATHS = [
  ["intent path", INTENT_FLAGS],
  ["remap path", ALL_FLAGS.filter((flag) => flag !== "FORM_EDIT_DATE_RULES_ENABLED" && flag !== "EDIT_INSTRUCTION_REPLACES_ENABLED")],
] as const;

async function edited(edit: string) {
  return chat([
    { say: FIRST, intent: { employee: "kira dunmore", incidentType: "25 minutes late", incidentDate: "today" }, remap: { employeeName: "kira dunmore" } },
    // The edit turn names nobody new; the models copy no name from it.
    { say: edit },
  ]);
}

describe("EDIT_INSTRUCTION_REPLACES_ENABLED on", () => {
  for (const [label, flags] of PATHS) {
    it(`${label}: the edit replaces What happened with exactly the manager's text and keeps the Employee`, async () => {
      useFlags([...flags, "EDIT_INSTRUCTION_REPLACES_ENABLED"]);
      for (const edit of EDITS) {
        const reply = await edited(edit);
        expect(happened(reply), `${edit}\n${reply.content}`).toBe(NEW_TEXT);
        expect(reply.formProposal?.employeeName?.toLowerCase(), edit).toBe("kira dunmore");
        expect(reply.content).not.toMatch(/change (?:observation|what happened|the issue)/i);
      }
    });
  }

  it("a later account turn after the edit is added to the manager's text, not replacing it", async () => {
    useFlags([...INTENT_FLAGS, "EDIT_INSTRUCTION_REPLACES_ENABLED"]);
    const reply = await chat([
      { say: FIRST, intent: { employee: "kira dunmore" } },
      { say: EDITS[0]! },
      { say: "add that she was also on her phone at the front desk" },
    ]);
    expect(happened(reply)).toBe(`${NEW_TEXT}. she was also on her phone at the front desk`);
  });
});

describe("EDIT_INSTRUCTION_REPLACES_ENABLED on: an instruction after a sentence on the same line (QA-2 gap (d))", () => {
  const SAME_LINE = [
    `create a ca for kira dunmore. change observation of offense to: ${NEW_TEXT}`,
    `Create a CA for Kira Dunmore. Change Observation of Offense to: ${NEW_TEXT}`,
    `Create a ca for kira dunmore. Change observation of offense to: ${NEW_TEXT}`,
    `CREATE A CA FOR KIRA DUNMORE. CHANGE OBSERVATION OF OFFENSE TO: ${NEW_TEXT}`,
    `create a ca for kira dunmore, change observation of offense to: ${NEW_TEXT}`,
    `Create a CA for Kira Dunmore, Change Observation of Offense to: ${NEW_TEXT}`,
  ];
  for (const [label, flags] of PATHS) {
    it(`${label}: the Employee stays and What happened is the manager's text`, async () => {
      useFlags([...flags, "EDIT_INSTRUCTION_REPLACES_ENABLED"]);
      for (const say of SAME_LINE) {
        const reply = await chat([
          { say: FIRST, intent: { employee: "kira dunmore" }, remap: { employeeName: "kira dunmore" } },
          { say },
        ]);
        expect(reply.formProposal?.employeeName?.toLowerCase(), say).toBe("kira dunmore");
        expect(happened(reply), say).toBe(NEW_TEXT);
      }
    });
  }
});

describe("EDIT_INSTRUCTION_REPLACES_ENABLED off", () => {
  for (const [label, flags] of PATHS) {
    it(`${label}: the edit is read as it is today (the reported bug)`, async () => {
      useFlags(flags);
      const reply = await edited(EDITS[0]!);
      expect(happened(reply)).not.toBe(NEW_TEXT);
    });
  }
});

describe("the edit instruction's own words", () => {
  it("are lower case before the readers; the manager's text and other turns stay as typed", async () => {
    const { lowercaseEditInstruction } = await import("./edit-instruction-read");
    expect(lowercaseEditInstruction("Change Observation of Offense to: Kira clocked in late")).toBe(
      "change observation of offense to: Kira clocked in late",
    );
    expect(lowercaseEditInstruction("Ok, Can you Change the Issue to Kira left early")).toBe(
      "ok, can you change the issue to Kira left early",
    );
    expect(lowercaseEditInstruction("Create a CA for Kira Dunmore at Kearney")).toBe("Create a CA for Kira Dunmore at Kearney");
    // QA-2 gap (d): after a sentence on the same line, on its own line and in lower case.
    expect(lowercaseEditInstruction("Create a CA for Kira Dunmore. Change Observation of Offense to: Kira left early")).toBe(
      "Create a CA for Kira Dunmore\nchange observation of offense to: Kira left early",
    );
    expect(lowercaseEditInstruction("CREATE A CA FOR KIRA DUNMORE. CHANGE OBSERVATION OF OFFENSE TO: KIRA LEFT EARLY")).toBe(
      "CREATE A CA FOR KIRA DUNMORE\nchange observation of offense to: KIRA LEFT EARLY",
    );
    // Coordinator's ruling: "No." answers the question before it; the instruction after it is the edit.
    expect(lowercaseEditInstruction("No. Change Observation of Offense to: late")).toBe("No\nchange observation of offense to: late");
    expect(lowercaseEditInstruction("no. change observation of offense to: late")).toBe("no\nchange observation of offense to: late");
    // QA-6: the comma form, as the same-line form.
    expect(lowercaseEditInstruction("Create a CA for Kira Dunmore, Change Observation of Offense to: late")).toBe(
      "Create a CA for Kira Dunmore\nchange observation of offense to: late",
    );
    expect(lowercaseEditInstruction("create a ca for kira dunmore, change observation of offense to: late")).toBe(
      "create a ca for kira dunmore\nchange observation of offense to: late",
    );
    // Inside quotes it is the manager's text.
    const quoted = 'she told the client "we are closed. Change what happened to whatever you like" and left';
    expect(lowercaseEditInstruction(quoted)).toBe(quoted);
    // Confirmed-live corrections are left exactly as typed.
    for (const live of [
      "name is Wren Calloway, not Wrenn",
      "Name is Wren Calloway, not Wrenn",
      "not coaching, make it a ca",
      "Not coaching, make it a CA",
      "Make it a Corrective Action for Kira Dunmore",
      "make it a corrective action for kira dunmore",
    ]) {
      expect(lowercaseEditInstruction(live)).toBe(live);
    }
  });
});

describe("EDIT_INSTRUCTION_REPLACES_ENABLED on: QA's live wordings (Sunny dpl_ydAgKwjC, S12 / S14)", () => {
  const S12 = [
    "coaching form for test employee at lawrence, she was late today, follow-up observation: she has improved, progress level: satisfactory, specific evidence: arrived on time the last 5 shifts",
    "change the progress level to needs improvement",
  ];
  it("S12: \"change the progress level to …\" is an instruction, never appended to the Observation", async () => {
    useFlags([...INTENT_FLAGS, "EDIT_INSTRUCTION_REPLACES_ENABLED"]);
    for (const second of [S12[1]!, "Change the progress level to needs improvement"]) {
      const reply = await chat([{ say: S12[0]!, intent: { employee: "test employee", formType: "coaching" } }, { say: second, intent: { employee: "test employee", formType: "coaching" } }]);
      expect(reply.content, second).not.toMatch(/change the progress level/i);
    }
  });

  it("S14: \"use my wording exactly\" is an instruction, never in the box", async () => {
    useFlags([...INTENT_FLAGS, "EDIT_INSTRUCTION_REPLACES_ENABLED"]);
    for (const say of [
      "coaching form for test employee. observation: she greeted every guest by name today. use my wording exactly",
      "Coaching form for Test Employee. Observation: she greeted every guest by name today. Use my wording exactly",
    ]) {
      const reply = await chat([{ say, intent: { employee: "test employee", formType: "coaching" } }]);
      expect(reply.content, say).not.toMatch(/use my wording exactly/i);
    }
  });
});
