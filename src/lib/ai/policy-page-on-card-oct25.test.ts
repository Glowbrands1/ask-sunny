import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { parseHistory } from "@/lib/api/validation";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * THE PRINTED PAGE ON THE FORM CARD — QA, 25 OCT 2026
 * ============================================================================
 *
 * QA (items S4, S7, S22, S24, B1, B5, B7, H13): Corrective Action and Coaching
 * cards said "Policy: Standards of Conduct" with no page (it is p.12), and the
 * same for Late Opening (p.15) and the cell phone policy (p.19). These are the
 * managers' turns word for word from this app's QA chats of 25 Oct 2026
 * (synthetic names), through `answerQuestion` with production's flag profile
 * (intent extraction on, the full remap off) and the production JBA Policy
 * Manual rows (src/test/fixtures/jba-manual-production-151.json). The remap is
 * checked too: it writes the same policy line.
 *
 * POLICY_PAGE_ON_CARD_ENABLED puts the printed page from the manual's chunk
 * metadata beside the policy the card names: "**Policy:** Standards of
 * Conduct (JBA Policy Manual p.12), as you said." Each case also runs with the
 * flag unset and set "off"; those are byte-identical, and the flag-on card is
 * the flag-off card with only the page added.
 */

const PROD_FLAGS = [
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
const FLAG = "POLICY_PAGE_ON_CARD_ENABLED";
const REMAP = "FORM_FULL_REMAP_ENABLED";
const REMAP_FIX = ["FORM_FULL_REMAP_ENABLED", "REMAP_INCIDENT_FIX_ENABLED", "LATE_OPEN_DATE_ENABLED"] as const;
const ALL = [...PROD_FLAGS, ...REMAP_FIX, FLAG] as const;
const TODAY = "2026-10-25";

const bag = vi.hoisted(() => ({
  forms: new Map<string, unknown>(),
  modelLevel: null as "verbal" | "written" | null,
}));

const LIBRARY = TEMPLATE_SEEDS.map((seed, index) => ({
  id: `tpl-${seed.key}`,
  key: seed.key,
  name: seed.name,
  shortName: seed.shortName,
  description: seed.description,
  category: seed.category,
  layoutFamily: seed.layoutFamily,
  requiredPermission: seed.requiredPermission,
  active: true,
  displayOrder: seed.displayOrder ?? index,
  currentVersion: { id: `v-${seed.key}`, status: "published", document: seed.document, variants: seed.variants ?? [] },
  draftVersion: null,
  versionCount: 1,
  activeAsset: null,
  assetCount: 0,
}));

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
  loadFormState: async (userId: string, conversationId: string) => bag.forms.get(`${userId}:${conversationId}`) ?? null,
  saveFormState: async (userId: string, conversationId: string, state: unknown) => {
    bag.forms.set(`${userId}:${conversationId}`, state);
  },
}));
vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    readonly name = "replay";
    async match() {
      return [];
    }
    async fetchRoleGrounding() {
      return { ok: false, failure: { code: "missing", detail: "not used", missingGroups: [] } };
    }
    async fetchOfficialPolicyManual() {
      // The production JBA Policy Manual rows, read the way full-manual-load.ts reads them.
      const { manualChunkFromRow } = await import("./full-manual-load");
      const rows = (await import("@/test/fixtures/jba-manual-production-151.json")).default;
      return {
        ok: true as const,
        documentId: rows.document_ids["ask-sunny"],
        documentTitle: "JBA Policy Manual Edited 5.2025",
        documentCategory: "policies_compliance" as const,
        matchedBy: "fallback" as const,
        chunks: (rows.chunks as Parameters<typeof manualChunkFromRow>[0][]).map(manualChunkFromRow),
      };
    }
  },
}));
vi.mock("@/lib/reporting/read/report-briefing", () => ({ loadReportBriefing: async () => null }));
vi.mock("@/lib/reporting/read/employee-facts", () => ({
  loadEmployeeFacts: async () => null,
  NO_EMPLOYEE_DATASET_REASON: "no dataset",
  EMPLOYEE_DATA_HEADING: "CURRENT EMPLOYEE PERFORMANCE DATA",
}));
vi.mock("@/lib/reviews/overview-block-read", () => ({
  loadReviewsOverviewBlock: async () => ({ status: "ready", totalReviews: 0, averageRating: 0, salonCount: 0 }),
}));
vi.mock("./call-claude", () => ({
  callClaude: async () => "An answer.",
  callClaudeTool: async (input: { tool?: { name?: string }; messages?: { content?: unknown }[] }) => {
    if (input.tool?.name === "choose_salon_data") return { read: "none" };
    if (input.tool?.name !== "record_intent_slots") return null;
    // The form the manager names in this turn, as the slot model copies it.
    const manager = JSON.stringify(input.messages ?? []).split("Manager:").pop() ?? "";
    const formType = /policy review/i.test(manager) ? "Policy Review" : null;
    return {
      formType,
      // The employee as the slot model copies it from the manager's words.
      employee: /\btest employee\b/i.exec(manager)?.[0] ?? null,
      salon: null,
      title: null,
      incidentType: null,
      incidentDate: null,
      payrollAmount: null,
      warningLevel: bag.modelLevel,
      formTurn: true,
      policyHeading: null,
    };
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from() {
      const query: Record<string, unknown> = {};
      for (const name of ["select", "eq", "neq", "is", "in", "gte", "ilike", "order", "limit", "insert", "update", "upsert"]) {
        query[name] = () => query;
      }
      query.maybeSingle = () => Promise.resolve({ data: null, error: null });
      query.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve(resolve({ data: [], error: null }));
      return query;
    },
  }),
}));

const SCOPE: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

let answerQuestion: typeof import("./server-ask").answerQuestion;
beforeAll(async () => {
  ({ answerQuestion } = await import("./server-ask"));
}, 120_000);

const saved = new Map<string, string | undefined>();
beforeEach(() => {
  for (const name of ALL) saved.set(name, process.env[name]);
  bag.forms.clear();
});
afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

let sequence = 0;

/** Each turn as the browser sends it, with exactly these flags on. The last reply's text. */
async function replay(flags: readonly string[], turns: readonly string[]): Promise<string> {
  for (const name of ALL) {
    if (flags.includes(name)) process.env[name] = "true";
    else if (name !== FLAG) delete process.env[name];
  }
  sequence += 1;
  const conversationId = `conv_test_ppage_${sequence}`;
  const messages: ChatMessage[] = [];
  let last = "";
  for (const [index, user] of turns.entries()) {
    const continuation = continuationFor(messages);
    const response = await answerQuestion(
      {
        question: user,
        mode: "standard",
        history: parseHistory(messages) as ChatMessage[],
        scopeId: "stc-core",
        questionMessageId: `u${index}`,
        conversationId,
        continueProposalTemplateKey: continuation?.templateKey,
        context: { userName: "Pat Manager", locationName: "All salons", todayIso: TODAY },
      },
      { role: "district_manager", scope: SCOPE, subject: "manager-replay", verified: true },
      { memoryOwnerId: "manager-replay" },
    );
    last = response.content;
    messages.push(
      { id: `u${index}`, role: "user", content: user, createdAt: "2026-10-25T12:00:00Z" } as ChatMessage,
      {
        id: `a${index}`,
        role: "assistant",
        content: response.content,
        createdAt: "2026-10-25T12:00:01Z",
        formProposal: response.formProposal,
      } as ChatMessage,
    );
  }
  return last;
}

/** The card with the flag unset, with the flag set "off", and with it on. */
async function threeWays(profile: readonly string[], turns: readonly string[]) {
  delete process.env[FLAG];
  const unset = await replay(profile, turns);
  process.env[FLAG] = "off";
  const off = await replay(profile, turns);
  const on = await replay([...profile, FLAG], turns);
  return { unset, off, on };
}

const STANDARDS =
  "create corrective action for test employee for violating standards of conduct policy on 10-20-26. test failed to acknowledge policies in woven by the 10-15-26 deadline.";
const LATE_OPENING =
  "create verbal ca for test employee for opening salon late on 10-1-26. previous coaching is jba policy manual 1-1-26. payroll deduct DOES apply and state $25 will be payroll deducted";
const CELL_PHONE = "create a verbal corrective action form for test employee. on 10-20-26 test was talking on her cell phone for over 30 minutes";

describe("QA 25 Oct 2026: the policy on the card carries its printed page (POLICY_PAGE_ON_CARD_ENABLED)", () => {
  it("a Standards of Conduct CA: p.12 beside the policy the manager named, nothing else changes", async () => {
    const card = await threeWays(PROD_FLAGS, [STANDARDS]);
    expect(card.off).toContain("**Policy:** Standards of Conduct, as you said.");
    expect(card.on).toContain("**Policy:** Standards of Conduct (JBA Policy Manual p.12), as you said.");
    expect(card.on).not.toMatch(/p\.13\b/);
    expect(card.on.replace(" (JBA Policy Manual p.12)", "")).toBe(card.off);
    expect(card.off).toBe(card.unset);
  });

  it('a Standards of Conduct CA named on a later turn ("she violated the standards of conduct")', async () => {
    const turns = ["create corrective action form for Test Employee, Salon Director", "she violated the standards of conduct"];
    const card = await threeWays(PROD_FLAGS, turns);
    expect(card.off).toContain("**Policy:** Standards of Conduct, as you said.");
    expect(card.on).toContain("**Policy:** Standards of Conduct (JBA Policy Manual p.12), as you said.");
    expect(card.on.replace(" (JBA Policy Manual p.12)", "")).toBe(card.off);
    expect(card.off).toBe(card.unset);
  });

  it("a late opening: p.15 beside Late Opening, nothing else changes", async () => {
    const card = await threeWays(PROD_FLAGS, [LATE_OPENING]);
    expect(card.off).toContain("**Policy:** Late Opening, as you said.");
    expect(card.on).toContain("**Policy:** Late Opening (JBA Policy Manual p.15), as you said.");
    expect(card.on).not.toMatch(/p\.16\b/);
    expect(card.on.replace(" (JBA Policy Manual p.15)", "")).toBe(card.off);
    expect(card.off).toBe(card.unset);
  });

  it("a cell phone CA already names page 19; the flag changes nothing", async () => {
    const card = await threeWays(PROD_FLAGS, [CELL_PHONE]);
    expect(card.off).toContain("**Cell Phone/Smart Watch Policy** (page 19)");
    expect(card.on).toBe(card.off);
    expect(card.off).toBe(card.unset);
  });

  it("the full remap writes the same line, and gets the same page", async () => {
    const card = await threeWays([REMAP], [STANDARDS]);
    expect(card.off).toContain("**Policy:** Standards of Conduct, as you said");
    expect(card.on).toContain("**Policy:** Standards of Conduct (JBA Policy Manual p.12), as you said");
    expect(card.on.replace(" (JBA Policy Manual p.12)", "")).toBe(card.off);
    expect(card.off).toBe(card.unset);
  });

  it.each([
    ["a Standards of Conduct CA", STANDARDS, "Standards of Conduct Policy, JBA Policy Manual p.12"],
    ["a late opening", LATE_OPENING, "Late Opening Policy, JBA Policy Manual p.15"],
    ["a cell phone CA", CELL_PHONE, "Cell Phone/Smart Watch Policy, JBA Policy Manual p.19"],
  ])("with REMAP_INCIDENT_FIX_ENABLED on the remap, %s already cites the page; the flag changes nothing", async (_name, say, cited) => {
    const card = await threeWays(REMAP_FIX, [say]);
    expect(card.off).toContain(cited);
    expect(card.on).toBe(card.off);
    expect(card.on.match(/JBA Policy Manual p\.\d+/g)).toHaveLength(1);
    expect(card.off).toBe(card.unset);
  });
});
