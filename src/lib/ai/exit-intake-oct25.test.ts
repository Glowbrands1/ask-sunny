import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import type { DirectoryFact } from "@/lib/forms/employee-roster";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * THE EXIT FORM'S INTAKE READS WHAT THE MANAGER TYPED — PORTED FROM ASK
 * BUBBLES' LIVE QA, 25 OCT 2026
 * ============================================================================
 *
 * The sibling app's managers typed these on its production exit form; here
 * they are in this app's wording (a salon, "Lawrence"), replayed through
 * `answerQuestion` (what POST /api/chat calls) with this app's production
 * profile (intent extraction on, the full remap off):
 *
 *   "… items returned, payroll deduction does not apply"  → here the card was
 *        for **Items Returned** (the sibling asked "Test Employee or items
 *        returned?")
 *   "I need to edit the reason for resignation to: going back to school"
 *        → the card kept "Moving out of state."
 *   "… she resigned, last day 10-24"  → Last Day Worked blank
 *   "permanent address 123 Main St, …. She did not call in for her last two
 *        shifts."  → the card was for **Main St**, Permanent Address blank,
 *        No Call No Show unticked
 *
 * The fix is EXIT_INTAKE_FIX_ENABLED (default off), the same flag as the
 * sibling's. An exit form that already worked is the same card on and off.
 * The employee on these cards is whatever this app reads for "Test Employee"
 * on that working form (KEEP_FORM_EMPLOYEE_ENABLED decides "Test" or "Test
 * Employee"); it is never an exit answer or a street. Synthetic names.
 */

const PROFILE = [
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

const TODAY = "2026-10-25";

const bag = vi.hoisted(() => ({ forms: new Map<string, unknown>() }));

const PEOPLE: DirectoryFact[] = [
  {
    id: "jordan",
    firstName: "Jordan",
    lastName: "Testperson",
    preferredFirstName: null,
    salonIds: ["loc-0468"],
    title: "Tanning Consultant",
    primarySalonId: "loc-0468",
    primaryLocationName: "KS Lawrence",
  },
  {
    id: "jordan-hale",
    firstName: "Jordan",
    lastName: "Hale",
    preferredFirstName: null,
    salonIds: ["loc-0462"],
    title: "Tanning Consultant",
    primarySalonId: "loc-0462",
    primaryLocationName: "KS Manhattan",
  },
];

const LIBRARY = TEMPLATE_SEEDS.map((seed) => ({
  id: `tpl-${seed.key}`,
  key: seed.key,
  name: seed.name,
  shortName: seed.shortName,
  description: seed.description,
  category: seed.category,
  layoutFamily: seed.layoutFamily,
  requiredPermission: seed.requiredPermission,
  active: true,
  displayOrder: seed.displayOrder,
  currentVersion: { id: `v-${seed.key}`, status: "published", document: seed.document, variants: seed.variants },
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
  readDirectoryFacts: async () => PEOPLE,
  loadScopedRoster: async () => PEOPLE,
  withRosterLimit: (_ids: readonly string[] | null, run: () => unknown) => run(),
}));

vi.mock("@/lib/forms/repository", () => ({
  listTemplateSummaries: async () => LIBRARY,
}));

vi.mock("@/lib/forms/prior-forms", () => ({
  priorFormsReadingForChat: async () => ({ attach: [], possible: [], identity: "none" }),
}));

vi.mock("./form-state-store", () => ({
  loadFormState: async (userId: string, conversationId: string) => bag.forms.get(`${userId}:${conversationId}`) ?? null,
  saveFormState: async (userId: string, conversationId: string, state: unknown) => {
    bag.forms.set(`${userId}:${conversationId}`, state);
  },
}));

vi.mock("@/lib/knowledge/providers/supabase", async () => {
  const { JBA_MANUAL_CHUNKS, JBA_MANUAL_DOCUMENT } = await import("@/lib/ai/__fixtures__/jba-policy-manual");
  return {
    SupabaseKnowledgeProvider: class {
      readonly name = "replay";
      async match() {
        return [];
      }
      async search() {
        return [];
      }
      async fetchRoleGrounding() {
        return { ok: false, failure: { code: "missing", detail: "not used", missingGroups: [] } };
      }
      async fetchOfficialPolicyManual() {
        return {
          ok: true as const,
          documentId: JBA_MANUAL_DOCUMENT.id,
          documentTitle: JBA_MANUAL_DOCUMENT.title,
          documentCategory: "policies_compliance" as const,
          matchedBy: "fallback" as const,
          chunks: JBA_MANUAL_CHUNKS,
        };
      }
    },
  };
});

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
  callClaudeTool: async (input: { tool?: { name?: string } }) => {
    if (input.tool?.name === "choose_salon_data") return { read: "none" };
    // The full remap's read: the sibling's production model guessed the Corrective Action Form.
    if (input.tool?.name === "extract_form_fields") {
      return { templateKey: "dpoa", employeeName: null, observation: null, actionPlan: null };
    }
    if (input.tool?.name !== "record_intent_slots") return null;
    return {
      employee: null,
      salon: null,
      title: null,
      incidentType: null,
      incidentDate: null,
      payrollAmount: null,
      warningLevel: null,
      formType: null,
      formTurn: false,
      policyHeading: null,
    };
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from() {
      const query = {
        select: () => query,
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

const SCOPE: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

let answerQuestion: typeof import("./server-ask").answerQuestion;

beforeAll(async () => {
  ({ answerQuestion } = await import("./server-ask"));
}, 120000);

beforeEach(() => {
  for (const flag of PROFILE) vi.stubEnv(flag, "true");
  bag.forms.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

interface Turn {
  readonly question: string;
  readonly content: string;
  readonly proposal: ChatFormProposal | null;
}

let run = 0;

/** `recorded` replaces this app's reply with the one production sent, by turn index. */
async function converse(turns: readonly string[], recorded: Readonly<Record<number, string>> = {}): Promise<Turn[]> {
  run += 1;
  const conversationId = `conv-exit-intake-${run}`;
  const history: ChatMessage[] = [];
  const out: Turn[] = [];
  for (const [index, question] of turns.entries()) {
    const response = await answerQuestion(
      {
        question,
        mode: "standard",
        // The route keeps the last 20 turns (`LIMITS.historyTurns`).
        history: history.slice(-20),
        scopeId: "stc-core",
        questionMessageId: `msg-${run}-${index}`,
        conversationId,
        continueProposalTemplateKey: continuationFor(history)?.templateKey,
        context: { userName: "Pat Manager", locationName: "All salons", todayIso: TODAY },
      },
      { role: "admin" as never, scope: SCOPE, subject: "manager-exit-intake", verified: true },
      { memoryOwnerId: "manager-exit-intake" },
    );
    out.push({ question, content: response.content, proposal: response.formProposal ?? null });
    history.push({ id: `u-${run}-${index}`, role: "user", content: question, createdAt: `${TODAY}T15:00:00Z` });
    history.push({
      id: `a-${run}-${index}`,
      role: "assistant",
      content: recorded[index] ?? response.content,
      createdAt: `${TODAY}T15:01:00Z`,
      ...(response.formProposal ? { formProposal: response.formProposal } : {}),
    });
  }
  return out;
}


const FLAG = "EXIT_INTAKE_FIX_ENABLED";

/*
 * The sibling's QA reads slot retention and form state as rolled back in its
 * production, and this app's profile has slot retention on and form state
 * off. The fix must not depend on either, so every case runs with each of
 * them on and off (typed-name proceeds and field accuracy stay on).
 */
const PROFILES = [
  ["slot retention off, form state off", false, false],
  ["slot retention on, form state off", true, false],
  ["slot retention off, form state on", false, true],
  ["slot retention on, form state on", true, true],
] as const;

/* The sibling's managers' turns, in this app's wording. */
const NOT_A_NAME_TURN =
  "create an exit form for Test Employee at Lawrence. Gave notice 9/25/26 – fulfilled 10/9/26, resigning to pursue other career options, items returned, payroll deduction does not apply";
const REASON_REQUEST =
  "create an exit form for Test Employee at Lawrence, she resigned, last day 10-24-26, reason for resignation: moving out of state";
const REASON_EDIT = "I need to edit the reason for resignation to: going back to school";
const YEARLESS = "create an exit form for Test Employee at Lawrence, she resigned, last day 10-24";
const ADDRESS_NCNS =
  "create an exit form for Test Employee at Lawrence, permanent address 123 Main St, Lawrence, KS 66044. She did not call in for her last two shifts. Last day worked 10-20-26";
const ALREADY_WORKS = "create an exit for Test Employee at Lawrence last day worked 10-17-26";

function blankLine(content: string): string {
  return /\*\*Left blank for you to review:\*\*([^\n]*)/.exec(content)?.[1] ?? "";
}

/** The employee this app puts on the exit form that already worked. */
async function workingEmployee(): Promise<string> {
  const [reply] = await converse([ALREADY_WORKS]);
  const name = reply!.proposal?.employeeName;
  expect(name).toMatch(/^Test( Employee)?$/);
  return name!;
}

describe.each(PROFILES)("%s", (_profile, slotRetention, formState) => {
  beforeEach(() => {
    vi.stubEnv("SLOT_RETENTION_ENABLED", slotRetention ? "true" : "false");
    vi.stubEnv("FORM_STATE_ENABLED", formState ? "true" : "false");
  });

  describe("acceptance: the exit intake on this app's live path (EXIT_INTAKE_FIX_ENABLED on)", () => {
    beforeEach(() => {
      vi.stubEnv(FLAG, "true");
    });

    it("items returned … does not apply: the card is for the employee, never 'Items Returned'", { timeout: 120_000 }, async () => {
      const employee = await workingEmployee();
      const [reply] = await converse([NOT_A_NAME_TURN]);
      expect(reply!.proposal?.templateKey).toBe("stc-exit");
      expect(reply!.proposal?.employeeName).toBe(employee);
      expect(reply!.content).not.toMatch(/items returned\*\*|Which of them/i);
      expect(reply!.content).toContain(`- **Name:** ${employee}`);
      expect(reply!.content).toContain("- **Date that notice was given:** September 25, 2026");
      expect(reply!.content).toContain("- **Date that notice was fulfilled:** October 9, 2026");
      expect(reply!.content).toContain("- **Reason for Resignation:** To pursue other career options.");
      expect(reply!.content).toContain("- **Payroll Deduction:** Payroll deduction is not applicable.");
    });

    it("an explicit edit of the reason changes the reason on the open card", { timeout: 120_000 }, async () => {
      const turns = await converse([REASON_REQUEST, REASON_EDIT]);
      expect(turns[0]!.content).toContain("- **Reason for Resignation:** Moving out of state.");
      const last = turns.at(-1)!;
      expect(last.proposal?.templateKey).toBe("stc-exit");
      expect(last.content).toContain("- **Reason for Resignation:** Going back to school.");
      expect(last.content).not.toContain("Reason for Resignation:** Moving out of state");
      expect(last.content).toContain("- **Last Day Worked:** October 24, 2026");
    });

    it("a yearless 'last day 10-24' is the most recent October 24", { timeout: 120_000 }, async () => {
      const [reply] = await converse([YEARLESS]);
      expect(reply!.content).toContain("- **Last Day Worked:** October 24, 2026");
      expect(blankLine(reply!.content)).not.toContain("Last Day Worked");
      // "She resigned" says that she resigned, not how.
      expect(blankLine(reply!.content)).toContain("How Employee Resigned");
    });

    it("the typed Permanent Address is filled, No Call No Show is ticked, and 'Main St' is nobody", { timeout: 120_000 }, async () => {
      const employee = await workingEmployee();
      const [reply] = await converse([ADDRESS_NCNS]);
      expect(reply!.proposal?.employeeName).toBe(employee);
      expect(reply!.content).not.toMatch(/\*\*Main St\*\*/);
      expect(reply!.content).toContain("- **Permanent Address:** 123 Main St, Lawrence, KS 66044");
      expect(blankLine(reply!.content)).not.toContain("Permanent Address");
      expect(reply!.content).toContain("- **Resignation Details:** No Call No Show");
      expect(reply!.content).toContain("- **Last Day Worked:** October 20, 2026");
    });
  });

  describe("unchanged", () => {
    it("an exit form that already worked is the same card with the flag on and off", { timeout: 120_000 }, async () => {
      vi.stubEnv(FLAG, "true");
      const [on] = await converse([ALREADY_WORKS]);
      vi.stubEnv(FLAG, "false");
      const [off] = await converse([ALREADY_WORKS]);
      expect(on!.content).toBe(off!.content);
      expect({ ...on!.proposal, proposalId: null, sourceMessageIds: null }).toEqual({
        ...off!.proposal,
        proposalId: null,
        sourceMessageIds: null,
      });
    });

    it("flag off: read as before (the card this app gave)", { timeout: 120_000 }, async () => {
      vi.stubEnv(FLAG, "false");
      const [yearless] = await converse([YEARLESS]);
      expect(blankLine(yearless!.content)).toContain("Last Day Worked");
    });

    it("a Corrective Action whose account says 'items returned … does not apply' never names 'Items Returned'", { timeout: 120_000 }, async () => {
      vi.stubEnv(FLAG, "true");
      const [reply] = await converse([
        "create a CA for Test Employee at Lawrence, she was out of dress code 10/11, items returned, payroll deduction does not apply",
      ]);
      expect(reply!.proposal?.employeeName ?? "").not.toMatch(/items returned/i);
    });
  });
});
