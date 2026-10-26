import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { correctiveActionDocument } from "@/lib/forms/library";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * STORE_ALIAS_ENABLED (QA, 26 Oct 2026; production chats in both apps). What
 * managers type for a salon named none: "kearney, ne", "lawrence, ks",
 * "manhattan ks" read as no salon on their own, and a bare "o st" or
 * "132nd and maple" typed under "Which salon?" left the card's Salon unset
 * and was read as What happened. The QA wordings ("o st", "st joe",
 * "kearney, ne"), all lowercase and in sentence case, through
 * `answerQuestion` on the remap path (the card that asks "Which salon?").
 *
 * The harness is remap-incident-oct24.test.ts's. The models are stand-ins
 * that copy the manager's words; the people are invented.
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
const ALL_FLAGS = [...INTENT_FLAGS, ...REMAP_FLAGS, "STORE_ALIAS_ENABLED"] as const;

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
  const conversationId = `conv-store-alias-${chatCount}`;
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


const REMAP = [...INTENT_FLAGS, ...REMAP_FLAGS];
const FIRST = { say: "create a ca for kira dunmore, she was late today", intent: { employee: "kira dunmore" }, remap: { employeeName: "kira dunmore" } };

/** The card asks "Which salon?"; the manager answers with what they call it. The intent model calls the reply no form turn. */
async function answered(reply: string) {
  return chat([FIRST, { say: reply, intent: { formTurn: false, formType: null }, remap: {} }]);
}

const BARE: readonly (readonly [string, string])[] = [
  ["o st", "NE Lincoln O Street"],
  ["O st", "NE Lincoln O Street"],
  ["O St", "NE Lincoln O Street"],
  ["132nd and maple", "NE Omaha 132nd and Maple"],
  ["the location is o st", "NE Lincoln O Street"],
  ["st joe", "MO St Joseph"],
  ["St joe", "MO St Joseph"],
  ["kearney, ne", "NE Kearney"],
  ["Kearney, NE", "NE Kearney"],
  ["lawrence ks", "KS Lawrence"],
];

describe("STORE_ALIAS_ENABLED on", () => {
  it("a bare salon reply under \"Which salon?\" sets the card's salon and stays in the form", async () => {
    useFlags([...REMAP, "STORE_ALIAS_ENABLED"]);
    for (const [reply, salon] of BARE) {
      const card = await answered(reply);
      expect(card.formProposal?.locationName, reply).toBe(salon);
      expect(card.formProposal?.status, reply).toBe("ready");
      expect(happened(card), reply).not.toMatch(/^(?:o st|132nd and maple|st joe|kearney|lawrence|the location is)/i);
      expect(card.content, reply).not.toMatch(/knowledge base/i);
    }
  });
});

describe("STORE_ALIAS_ENABLED off", () => {
  it("a bare \"o st\" is read as today: no salon, and What happened is \"o st\" (the reported bug)", async () => {
    useFlags(REMAP);
    const card = await answered("o st");
    expect(card.formProposal?.locationId ?? null).toBeNull();
    expect(happened(card)).toBe("o st");
  });
});

describe("the alias pre-read", () => {
  it("rewrites a place with its state wherever it stands, and a bare reply only when the salon was asked", async () => {
    const { readStoreAliases, askedForPlace } = await import("@/lib/forms/store-alias");
    expect(readStoreAliases("she works at our kearney, ne salon and was late today", false)).toBe(
      "she works at our NE Kearney salon and was late today",
    );
    expect(readStoreAliases("She works at our Kearney, NE salon and was late today", false)).toBe(
      "She works at our NE Kearney salon and was late today",
    );
    expect(readStoreAliases("manhattan ks", false)).toBe("the salon is KS Manhattan");
    expect(readStoreAliases("liberty, mo", false)).toBe("the salon is MO Kansas City Liberty");
    // "Lawrence" is also a person: a bare one is the salon only when the salon was asked.
    expect(readStoreAliases("lawrence", false)).toBe("lawrence");
    expect(readStoreAliases("lawrence", true)).toBe("the salon is KS Lawrence");
    // "lincoln" names three salons: it stays as typed, for the readers to ask about.
    expect(readStoreAliases("lincoln", true)).toBe("lincoln");
    expect(askedForPlace({ content: "What is their job title?\nWhich salon?\nVerbal or written?" })).toBe(true);
    expect(askedForPlace({ content: "Is payroll deduct applicable?" })).toBe(false);
  });
});
